import type { SourceRange } from "../../ast/Source/SourceRange";
import type { Source } from "../../ast/Source/Source";
import { ContractDecl } from "../../ast/nodes/statements/declarations/ContractDecl";
import { ExportStmt } from "../../ast/nodes/statements/ExportStmt";
import { isInternalName } from "../internalVar";
import { TypedProgram } from "../tir/program/TypedProgram";
import { TirFuncExpr, sourceNameOf } from "../tir/expressions/TirFuncExpr";
import { TirExpr } from "../tir/expressions/TirExpr";
import { TirCallExpr } from "../tir/expressions/TirCallExpr";
import { TirPropAccessExpr } from "../tir/expressions/TirPropAccessExpr";
import { TirCaseExpr } from "../tir/expressions/TirCaseExpr";
import { TirElemAccessExpr } from "../tir/expressions/TirElemAccessExpr";
import { TirTernaryExpr } from "../tir/expressions/TirTernaryExpr";
import { TirParentesizedExpr } from "../tir/expressions/TirParentesizedExpr";
import { TirTypeConversionExpr } from "../tir/expressions/TirTypeConversionExpr";
import { TirLettedExpr } from "../tir/expressions/TirLettedExpr";
import { TirFromDataExpr } from "../tir/expressions/TirFromDataExpr";
import { TirToDataExpr } from "../tir/expressions/TirToDataExpr";
import { TirAssertAndContinueExpr } from "../tir/expressions/TirAssertAndContinueExpr";
import { TirTraceIfFalseExpr } from "../tir/expressions/TirTraceIfFalseExpr";
import { TirTraceExpr } from "../tir/expressions/TirTraceExpr";
import { isTirBinaryExpr } from "../tir/expressions/binary/TirBinaryExpr";
import { isTirUnaryPrefixExpr } from "../tir/expressions/unary/TirUnaryPrefixExpr";
import { TirLitNamedObjExpr } from "../tir/expressions/litteral/TirLitNamedObjExpr";
import { TirStmt } from "../tir/statements/TirStmt";
import { TirBlockStmt } from "../tir/statements/TirBlockStmt";
import { TirIfStmt } from "../tir/statements/TirIfStmt";
import { TirReturnStmt } from "../tir/statements/TirReturnStmt";
import { TirAssertStmt } from "../tir/statements/TirAssertStmt";
import { TirForStmt } from "../tir/statements/TirForStmt";
import { TirForOfStmt } from "../tir/statements/TirForOfStmt";
import { TirWhileStmt } from "../tir/statements/TirWhileStmt";
import { TirMatchStmt } from "../tir/statements/TirMatchStmt";
import { TirAssignmentStmt } from "../tir/statements/TirAssignmentStmt";
import { TirTraceStmt } from "../tir/statements/TirTraceStmt";
import { TirFailStmt } from "../tir/statements/TirFailStmt";
import { TirBreakStmt } from "../tir/statements/TirBreakStmt";
import { TirContinueStmt } from "../tir/statements/TirContinueStmt";
import { TirSimpleVarDecl } from "../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirNamedDeconstructVarDecl } from "../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSingleDeconstructVarDecl } from "../tir/statements/TirVarDecl/TirSingleDeconstructVarDecl";
import { TirArrayLikeDeconstr } from "../tir/statements/TirVarDecl/TirArrayLikeDeconstr";
import { TirVarDecl } from "../tir/statements/TirVarDecl/TirVarDecl";
import { DebugCollector } from "./DebugCollector";
import type { DebugFunction, DebugStmt, DebugStmtKind, DebugVar } from "./DebugInfo";

type MutableFunction = { -readonly [K in keyof DebugFunction]: DebugFunction[K] };
type MutableStmt = { -readonly [K in keyof DebugStmt]: DebugStmt[K] };

/**
 * Walks the user functions of `program` (library code excluded) before `expressify` rewrites
 * their statements, recording functions, statements, variables and what is in scope where.
 */
