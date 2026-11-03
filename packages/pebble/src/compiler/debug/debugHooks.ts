import type { SourceRange } from "../../ast/Source/SourceRange";
import type { TirLettedExpr } from "../tir/expressions/TirLettedExpr";
import type { DebugBinding } from "./DebugInfo";
import { currentDebug } from "./DebugCollector";

/*
 * Where the compiler passes say which IR symbol holds which source variable. Each is a no-op
 * unless the compilation collects debug information (see `DebugCollector`).
 */

/** the IR variable `sym` holds the variable `decl` declares */
export function debugBindDecl( sym: symbol, decl: object | undefined ): void
{
    const dbg = currentDebug();
    if( dbg === undefined || decl === undefined ) return;
    dbg.bindSymbol( sym, dbg.bindingOfDecl( decl ) );
}

/** the letted value `letted` holds `binding`'s variable */
export function debugBindLetted( letted: TirLettedExpr | undefined, binding: DebugBinding | undefined ): void
{
    const dbg = currentDebug();
    if( dbg === undefined || letted === undefined ) return;
    dbg.bindSymbol( letted.irVarSym, binding );
}

/** the binding of the variable `decl` declares */
export function debugDeclBinding( decl: object | undefined ): DebugBinding | undefined
{
    if( decl === undefined ) return undefined;
    return currentDebug()?.bindingOfDecl( decl );
}

/** the value `tirName` holds after the statement `tirStmt` (or the statement with range `stmtRange`) */
export function debugAssignBinding( tirStmt: object | undefined, tirName: string, stmtRange?: SourceRange ): DebugBinding | undefined
{
    const dbg = currentDebug();
    if( dbg === undefined ) return undefined;
    const stmt = ( tirStmt !== undefined ? dbg.stmtOf.get( tirStmt ) : undefined )
        ?? ( stmtRange !== undefined ? dbg.stmtAtRange( stmtRange ) : undefined );
    return dbg.assignBinding( stmt, tirName );
}

/** the value `tirName` has when an iteration of the loop `tirLoopStmt` starts */
export function debugLoopBinding( tirLoopStmt: object, tirName: string ): DebugBinding | undefined
{
    const dbg = currentDebug();
    if( dbg === undefined ) return undefined;
    return dbg.loopBinding( dbg.stmtOf.get( tirLoopStmt ), tirName );
}

/** `decl`, made by a compiler pass, holds `binding`'s variable */
export function debugLinkDecl( decl: object, binding: DebugBinding | undefined ): void
{
    currentDebug()?.linkDecl( decl, binding );
}

/** `copy` (a rewritten statement or function) is the same statement or function as `original` */
export function debugLinkCopy( copy: object, original: object ): void
{
    const dbg = currentDebug();
    if( dbg === undefined || copy === original ) return;
    const stmt = dbg.stmtOf.get( original );
    if( stmt !== undefined && !dbg.stmtOf.has( copy ) ) dbg.stmtOf.set( copy, stmt );
    const fn = dbg.fnOf.get( original );
    if( fn !== undefined && !dbg.fnOf.has( copy ) ) dbg.fnOf.set( copy, fn );
}

/** the TIR function of loop `tirLoopStmt` is `loopFunc` (and its clones, which share its body) */
export function debugLinkLoopFunction( loopFunc: { body: object }, tirLoopStmt: object ): void
{
    const dbg = currentDebug();
    if( dbg === undefined ) return;
    const loop = dbg.stmtOf.get( tirLoopStmt )?.loop;
    if( loop === undefined ) return;
    dbg.fnOf.set( loopFunc, loop );
    dbg.fnOf.set( loopFunc.body, loop );
}
