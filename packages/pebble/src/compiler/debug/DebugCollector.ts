import type { UPLCTerm } from "@harmoniclabs/uplc";
import type { SourceRange } from "../../ast/Source/SourceRange";
import type { DebugBinding, DebugFunction, DebugRegion, DebugStmt, DebugStructure, DebugVar } from "./DebugInfo";
import { currentCompilationCtx } from "../../IR/CompilationCtx";


/**
 * Debug information of the compilation in flight (`CompilationCtx.debug`), filled in three
 * stages:
 *
 * 1. `collectDebugStructure` walks the typed program before `expressify` rewrites its
 *    statements: functions, statements, variables, scopes;
 * 2. `expressify` and the TIR to IR conversion say which symbol (or letted value) holds each
 *    variable (`bindSymbol`, `linkDecl`);
 * 3. the IR to UPLC conversion records which lambda binds which symbol (`lambdaBinds`).
 */
export class DebugCollector
{
    readonly functions: DebugFunction[] = [];
    readonly stmts: DebugStmt[] = [];
    readonly vars: DebugVar[] = [];
    readonly regions: DebugRegion[] = [];

    /** TIR function (and its body block) -> function */
    readonly fnOf = new WeakMap<object, DebugFunction>();
    /** TIR statement -> statement */
    readonly stmtOf = new WeakMap<object, DebugStmt>();
    /** TIR declaration -> variable */
    readonly varOf = new WeakMap<object, DebugVar>();

    private readonly declBindings = new WeakMap<object, DebugBinding>();
    private readonly symBindings = new Map<symbol, DebugBinding[]>();
    private readonly derivedBindings = new Map<string, DebugBinding>();
    private readonly stmtsByRange = new Map<string, DebugStmt>();

    /** `Lambda` term -> the symbol it binds */
    readonly lambdaBinds = new Map<UPLCTerm, symbol>();

    structure(): DebugStructure
    {
        return {
            functions: this.functions,
            stmts: this.stmts,
            vars: this.vars,
            regions: this.regions,
        };
    }

    addStmt( stmt: DebugStmt ): void
    {
        this.stmts.push( stmt );
        // the first statement with a range wins: an enclosing one is added before what it encloses
        const key = rangeKey( stmt.range );
        if( !this.stmtsByRange.has( key ) ) this.stmtsByRange.set( key, stmt );
    }

    /** the statement with exactly this range (the TIR passes some statements' ranges, not the statements) */
    stmtAtRange( range: SourceRange ): DebugStmt | undefined
    {
        return this.stmtsByRange.get( rangeKey( range ) );
    }

    /** the binding of a declaration the walk saw, or one `linkDecl` linked */
    bindingOfDecl( decl: object ): DebugBinding | undefined
    {
        let b = this.declBindings.get( decl );
        if( b !== undefined ) return b;
        const v = this.varOf.get( decl );
        if( v === undefined ) return undefined;
        b = { v, kind: "decl", stmt: undefined };
        this.declBindings.set( decl, b );
        return b;
    }

    /** `decl` (made by a compiler pass) holds `binding`'s variable */
    linkDecl( decl: object, binding: DebugBinding | undefined ): void
    {
        if( binding !== undefined ) this.declBindings.set( decl, binding );
    }

    /** the symbol (an IR variable, or a letted value's name) holds `binding`'s variable */
    bindSymbol( sym: symbol, binding: DebugBinding | undefined ): void
    {
        if( binding === undefined ) return;
        const list = this.symBindings.get( sym );
        if( list === undefined ) this.symBindings.set( sym, [ binding ] );
        else if( !list.includes( binding ) ) list.push( binding );
    }

    bindingsOfSymbol( sym: symbol ): readonly DebugBinding[] | undefined
    {
        return this.symBindings.get( sym );
    }

    /** the variable named `tirName` where `stmt` starts, or that `stmt` declares */
    varInScope( stmt: DebugStmt, tirName: string ): DebugVar | undefined
    {
        const declares = stmt.declares;
        for( let i = declares.length - 1; i >= 0; i-- ) if( declares[i].tirName === tirName ) return declares[i];
        for( let i = stmt.scope.length - 1; i >= 0; i-- ) if( stmt.scope[i].tirName === tirName ) return stmt.scope[i];
        return undefined;
    }

    /**
     * the binding of the value `tirName` holds after `stmt` (an assignment, or a branch or loop
     * that changed it); one per statement and variable
     */
    assignBinding( stmt: DebugStmt | undefined, tirName: string ): DebugBinding | undefined
    {
        return this.derivedBinding( stmt, tirName, "assign" );
    }

    /** the binding of the value `tirName` has when an iteration of loop `stmt` starts */
    loopBinding( stmt: DebugStmt | undefined, tirName: string ): DebugBinding | undefined
    {
        return this.derivedBinding( stmt, tirName, "loop" );
    }

    private derivedBinding( stmt: DebugStmt | undefined, tirName: string, kind: "assign" | "loop" ): DebugBinding | undefined
    {
        if( stmt === undefined ) return undefined;
        const key = kind + ":" + stmt.id + ":" + tirName;
        let b = this.derivedBindings.get( key );
        if( b !== undefined ) return b;
        const v = this.varInScope( stmt, tirName );
        if( v === undefined ) return undefined;
        b = { v, kind, stmt };
        this.derivedBindings.set( key, b );
        return b;
    }
}

function rangeKey( range: SourceRange ): string
{
    return range.source.uid + ":" + range.start + ":" + range.end;
}

/** the debug information being collected, `undefined` when the compilation does not collect it */
export function currentDebug(): DebugCollector | undefined
{
    return currentCompilationCtx().debug;
}