export function collectDebugStructure( program: TypedProgram, dbg: DebugCollector ): void
{
    const funcs: TirFuncExpr[] = [];
    const sources = new Set<Source>();
    for( const func of program.functions.values() )
    {
        if(!( func instanceof TirFuncExpr ) || funcs.includes( func ) ) continue;
        if( !isUserRange( func.range ) ) continue;
        funcs.push( func );
        sources.add( func.range.source );
    }
    for( const source of sources ) collectRegions( source, dbg );

    const walker = new StructureWalker( dbg, program.debugAliases.map( a => ({
        ...a,
        region: dbg.regions.find( r => contains( r.range, a.range ) )?.range
    })));
    for( const func of funcs ) walker.walkFunction( func, undefined, [], "function", undefined );

    // the order statements run in: pre-order over each function's statements
    let order = 0;
    const number = ( stmts: readonly DebugStmt[] ): void => {
        for( const s of stmts )
        {
            ( s as MutableStmt ).order = order++;
            number( s.children );
        }
    };
    for( const fn of dbg.functions ) number( fn.stmts );
}

interface PendingAlias {
    name: string;
    tirName: string;
    range: SourceRange;
    /** the method the alias is declared in: it names its variable only there */
    region: SourceRange | undefined;
}

function contains( outer: SourceRange, inner: SourceRange ): boolean
{
    return outer.source === inner.source && outer.start <= inner.start && inner.end <= outer.end;
}

/** a range in user code (not library code, not a generated node's mock range) */
export function isUserRange( range: SourceRange | null | undefined ): range is SourceRange
{
    return (
        range !== null &&
        range !== undefined &&
        range.start >= 0 &&
        range.end >= range.start &&
        range.source !== undefined &&
        !range.source.isLibrary()
    );
}

class StructureWalker
{
    /** variables aliases name, by name */
    private readonly hidden = new Map<string, DebugVar>();
    private readonly aliasTargets: Set<string>;

    constructor(
        readonly dbg: DebugCollector,
        private readonly aliases: PendingAlias[]
    )
    {
        this.aliasTargets = new Set( aliases.map( a => a.tirName ) );
    }

    private readonly methodsOf = new Map<DebugFunction, SourceRange[]>();

    /** `false` for a range of a contract's function outside every method */
    private inMethodIfContract( range: SourceRange, fn: DebugFunction ): boolean
    {
        let top = fn;
        while( top.parent !== undefined ) top = top.parent;
        let methods = this.methodsOf.get( top );
        if( methods === undefined )
        {
            methods = this.dbg.regions.filter( r => contains( top.range, r.range ) ).map( r => r.range );
            this.methodsOf.set( top, methods );
        }
        return methods.length === 0 || methods.some( m => contains( m, range ) );
    }

    /** the aliases declared before `range`, in its method, start naming their variable */
    private activateAliases( range: SourceRange, fn: DebugFunction, scope: DebugVar[] ): void
    {
        for( let i = 0; i < this.aliases.length; i++ )
        {
            const a = this.aliases[i];
            if( a.range.source !== range.source || a.range.end > range.start ) continue;
            if( a.region === undefined || !contains( a.region, range ) ) continue;
            const target = this.hidden.get( a.tirName );
            if( target === undefined ) continue;
            this.aliases.splice( i--, 1 );
            const v: DebugVar = {
                id: this.dbg.vars.length,
                name: a.name,
                tirName: a.tirName,
                type: target.type,
                range: a.range,
                kind: "const",
                fn,
                declStmt: undefined,
                aliasOf: target,
            };
            this.dbg.vars.push( v );
            scope.push( v );
        }
    }

    walkFunction(
        func: TirFuncExpr,
        parent: DebugFunction | undefined,
        outerScope: readonly DebugVar[],
        kind: "function" | "loop",
        definedAt: DebugStmt | undefined
    ): DebugFunction
    {
        const known = this.dbg.fnOf.get( func );
        if( known !== undefined ) return known;

        const fn = this.newFunction(
            func.displayName ?? sourceNameOf( func.name ),
            func.range, kind, parent, undefined, definedAt,
            typeof func.displayName === "string" && func.displayName.startsWith( "test " )
        );
        fn.returnType = func.returnType;
        this.dbg.fnOf.set( func, fn );
        this.dbg.fnOf.set( func.body, fn );

        const scope = outerScope.slice();
        for( const param of func.params )
        {
            const v = this.newVar( param, "param", fn, undefined );
            if( v === undefined ) continue;
            fn.params.push( v );
            scope.push( v );
        }
        fn.stmts.push( ...this.walkBlock( func.body.stmts, fn, undefined, scope ) );
        return fn;
    }

