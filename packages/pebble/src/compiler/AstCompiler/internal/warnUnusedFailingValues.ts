import { DiagnosticEmitter } from "../../../diagnostics/DiagnosticEmitter";
import { DiagnosticCode } from "../../../diagnostics/diagnosticMessages.generated";
import { TirDivExpr, TirModuloExpr } from "../../tir/expressions/binary/TirBinaryExpr";
import { TirLitFailExpr } from "../../tir/expressions/litteral/TirLitFailExpr";
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
import { TirAliasType } from "../../tir/types/TirAliasType";
import { TirType } from "../../tir/types/TirType";

/**
 * A value declared and never used is never computed: the compiler drops it, and with it
 * whatever could fail while computing it. `const ok = checkSigned( tx, owner );` checks
 * nothing. Warns about each such declaration in user code whose value could fail: a `fail`, a
 * division, or a call to a function of the program's own code that asserts, fails or divides
 * (itself or through the functions of the program's code it calls).
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
        visitStatement( fn.body, emitter, analysis );
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

function visitStatement( stmt: any, emitter: DiagnosticEmitter, analysis: FailureAnalysis ): void
{
    if( stmt instanceof TirBlockStmt ) checkBlock( stmt.stmts, emitter, analysis );
    for( const child of childNodes( stmt ) )
    {
        // `match` cases hold their bodies
        if( isStatement( child ) ) visitStatement( child, emitter, analysis );
    }
}

function checkBlock( stmts: readonly any[], emitter: DiagnosticEmitter, analysis: FailureAnalysis ): void
{
    for( let i = 0; i < stmts.length; i++ )
    {
        const decl = stmts[i];
        if( !( decl instanceof TirSimpleVarDecl ) || decl.initExpr === undefined ) continue;
        // a function value is not computed by its declaration: its body runs when called
        if( decl.initExpr instanceof TirFuncExpr ) continue;
        if( !analysis.mayFail( decl.initExpr ) ) continue;
        const seen = new Set<object>();
        if( stmts.slice( i + 1 ).some( s => references( s, decl.name, seen ) ) ) continue;
        emitter.warning(
            DiagnosticCode._0_is_never_used_so_it_is_never_computed_a_failure_in_its_value_an_assert_in_a_function_it_calls_never_happens_Use_it_or_remove_it,
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
            || node instanceof TirDivExpr
            || node instanceof TirModuloExpr
            || node instanceof TirAssertStmt
            || node instanceof TirFailStmt
        ) return true;
        if( seen.has( node ) ) return false;
        seen.add( node );
        if( node instanceof TirCallExpr )
        {
            const callee = this.userFunctionCalled( node );
            if( callee !== undefined && this.calleeMayFail( callee ) ) return true;
        }
        // the functions passed around in it may be called: they count too
        return childNodes( node ).some( child => this.mayFail( child, seen ) );
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
    private userFunctionCalled( call: TirCallExpr ): TirFuncExpr | undefined
    {
        const callee = call.func;
        let fnName: string | undefined = undefined;
        if( callee instanceof TirVariableAccessExpr ) fnName = callee.varName;
        // a method a `type` declares
        else if( callee instanceof TirPropAccessExpr ) fnName = methodFunctionName( callee.object.type, callee.prop.text );
        if( fnName === undefined ) return undefined;
        const fn = this.program.functions.get( fnName );
        return fn instanceof TirFuncExpr && isUserCode( fn ) ? fn : undefined;
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
