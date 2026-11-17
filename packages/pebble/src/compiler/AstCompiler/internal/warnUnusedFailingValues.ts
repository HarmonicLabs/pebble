import { DiagnosticEmitter } from "../../../diagnostics/DiagnosticEmitter";
import { DiagnosticCode } from "../../../diagnostics/diagnosticMessages.generated";
import { TirDivExpr, TirModuloExpr } from "../../tir/expressions/binary/TirBinaryExpr";
import { TirLitFailExpr } from "../../tir/expressions/litteral/TirLitFailExpr";
import { TirLitIntExpr } from "../../tir/expressions/litteral/TirLitIntExpr";
import { TirParentesizedExpr } from "../../tir/expressions/TirParentesizedExpr";
import { TirCallExpr } from "../../tir/expressions/TirCallExpr";
import { TirFailExpr } from "../../tir/expressions/TirFailExpr";
import { TirFuncExpr } from "../../tir/expressions/TirFuncExpr";
import { TirPropAccessExpr } from "../../tir/expressions/TirPropAccessExpr";
import { TirVariableAccessExpr } from "../../tir/expressions/TirVariableAccessExpr";
import { TypedProgram } from "../../tir/program/TypedProgram";
import { TirAssertStmt } from "../../tir/statements/TirAssertStmt";
import { TirBlockStmt } from "../../tir/statements/TirBlockStmt";
import { TirFailStmt } from "../../tir/statements/TirFailStmt";
import { TirSimpleVarDecl } from "../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirForOfStmt } from "../../tir/statements/TirForOfStmt";
import { TirForStmt } from "../../tir/statements/TirForStmt";
import { TirWhileStmt } from "../../tir/statements/TirWhileStmt";
import { readOnEveryPath } from "../../TirCompiler/expressify/loopResultIsForced";
import { TirAliasType } from "../../tir/types/TirAliasType";
import { TirType } from "../../tir/types/TirType";

/**
 * A value declared is computed only where it is read: never, when unused (the compiler drops
 * it, and with it whatever could fail while computing it: `const ok = checkSigned( tx, owner );`
 * checks nothing), and only on the ways that read it otherwise (`if( c ) return ok;` checks only
 * when `c` holds). Warns about each such declaration in user code whose value could fail: a
 * `fail`, a division, or a call to a function of the program's own code that asserts, fails or
 * divides (itself or through the functions of the program's code it calls).
 */
export function warnUnusedFailingValues( program: TypedProgram, emitter: DiagnosticEmitter ): void
{
    const analysis = new FailureAnalysis( program );
    const seen = new Set<TirFuncExpr>();
    for( const fn of program.functions.values() )
    {
        if( !( fn instanceof TirFuncExpr ) || seen.has( fn ) ) continue;
        seen.add( fn );
        if( !isUserCode( fn ) ) continue;
        visitStatement( fn.body, [], emitter, analysis );
    }
}

function isUserCode( fn: TirFuncExpr ): boolean
{
    const source = fn.range?.source;
    return source !== undefined && !source.isLibrary();
}

/** TIR statements and expressions (and `match` cases) have `deps` */
function isTirNode( x: any ): boolean
{
    return typeof x === "object" && x !== null && typeof x.deps === "function";
}

/** statements are TIR nodes that are not expressions (no `toIR`) */
function isStatement( x: any ): boolean
{
    return isTirNode( x ) && typeof x.toIR !== "function";
}

/** the TIR nodes directly held by `node`: its fields, their arrays' and maps' elements */
function childNodes( node: any ): any[]
{
    const children: any[] = [];
    for( const value of Object.values( node ) )
    {
        const values = Array.isArray( value ) ? value
            : value instanceof Map ? [ ...value.values() ]
            : [ value ];
        for( const v of values ) if( isTirNode( v ) ) children.push( v );
    }
    return children;
}

/** `after`: what runs after `stmt`, to the end of its function (nothing in a loop body) */
function visitStatement( stmt: any, after: readonly any[], emitter: DiagnosticEmitter, analysis: FailureAnalysis ): void
{
    if( stmt instanceof TirBlockStmt )
    {
        checkBlock( stmt.stmts, after, emitter, analysis );
        stmt.stmts.forEach( ( s, i ) => visitStatement( s, [ ...stmt.stmts.slice( i + 1 ), ...after ], emitter, analysis ) );
        return;
    }
    const inLoop = stmt instanceof TirForStmt || stmt instanceof TirWhileStmt || stmt instanceof TirForOfStmt;
    for( const child of childNodes( stmt ) )
    {
        // `match` cases hold their bodies; branches go on with what follows
        if( isStatement( child ) ) visitStatement( child, inLoop ? [] : after, emitter, analysis );
    }
}