    private newFunction(
        name: string,
        range: SourceRange,
        kind: "function" | "loop",
        parent: DebugFunction | undefined,
        loopStmt: DebugStmt | undefined,
        definedAt: DebugStmt | undefined,
        isTest: boolean
    ): MutableFunction
    {
        const fn: MutableFunction = {
            id: this.dbg.functions.length,
            name, range, kind, parent, loopStmt, definedAt,
            params: [],
            stmts: [],
            isTest,
            returnType: undefined,
        };
        this.dbg.functions.push( fn );
        return fn;
    }

    /** `scope` grows with the declarations of the block */
    private walkBlock( stmts: readonly TirStmt[], fn: DebugFunction, parent: DebugStmt | undefined, scope: DebugVar[] ): DebugStmt[]
    {
        const out: DebugStmt[] = [];
        for( const stmt of stmts ) out.push( this.walkStmt( stmt, fn, parent, scope ) );
        return out;
    }

    /**
     * a branch body, as a block statement of its own (an assignment in one branch is not seen
     * in another): a block, or the single statement
     */
    private walkBranch( stmt: TirStmt, fn: DebugFunction, parent: DebugStmt, scope: readonly DebugVar[] ): DebugStmt[]
    {
        if( stmt instanceof TirBlockStmt ) return [ this.walkStmt( stmt, fn, parent, scope.slice() ) ];
        const [ block ] = this.newStmt( undefined, "block", stmt.range, fn, parent, scope );
        block.children = [ this.walkStmt( stmt, fn, block, scope.slice() ) ];
        return [ block ];
    }

    private newStmt(
        tirStmt: object | undefined,
        kind: DebugStmtKind,
        range: SourceRange,
        fn: DebugFunction,
        parent: DebugStmt | undefined,
        scope: readonly DebugVar[]
    ): [ MutableStmt, DebugVar[] ]
    {
        const declares: DebugVar[] = [];
        const stmt: MutableStmt = {
            id: this.dbg.stmts.length,
            kind, range, fn, parent,
            children: [],
            scope: scope.slice(),
            declares,
            loop: undefined,
            order: -1,
            isStop: (
                kind !== "block" &&
                isUserRange( range ) &&
                range.end > range.start &&
                // generated statements stand for the whole function (a contract's dispatch)
                !( range.source === fn.range.source && range.start === fn.range.start && range.end === fn.range.end ) &&
                // in a contract, the dispatch to the methods is generated: only methods have statements
                this.inMethodIfContract( range, fn )
            ),
        };
        this.dbg.addStmt( stmt );
        if( tirStmt !== undefined ) this.dbg.stmtOf.set( tirStmt, stmt );
        return [ stmt, declares ];
    }

    private declare( decl: TirVarDecl, kind: DebugVar["kind"], fn: DebugFunction, declStmt: DebugStmt, declares: DebugVar[], scope: DebugVar[] ): void
    {
        for( const leaf of leafDecls( decl ) )
        {
            const v = this.newVar( leaf, kind, fn, declStmt );
            if( v === undefined ) continue;
            declares.push( v );
            scope.push( v );
        }
    }

    private newVar( decl: TirSimpleVarDecl, kind: DebugVar["kind"], fn: DebugFunction, declStmt: DebugStmt | undefined ): DebugVar | undefined
    {
        const name = decl.sourceName ?? ( isInternalName( decl.name ) ? undefined : decl.name );
        // a compiler variable is kept only when an alias names it
        const hidden = name === undefined;
        if( hidden && !this.aliasTargets.has( decl.name ) ) return undefined;
        const v: DebugVar = {
            id: this.dbg.vars.length,
            name: name ?? decl.name,
            tirName: decl.name,
            type: decl.type,
            range: decl.range,
            kind,
            fn,
            declStmt,
            ...( hidden ? { hidden: true } : {} ),
        };
        this.dbg.vars.push( v );
        this.dbg.varOf.set( decl, v );
        if( hidden ) this.hidden.set( decl.name, v );
        return v;
    }

