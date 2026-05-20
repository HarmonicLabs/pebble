/**
 * When the same list `L` is used for BOTH `headList(L)` and `tailList(L)`
 * within a single function body, those two builtin calls can be replaced
 * by a single `case L of cons h t -> body[h/headList(L), t/tailList(L)] |
 * nil -> error`. The trade-off (measured in `bench.headTailVsCase`):
 *
 *   - one `headList` (or `tailList`) builtin call: 112,100 CPU / 800 mem
 *   - one `case L of cons h t -> h | nil -> error`: 128,100 CPU / 900 mem
 *
 * So for a single access the builtin wins; for dual access the case wins
 * by a single dispatch (~96K CPU / 700 mem).
 *
 * This pass walks every `IRFunc` body bottom-up. For each body, it scans
 * the top-level (without descending into nested `IRFunc`/`IRRecursive`,
 * because nested scopes are processed independently). If a free list var
 * `L` has both a `headList(L)` and a `tailList(L)` use in the body, the
 * body is wrapped with `IRCase(IRVar(L), [IRFunc([h, t], body'), IRError])`
 * — where `body'` has those calls replaced with `IRVar(h)` / `IRVar(t)`.
 *
 * Notes:
 *   - We only act on `IRFunc` bodies that are NOT immediate continuations
 *     of an `IRCase` whose scrutinee is `IRVar(L)` for the same L — that
 *     case-cons branch already binds head/tail and the prior
 *     `rewriteHeadTailInCaseConsAndReturnRoot` pass has already done the
 *     substitution. Wrapping again would be a no-op constructor pair.
 *   - The nil branch is `IRError`. Original code that calls `headList` or
 *     `tailList` on a nil list errors at evaluation; the new code errors
 *     at the case dispatch — same observable behavior whenever either
 *     call is actually reached.
 *   - The pass iterates: after introducing a case for L, the (now
 *     substituted) body might still contain a different L' with dual
 *     head/tail uses — handled by re-scanning until no more pairs.
 */

import { IRApp } from "../../IRNodes/IRApp";
import { IRCase } from "../../IRNodes/IRCase";
import { IRError } from "../../IRNodes/IRError";
import { IRFunc } from "../../IRNodes/IRFunc";
import { IRHoisted } from "../../IRNodes/IRHoisted";
import { IRLetted } from "../../IRNodes/IRLetted";
import { IRNative } from "../../IRNodes/IRNative";
import { IRNativeTag } from "../../IRNodes/IRNative/IRNativeTag";
import { IRRecursive } from "../../IRNodes/IRRecursive";
import { IRTerm } from "../../IRTerm";
import { IRVar } from "../../IRNodes/IRVar";
import { _modifyChildFromTo } from "../_internal/_modifyChildFromTo";

function unwrap( t: IRTerm ): IRTerm
{
    while( t instanceof IRHoisted ) t = (t as IRHoisted).hoisted;
    while( t instanceof IRLetted ) t = (t as IRLetted).value;
    return t;
}

export function introduceCaseForDualHeadTailAndReturnRoot( term: IRTerm ): IRTerm
{
    processNode( term );
    return term;
}

function processNode( node: IRTerm ): void
{
    // Post-order: recurse into children first, then process this node.
    for( const child of node.children() ) processNode( child );

    if( node instanceof IRFunc )
    {
        // Avoid wrapping case-cons branches that the previous pass already
        // optimized: if `node` is the cons continuation of an outer
        // `IRCase(IRVar(L), [node, ...])`, then head(L)/tail(L) were
        // already substituted; if any dual remains it's for a *different*
        // list L', which we handle normally.
        tryWrap( node );
    }
}

function tryWrap( fn: IRFunc ): void
{
    while( true )
    {
        const choice = findFirstDualHeadTailList( fn.body, new Set( fn.params ) );
        if( choice === undefined ) return;

        const listSym = choice;
        const desc = listSym.description ?? "L";
        const hSym = Symbol( "h_" + desc );
        const tSym = Symbol( "t_" + desc );

        // Substitute head(L)/tail(L) inside the current body (won't descend
        // into nested scopes that re-bind L, h, or t — but we just minted
        // h/t so they don't collide with anything).
        substituteHeadTailInBody( fn.body, listSym, hSym, tSym );

        // Wrap.
        const oldBody = fn.body;
        const consFn = new IRFunc( [ hSym, tSym ], oldBody );
        const wrapped = new IRCase(
            new IRVar( listSym ),
            [ consFn, new IRError() ]
        );
        fn.body = wrapped;
    }
}

/**
 * Scan `root` for free `headList(L)`/`tailList(L)` uses where `L` is NOT
 * shadowed by an enclosing nested IRFunc/IRRecursive within `root`. Returns
 * the first list symbol with at least one head AND one tail use.
 */
function findFirstDualHeadTailList(
    root: IRTerm,
    boundInOuterFunc: Set<symbol>,
): symbol | undefined
{
    const heads = new Set<symbol>();
    const tails = new Set<symbol>();

    function walk( node: IRTerm, locallyBound: Set<symbol> ): void
    {
        if( node instanceof IRFunc )
        {
            const next = new Set( locallyBound );
            for( const p of node.params ) next.add( p );
            walk( node.body, next );
            return;
        }
        if( node instanceof IRRecursive )
        {
            const next = new Set( locallyBound );
            next.add( node.name );
            walk( node.body, next );
            return;
        }
        if( node instanceof IRApp )
        {
            const fn = unwrap( node.fn );
            const arg = node.arg;
            if(
                fn instanceof IRNative
                && arg instanceof IRVar
                && !locallyBound.has( arg.name )
                && (
                    fn.tag === IRNativeTag.headList
                    || fn.tag === IRNativeTag.tailList
                )
            ) {
                ( fn.tag === IRNativeTag.headList ? heads : tails ).add( arg.name );
                // do not descend further — this is a leaf for our purposes
                return;
            }
            // generic descent
        }
        for( const c of node.children() ) walk( c, locallyBound );
    }

    walk( root, boundInOuterFunc );

    for( const sym of heads )
    {
        if( tails.has( sym ) ) return sym;
    }
    return undefined;
}

/**
 * In-place: replace every `IRApp(unwrap=headList, IRVar(L))` /
 * `IRApp(unwrap=tailList, IRVar(L))` inside `root` with `IRVar(h)` /
 * `IRVar(t)`. Stops descending into any nested IRFunc/IRRecursive that
 * shadows `L`, `h`, or `t`.
 */
function substituteHeadTailInBody(
    root: IRTerm,
    listSym: symbol,
    hSym: symbol,
    tSym: symbol,
): void
{
    const stack: IRTerm[] = [ root ];
    while( stack.length > 0 )
    {
        const t = stack.pop()!;

        if( t instanceof IRFunc || t instanceof IRRecursive )
        {
            const params = t instanceof IRFunc ? t.params : [ (t as IRRecursive).name ];
            if(
                params.includes( listSym )
                || params.includes( hSym )
                || params.includes( tSym )
            ) continue;
        }

        if( t instanceof IRApp )
        {
            const fn = unwrap( t.fn );
            const arg = t.arg;
            if(
                fn instanceof IRNative
                && arg instanceof IRVar
                && arg.name === listSym
                && ( fn.tag === IRNativeTag.headList || fn.tag === IRNativeTag.tailList )
            ) {
                const newSym = fn.tag === IRNativeTag.headList ? hSym : tSym;
                const parent = t.parent;
                if( parent !== undefined )
                {
                    _modifyChildFromTo( parent, t, new IRVar( newSym ) );
                }
                continue;
            }
        }

        stack.push( ...t.children() );
    }
}
