import type { UPLCTerm } from "@harmoniclabs/uplc";
import type { IRTerm } from "../IRTerm";
import type { DebugBinding } from "../../compiler/debug/DebugInfo";
import { currentCompilationCtx } from "../CompilationCtx";
import { IRNodeKind } from "../IRNodeKind";
import { unionBindings } from "./unionBindings";

/*
 * Debug information on IR nodes (see `compiler/debug`): no-ops unless the compilation collects it.
 */

/** `node` computes the value of `bindings`' variables */
export function stampVarValue( node: IRTerm, bindings: readonly DebugBinding[] | undefined ): void
{
    if( bindings === undefined || bindings.length === 0 ) return;
    const meta = node.meta as { varValue?: readonly DebugBinding[] };
    meta.varValue = unionBindings( meta.varValue, bindings );
}

/**
 * `replacement` takes the place of `replaced`: when that is a variable holding source
 * variables (a beta reduction), the replacement now computes their value
 */
export function noteVarReplaced( replacement: IRTerm, replaced: IRTerm | undefined ): void
{
    const dbg = currentCompilationCtx().debug;
    if( dbg === undefined || replaced === undefined || replaced.kind !== IRNodeKind.Var ) return;
    stampVarValue( replacement, dbg.bindingsOfSymbol( ( replaced as any ).name ) );
}

/** the lambda `lambda` binds the IR variable `sym` */
export function noteLambdaBinding( lambda: UPLCTerm, sym: symbol ): void
{
    const ctx = currentCompilationCtx();
    if( ctx.debug !== undefined ) ctx.debug.lambdaBinds.set( lambda, sym );
    // removed traces with computed messages read their values through the lambdas
    if( ctx.strippedTraces !== undefined ) ctx.lambdaSymbols.set( lambda, sym );
}

/** whether debug information is being collected */
export function collectingDebugInfo(): boolean
{
    return currentCompilationCtx().debug !== undefined;
}