    private walkStmt( stmt: TirStmt, fn: DebugFunction, parent: DebugStmt | undefined, scope: DebugVar[] ): DebugStmt
    {
        if( this.aliases.length > 0 && isUserRange( stmt.range ) ) this.activateAliases( stmt.range, fn, scope );
        const [ d, declares ] = this.newStmt( stmt, kindOf( stmt ), stmt.range, fn, parent, scope );
        this.exprStmt = d;

        if( stmt instanceof TirBlockStmt )
        {
            d.children = this.walkBlock( stmt.stmts, fn, d, scope.slice() );
        }
        else if( stmt instanceof TirSimpleVarDecl )
        {
            this.walkExpr( stmt.initExpr, fn, scope );
            this.declare( stmt, stmt.isConst ? "const" : "let", fn, d, declares, scope );
        }
        else if(
            stmt instanceof TirNamedDeconstructVarDecl ||
            stmt instanceof TirSingleDeconstructVarDecl ||
            stmt instanceof TirArrayLikeDeconstr
        )
        {
            this.walkExpr( stmt.initExpr, fn, scope );
            // nested patterns come back as statements of their own, after expressify
            for( const nested of nestedDecls( stmt ) ) this.dbg.stmtOf.set( nested, d );
            this.declare( stmt, stmt.isConst ? "const" : "let", fn, d, declares, scope );
        }
        else if( stmt instanceof TirAssignmentStmt )
        {
            this.walkExpr( stmt.assignedExpr, fn, scope );
        }
        else if( stmt instanceof TirAssertStmt )
        {
            this.walkExpr( stmt.condition, fn, scope );
            this.walkExpr( stmt.elseExpr, fn, scope );
        }
        else if( stmt instanceof TirIfStmt )
        {
            this.walkExpr( stmt.condition, fn, scope );
            d.children = this.walkBranch( stmt.thenBranch, fn, d, scope );
            if( stmt.elseBranch ) d.children.push( ...this.walkBranch( stmt.elseBranch, fn, d, scope ) );
        }
        else if( stmt instanceof TirMatchStmt )
        {
            this.walkExpr( stmt.matchExpr, fn, scope );
            for( const c of stmt.cases )
            {
                const armScope = scope.slice();
                this.declare( c.pattern, "pattern", fn, d, declares, armScope );
                d.children.push( ...this.walkBranch( c.body, fn, d, armScope ) );
            }
            if( stmt.wildcardCase ) d.children.push( ...this.walkBranch( stmt.wildcardCase.body, fn, d, scope ) );
        }
        else if( stmt instanceof TirForStmt )
        {
            const loopScope = scope.slice();
            for( const init of stmt.init )
            {
                this.walkExpr( init.initExpr, fn, loopScope );
                this.declare( init, init.isConst ? "const" : "let", fn, d, declares, loopScope );
            }
            const loop = this.loopFunction( fn, d );
            if( stmt.condition )
            {
                const [ cond ] = this.newStmt( undefined, "expr", stmt.condition.range, loop, undefined, loopScope );
                this.walkExpr( stmt.condition, loop, loopScope );
                loop.stmts.push( cond );
            }
            loop.stmts.push( ...this.walkLoopBody( stmt.body, loop, loopScope ) );
            for( const u of stmt.update ?? [] ) loop.stmts.push( this.walkStmt( u, loop, undefined, loopScope.slice() ) );
        }
        else if( stmt instanceof TirForOfStmt )
        {
            this.walkExpr( stmt.iterable, fn, scope );
            const loopScope = scope.slice();
            const loop = this.loopFunction( fn, d );
            // the element: declared at the start of every iteration
            const [ elem, elemDeclares ] = this.newStmt( stmt.elemDeclaration, "var", stmt.elemDeclaration.range, loop, undefined, loopScope );
            for( const nested of nestedDecls( stmt.elemDeclaration ) ) this.dbg.stmtOf.set( nested, elem );
            this.declare( stmt.elemDeclaration, "const", loop, elem, elemDeclares, loopScope );
            loop.stmts.push( elem, ...this.walkLoopBody( stmt.body, loop, loopScope ) );
        }
        else if( stmt instanceof TirWhileStmt )
        {
            const loopScope = scope.slice();
            const loop = this.loopFunction( fn, d );
            const [ cond ] = this.newStmt( undefined, "expr", stmt.condition.range, loop, undefined, loopScope );
            this.walkExpr( stmt.condition, loop, loopScope );
            loop.stmts.push( cond, ...this.walkLoopBody( stmt.body, loop, loopScope ) );
        }
        else if( stmt instanceof TirReturnStmt )
        {
            this.walkExpr( stmt.value, fn, scope );
        }
        else if( stmt instanceof TirFailStmt )
        {
            this.walkExpr( stmt.failMsgExpr, fn, scope );
        }
        else if( stmt instanceof TirTraceStmt )
        {
            this.walkExpr( stmt.expr, fn, scope );
        }
        return d;
    }