function checkBlock( stmts: readonly any[], after: readonly any[], emitter: DiagnosticEmitter, analysis: FailureAnalysis ): void
{
    for( let i = 0; i < stmts.length; i++ )
    {
        const decl = stmts[i];
        if( !( decl instanceof TirSimpleVarDecl ) || decl.initExpr === undefined ) continue;
        // a function value is not computed by its declaration: its body runs when called
        if( decl.initExpr instanceof TirFuncExpr ) continue;
        if( !analysis.mayFail( decl.initExpr ) ) continue;
        const seen = new Set<object>();
        const rest = stmts.slice( i + 1 );
        if( !rest.some( s => references( s, decl.name, seen ) ) ) emitter.warning(
            DiagnosticCode._0_is_never_used_so_it_is_never_computed_a_failure_in_its_value_an_assert_in_a_function_it_calls_a_division_by_zero_never_happens_Use_it_or_remove_it,
            decl.range,
            decl.sourceName ?? decl.name
        );
        else if( !readOnEveryPath( [ ...rest, ...after ], decl.name, analysis.program, call => analysis.userFunctionCalled( call ) ) ) emitter.warning(
            DiagnosticCode._0_is_computed_only_where_it_is_read_and_some_ways_after_it_do_not_read_it_on_those_a_failure_in_its_value_an_assert_in_a_function_it_calls_a_division_by_zero_does_not_happen_Read_it_before_the_branches_or_declare_it_where_it_is_read,
            decl.range,
            decl.sourceName ?? decl.name
        );
    }
}

/** whether `node` reads the variable `name` (anywhere: in nested blocks, in closures) */
function references( node: any, name: string, seen: Set<object> ): boolean
{
    if( node instanceof TirVariableAccessExpr ) return node.varName === name;
    if( seen.has( node ) ) return false;
    seen.add( node );
    return childNodes( node ).some( child => references( child, name, seen ) );
}

class FailureAnalysis
{
    /** whether calling the function may fail; `false` while it is being analysed (recursion adds nothing) */
    private readonly functionMayFail = new Map<TirFuncExpr, boolean>();

    constructor( readonly program: TypedProgram ) {}

    /** whether computing `node` (or running it, for a statement) may fail */
    mayFail( node: any, seen: Set<object> = new Set() ): boolean
    {
        if(
            node instanceof TirFailExpr
            || node instanceof TirLitFailExpr
            || node instanceof TirAssertStmt
            || node instanceof TirFailStmt
        ) return true;
        // dividing by a constant other than 0 cannot fail
        if(
            ( node instanceof TirDivExpr || node instanceof TirModuloExpr )
            && !this.isNonZeroConstant( node.right )
        ) return true;
        if( seen.has( node ) ) return false;
        seen.add( node );
        if( node instanceof TirCallExpr )
        {
            const callee = this.userFunctionCalled( node )?.fn;
            if( callee !== undefined && this.calleeMayFail( callee ) ) return true;
        }
        // the functions passed around in it may be called: they count too
        return childNodes( node ).some( child => this.mayFail( child, seen ) );
    }

    /**
     * `expr` is an integer other than 0, whatever runs: a literal, or a `const` of a module
     * that is one (`x % R`, with `const R = 0x73ed…;` at the top of a file: a field's order
     * is a name, not a number written at every use)
     */
    private isNonZeroConstant( expr: any, inModuleConst: boolean = false, seen: Set<string> = new Set() ): boolean
    {
        while( expr instanceof TirParentesizedExpr ) expr = expr.expr;
        if( expr instanceof TirLitIntExpr ) return expr.integer !== BigInt( 0 );
        if( !( expr instanceof TirVariableAccessExpr ) ) return false;
        // A module's constant: declared outside every function, under its file-unique name.
        // (What a module constant's own value names can be nothing else: no local is in sight.)
        if( !inModuleConst && !expr.resolvedValue.isDefinedOutsideFuncScope ) return false;
        if( seen.has( expr.varName ) ) return false;
        seen.add( expr.varName );
        const decl = this.program.constants.get( expr.varName );
        return decl !== undefined
            && decl.isConst
            && decl.initExpr !== undefined
            && this.isNonZeroConstant( decl.initExpr, true, seen );
    }

    private calleeMayFail( fn: TirFuncExpr ): boolean
    {
        const known = this.functionMayFail.get( fn );
        if( known !== undefined ) return known;
        this.functionMayFail.set( fn, false );
        const result = this.mayFail( fn.body );
        this.functionMayFail.set( fn, result );
        return result;
    }

    /** the function of the program's own code (not the standard library's) the call calls */
    userFunctionCalled( call: TirCallExpr ): { fn: TirFuncExpr, isMethod: boolean } | undefined
    {
        const callee = call.func;
        let fnName: string | undefined = undefined;
        if( callee instanceof TirVariableAccessExpr ) fnName = callee.varName;
        // a method a `type` declares
        else if( callee instanceof TirPropAccessExpr ) fnName = methodFunctionName( callee.object.type, callee.prop.text );
        if( fnName === undefined ) return undefined;
        const fn = this.program.functions.get( fnName );
        return fn instanceof TirFuncExpr && isUserCode( fn ) ? { fn, isMethod: callee instanceof TirPropAccessExpr } : undefined;
    }
}

function methodFunctionName( type: TirType, methodName: string ): string | undefined
{
    while( type instanceof TirAliasType )
    {
        const fnName = type.methodsNamesPtr.get( methodName );
        if( fnName !== undefined ) return fnName;
        type = type.aliased;
    }
    return undefined;
}
