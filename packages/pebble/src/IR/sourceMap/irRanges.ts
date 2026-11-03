import type { SourceRange } from "../../ast/Source/SourceRange";
import type { IRTerm } from "../IRTerm";
import type { BaseIRMetadata, IRFnEntryMeta } from "../IRNodes/BaseIRMetadata";
import { unionBindings } from "./unionBindings";
import { collectingDebugInfo } from "./irDebug";
import { IRHoisted } from "../IRNodes/IRHoisted";
import { IRLetted } from "../IRNodes/IRLetted";
import { IRNodeKind } from "../IRNodeKind";

/*
 * Source ranges on IR nodes, for sourcemaps. Four rules keep them right:
 *
 * 1. stamp:   the IR of a source expression takes the expression's range (`stampRange`)
 * 2. inherit: a node that replaces another takes its range and markers (`inheritRange`)
 * 3. merge:   nodes with equal hashes that collapse into one keep only what they agree on (`mergeRanges`)
 * 4. clone:   `clone()` keeps `meta`
 *
 * `undefined` means "unknown"; `null` means "deliberately none": the node stands for
 * several source sites, and nothing may give it one of them.
 */

export function irMeta( node: IRTerm ): BaseIRMetadata
{
    // every node class exposes an object; `IRConst` and `IRNative` create it lazily
    return node.meta as BaseIRMetadata;
}

/** whether `range` points at source text (synthetic nodes carry `SourceRange.mock`) */
export function isSourceRange( range: SourceRange | null | undefined ): range is SourceRange
{
    return (
        range !== null &&
        range !== undefined &&
        range.start >= 0 &&
        range.end >= range.start &&
        range.source !== undefined
    );
}

/**
 * `ir` is the IR of a source expression whose range is `range`. The root takes the range
 * unless it is `null`, so the outermost expression whose IR root it is wins; descendants with
 * no range take it too. The walk stops at nodes that have a range, `null` included, and does
 * not enter hoisted or letted values: those are definitions shared by every use.
 */
export function stampRange( ir: IRTerm, range: SourceRange | undefined ): void
{
    if( !isSourceRange( range ) ) return;
    const meta = irMeta( ir );
    if( meta.range !== null ) meta.range = range;
    fillRange( ir, range );
}

/** gives `range` to the descendants of `root` that have none, as `stampRange` does */
export function fillRange( root: IRTerm, range: SourceRange | null ): void
{
    const stack: IRTerm[] = childrenToFill( root );
    while( stack.length > 0 )
    {
        const node = stack.pop()!;
        const meta = irMeta( node );
        if( meta.range !== undefined ) continue;
        meta.range = range;
        const children = childrenToFill( node );
        for( let i = 0; i < children.length; i++ ) stack.push( children[i] );
    }
}

function childrenToFill( node: IRTerm ): IRTerm[]
{
    if( node instanceof IRHoisted || node instanceof IRLetted ) return [];
    return node.children();
}

/**
 * `replacement` takes the place of `replaced` in the tree. Without a range of its own it
 * takes `replaced`'s, and so do its new descendants; the markers of `replaced` move to it,
 * because it now roots whatever `replaced` rooted.
 */
export function inheritRange( replacement: IRTerm, replaced: IRTerm | undefined ): void
{
    if( replaced === undefined || replacement === replaced ) return;
    const from = irMeta( replaced );
    const to = irMeta( replacement );
    // a function body put where a call stood: the optimizer inlined that call. Calls are
    // applications, or forces for functions without parameters, and they stand outside the
    // function (recursive functions are not inlined); inside it, the body only took the
    // place of its own glue, such as a binding. (clones share `fnEntry`: copy, never mutate)
    if(
        to.fnEntry &&
        to.fnEntry !== from.fnEntry &&
        to.fnEntry.callRange === undefined &&
        ( replaced.kind === IRNodeKind.App || replaced.kind === IRNodeKind.Forced ) &&
        isSourceRange( from.range ) &&
        !rangeWithin( from.range, to.fnEntry.range )
    )
    {
        to.fnEntry = { ...to.fnEntry, callRange: from.range };
    }
    if( to.range === undefined && from.range !== undefined )
    {
        to.range = from.range;
        fillRange( replacement, from.range );
    }
    if( from.fnEntry !== undefined && to.fnEntry === undefined )
    {
        to.fnEntry = from.fnEntry;
        from.fnEntry = undefined;
    }
    if( from.assertCond !== undefined && to.assertCond === undefined )
    {
        to.assertCond = from.assertCond;
        from.assertCond = undefined;
    }
    if( from.failRange !== undefined && to.failRange === undefined )
    {
        to.failRange = from.failRange;
        from.failRange = undefined;
    }
    // debug information: the replacement computes the same value, and starts what it started
    if( from.varValue !== undefined ) to.varValue = unionBindings( to.varValue, from.varValue );
    // a letted value copied where it is used keeps its own range; the use is another place
    // its evaluation stands for
    if(
        replaced.kind === IRNodeKind.Letted &&
        collectingDebugInfo() &&
        isSourceRange( from.range ) &&
        isSourceRange( to.range ) &&
        !sameRange( to.range, from.range )
    ) to.useRanges = unionRanges( to.useRanges, [ from.range ] );
    if( from.useRanges !== undefined && from !== to ) to.useRanges = unionRanges( to.useRanges, from.useRanges );
    if( from.loopEntry !== undefined && to.loopEntry === undefined )
    {
        to.loopEntry = from.loopEntry;
        from.loopEntry = undefined;
    }
}