    private loopFunction( fn: DebugFunction, loopStmt: MutableStmt ): MutableFunction
    {
        const loop = this.newFunction( fn.name, loopStmt.range, "loop", fn, loopStmt, loopStmt, false );
        loopStmt.loop = loop;
        return loop;
    }

    private walkLoopBody( body: TirStmt, loop: DebugFunction, loopScope: readonly DebugVar[] ): DebugStmt[]
    {
        if( body instanceof TirBlockStmt ) return this.walkBlock( body.stmts, loop, undefined, loopScope.slice() );
        return [ this.walkStmt( body, loop, undefined, loopScope.slice() ) ];
    }

    /** the statement whose expressions `walkExpr` walks: closures there are defined at it */
    private exprStmt: DebugStmt | undefined = undefined;

    /** finds the functions written inside an expression (closures) */
    private walkExpr( expr: TirExpr | undefined, fn: DebugFunction, scope: readonly DebugVar[] ): void
    {
        if( expr === undefined || expr === null ) return;
        if( expr instanceof TirFuncExpr )
        {
            if( isUserRange( expr.range ) )
            {
                const at = this.exprStmt;
                this.walkFunction( expr, fn, scope, "function", at );
                this.exprStmt = at;
            }
            return;
        }
        if( expr instanceof TirCallExpr )
        {
            this.walkExpr( expr.func, fn, scope );
            for( const arg of expr.args ) this.walkExpr( arg, fn, scope );
        }
        else if( expr instanceof TirPropAccessExpr ) this.walkExpr( expr.object, fn, scope );
        else if( expr instanceof TirCaseExpr )
        {
            this.walkExpr( expr.matchExpr, fn, scope );
            for( const c of expr.cases ) this.walkExpr( c.body, fn, scope );
            if( expr.wildcardCase ) this.walkExpr( expr.wildcardCase.body, fn, scope );
        }
        else if( expr instanceof TirElemAccessExpr )
        {
            this.walkExpr( expr.arrLikeExpr, fn, scope );
            this.walkExpr( expr.indexExpr, fn, scope );
        }
        else if( expr instanceof TirTernaryExpr )
        {
            this.walkExpr( expr.condition, fn, scope );
            this.walkExpr( expr.ifTrue, fn, scope );
            this.walkExpr( expr.ifFalse, fn, scope );
        }
        else if( expr instanceof TirLitNamedObjExpr )
        {
            for( const v of expr.values ) this.walkExpr( v, fn, scope );
        }
        else if(
            expr instanceof TirParentesizedExpr ||
            expr instanceof TirTypeConversionExpr ||
            expr instanceof TirFromDataExpr ||
            expr instanceof TirToDataExpr
        ) this.walkExpr( ( expr as any ).expr, fn, scope );
        else if( expr instanceof TirLettedExpr ) this.walkExpr( expr.expr, fn, scope );
        else if( expr instanceof TirAssertAndContinueExpr )
        {
            this.walkExpr( ( expr as any ).condition, fn, scope );
            this.walkExpr( ( expr as any ).continuation, fn, scope );
        }
        else if( expr instanceof TirTraceIfFalseExpr )
        {
            this.walkExpr( ( expr as any ).condition, fn, scope );
            this.walkExpr( ( expr as any ).traceMsg, fn, scope );
        }
        else if( expr instanceof TirTraceExpr )
        {
            this.walkExpr( ( expr as any ).traceMsg, fn, scope );
            this.walkExpr( ( expr as any ).continuation, fn, scope );
        }
        else if( isTirBinaryExpr( expr ) )
        {
            this.walkExpr( ( expr as any ).left, fn, scope );
            this.walkExpr( ( expr as any ).right, fn, scope );
        }
        else if( isTirUnaryPrefixExpr( expr ) ) this.walkExpr( ( expr as any ).operand, fn, scope );
    }
}

