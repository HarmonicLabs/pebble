import type { DebugBinding } from "../../compiler/debug/DebugInfo";

/** both lists' bindings, once each; never mutates them (clones share metadata) */
export function unionBindings(
    a: readonly DebugBinding[] | undefined,
    b: readonly DebugBinding[] | undefined
): readonly DebugBinding[] | undefined
{
    if( a === undefined || a.length === 0 ) return b;
    if( b === undefined || b.length === 0 || a === b ) return a;
    const extra = b.filter( x => !a.includes( x ) );
    return extra.length === 0 ? a : a.concat( extra );
}