/**
 * `kept` and `dropped` have the same hash, and `kept` now stands for both. Walking the two
 * trees together, a range they disagree on becomes `null` (unknown on one side keeps the
 * other), and so does a marker.
 */
export function mergeRanges( kept: IRTerm, dropped: IRTerm ): void
{
    if( kept === dropped ) return;
    const stack: [ IRTerm, IRTerm ][] = [ [ kept, dropped ] ];
    while( stack.length > 0 )
    {
        const [ a, b ] = stack.pop()!;
        const ma = irMeta( a );
        const mb = irMeta( b );

        if( ma.range === undefined ) ma.range = mb.range;
        else if( mb.range !== undefined && !sameRange( ma.range, mb.range ) ) ma.range = null;

        if( ma.fnEntry !== undefined || mb.fnEntry !== undefined )
        ma.fnEntry = mergeFnEntry( ma.fnEntry, mb.fnEntry );

        if( !sameRange( ma.assertCond, mb.assertCond ) ) ma.assertCond = null;
        if( !sameRange( ma.failRange, mb.failRange ) ) ma.failRange = null;

        // equal hashes compute equal values: the kept node computes both nodes' variables
        if( mb.varValue !== undefined ) ma.varValue = unionBindings( ma.varValue, mb.varValue );
        if( mb.useRanges !== undefined ) ma.useRanges = unionRanges( ma.useRanges, mb.useRanges );
        if( ma.loopEntry !== mb.loopEntry ) ma.loopEntry = null;

        const ca = a.children();
        const cb = b.children();
        // equal hashes mean equal shapes; stay safe if not
        if( ca.length !== cb.length ) continue;
        for( let i = 0; i < ca.length; i++ ) stack.push([ ca[i], cb[i] ]);
    }
}

function mergeFnEntry(
    a: IRFnEntryMeta | null | undefined,
    b: IRFnEntryMeta | null | undefined
): IRFnEntryMeta | null | undefined
{
    // a body in one copy and a plain expression in the other: not a function entry anymore
    if( !a || !b ) return undefined;
    if(
        a.name === b.name &&
        sameRange( a.range, b.range ) &&
        sameRange( a.callRange, b.callRange ) &&
        a.debugFn === b.debugFn
    ) return a;
    // copies standing for different calls stand for no call in particular
    const merged: IRFnEntryMeta = { name: a.name === b.name ? a.name : null, range: a.range };
    if( a.callRange && sameRange( a.callRange, b.callRange ) ) merged.callRange = a.callRange;
    if( a.debugFn === b.debugFn && a.debugFn !== undefined ) merged.debugFn = a.debugFn;
    return merged;
}

function rangeWithin( inner: SourceRange, outer: SourceRange ): boolean
{
    return inner.source === outer.source && inner.start >= outer.start && inner.end <= outer.end;
}

function unionRanges( a: readonly SourceRange[] | undefined, b: readonly SourceRange[] ): readonly SourceRange[]
{
    if( a === undefined || a.length === 0 ) return b;
    const extra = b.filter( r => !a.some( x => sameRange( x, r ) ) );
    return extra.length === 0 ? a : a.concat( extra );
}

/**
 * The failure dropped branches stood for: the range the failing branches agree on, `null`
 * when they disagree, `fallback` when none has one
 */
export function failRangeOfDropped( dropped: readonly IRTerm[], fallback?: SourceRange ): SourceRange | null | undefined
{
    let found: SourceRange | null | undefined = undefined;
    for( const d of dropped )
    {
        const r = irMeta( d ).range;
        if( !isSourceRange( r ) ) continue;
        if( found === undefined ) found = r;
        else if( found !== null && !sameRange( found, r ) ) found = null;
    }
    return found ?? ( isSourceRange( fallback ) ? fallback : undefined );
}

export function sameRange( a: SourceRange | null | undefined, b: SourceRange | null | undefined ): boolean
{
    if( a === b ) return true;
    if( !a || !b ) return false;
    return a.source === b.source && a.start === b.start && a.end === b.end;
}