function kindOf( stmt: TirStmt ): DebugStmtKind
{
    if(
        stmt instanceof TirSimpleVarDecl ||
        stmt instanceof TirNamedDeconstructVarDecl ||
        stmt instanceof TirSingleDeconstructVarDecl ||
        stmt instanceof TirArrayLikeDeconstr
    ) return "var";
    if( stmt instanceof TirAssignmentStmt ) return "assign";
    if( stmt instanceof TirAssertStmt ) return "assert";
    if( stmt instanceof TirIfStmt ) return "if";
    if( stmt instanceof TirMatchStmt ) return "match";
    if( stmt instanceof TirReturnStmt ) return "return";
    if( stmt instanceof TirFailStmt ) return "fail";
    if( stmt instanceof TirTraceStmt ) return "trace";
    if( stmt instanceof TirForStmt ) return "for";
    if( stmt instanceof TirForOfStmt ) return "forOf";
    if( stmt instanceof TirWhileStmt ) return "while";
    if( stmt instanceof TirBreakStmt ) return "break";
    if( stmt instanceof TirContinueStmt ) return "continue";
    if( stmt instanceof TirBlockStmt ) return "block";
    return "expr";
}

/** the names a declaration introduces */
function leafDecls( decl: TirVarDecl ): TirSimpleVarDecl[]
{
    if( decl instanceof TirSimpleVarDecl ) return [ decl ];
    if( decl instanceof TirNamedDeconstructVarDecl || decl instanceof TirSingleDeconstructVarDecl )
    return [ ...decl.fields.values() ].flatMap( f => leafDecls( f ) );
    if( decl instanceof TirArrayLikeDeconstr ) return decl.elements.flatMap( e => leafDecls( e ) );
    return [];
}

/** the destructuring patterns nested in a declaration */
function nestedDecls( decl: TirVarDecl ): TirVarDecl[]
{
    const fields = (
        decl instanceof TirNamedDeconstructVarDecl || decl instanceof TirSingleDeconstructVarDecl ? [ ...decl.fields.values() ] :
        decl instanceof TirArrayLikeDeconstr ? decl.elements :
        []
    );
    return fields
        .filter( f => !( f instanceof TirSimpleVarDecl ) )
        .flatMap( f => [ f, ...nestedDecls( f ) ] );
}

/** the methods of the contracts of `source`: frames inside them are named after them */
function collectRegions( source: Source, dbg: DebugCollector ): void
{
    for( let stmt of source.statements as any[] )
    {
        if( stmt instanceof ExportStmt ) stmt = stmt.stmt;
        if(!( stmt instanceof ContractDecl )) continue;
        const add = ( purpose: string, methods: readonly any[] ) => {
            for( const m of methods ) dbg.regions.push({ name: m.expr.name.text, purpose, range: m.range });
        };
        add( "spend", stmt.spendMethods );
        add( "mint", stmt.mintMethods );
        add( "certify", stmt.certifyMethods );
        add( "withdraw", stmt.withdrawMethods );
        add( "propose", stmt.proposeMethods );
        add( "vote", stmt.voteMethods );
        add( "guard", stmt.guardMethods );
        for( const state of stmt.stateDecls ) add( "spend", state.spendMethods );
    }
}
