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
 *     at the case dispatch — the same observable behavior ONLY where one
 *     of the calls was certain to run. So the case goes around a term that
 *     cannot be evaluated without evaluating one of them (`wrapTarget`):
 *     the whole body when a call is reached unconditionally, otherwise the
 *     smallest term holding all the calls, when it reaches one
 *     unconditionally. Calls that are all behind branches (`h` in one arm,
 *     `t` in another) stay builtins.
 *
 *     (The case used to go around the whole body in every situation. With
 *     `if( c ) { const x = xs.head(); xs = xs.tail(); … }` in a loop it
 *     destructured `xs` on EVERY iteration, taken or not, and failed as
 *     soon as the list was empty — on a program that never read an empty
 *     list.)
 *   - The pass iterates: after introducing a case for L, the (now
 *     substituted) body might still contain a different L' with dual
 *     head/tail uses — handled by re-scanning until no more pairs.
 */

import { IRApp } from "../../IRNodes/IRApp";
import { IRCase } from "../../IRNodes/IRCase";
import { IRConstr } from "../../IRNodes/IRConstr";
import { IRError } from "../../IRNodes/IRError";
import { IRForced } from "../../IRNodes/IRForced";
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
    // lists whose head and tail are never certain to run: left as builtins
    const leftAlone = new Set<symbol>();
    while( true )
    {
        const usesByList = collectHeadTailUses( fn.body, new Set( fn.params ) );

        let listSym: symbol | undefined = undefined;
        let target: IRTerm | undefined = undefined;
        for( const [ sym, uses ] of usesByList )
        {
            if( leftAlone.has( sym ) ) continue;
            if( !uses.some( u => u.isHead ) || !uses.some( u => !u.isHead ) ) continue;
            target = wrapTarget( uses );
            if( target === undefined ) { leftAlone.add( sym ); continue; }
            listSym = sym;
            break;
        }
        if( listSym === undefined || target === undefined ) return;

        const desc = listSym.description ?? "L";
        const hSym = Symbol( "h_" + desc );
        const tSym = Symbol( "t_" + desc );

        // Substitute head(L)/tail(L) inside the target (won't descend
        // into nested scopes that re-bind L, h, or t — but we just minted
        // h/t so they don't collide with anything). Every use of L is
        // inside it: it holds them all.
        substituteHeadTailInBody( target, listSym, hSym, tSym );

        // Wrap.
        const isBody = target === fn.body;
        const parent = target.parent;
        const consFn = new IRFunc( [ hSym, tSym ], target );
        const wrapped = new IRCase(
            new IRVar( listSym ),
            [ consFn, new IRError() ]
        );
        if( isBody ) fn.body = wrapped;
        else _modifyChildFromTo( parent as any, target, wrapped );
    }
}

/** a `headList( L )` or `tailList( L )` and the terms it is in */
interface HeadTailUse {
    isHead: boolean;
    /** from the function's body (first) down to the call itself (last) */
    path: IRTerm[];
}

/**
 * `true` iff evaluating `parent` always evaluates `child`: the two sides of an
 * application, the fields of a `constr`, what a `case` matches, a forced term;
 * and the value of a letted (or hoisted) term, computed where it is placed,
 * which is never after a reference to it. NOT a branch of a `case`, the body
 * of a function, a delayed term.
 */
function alwaysEvaluates( parent: IRTerm, child: IRTerm ): boolean
{
    if(
        parent instanceof IRApp
        || parent instanceof IRConstr
        || parent instanceof IRForced
        || parent instanceof IRLetted
        || parent instanceof IRHoisted
    ) return true;
    if( parent instanceof IRCase ) return parent.constrTerm === child;
    return false;
}

/** whether evaluating `use.path[ from ]` always evaluates the call */
function runsWhenever( use: HeadTailUse, from: number ): boolean
{
    for( let i = from; i < use.path.length - 1; i++ )
    {
        if( !alwaysEvaluates( use.path[i], use.path[i + 1] ) ) return false;
    }
    return true;
}

/**
 * The term to put the case around, for the calls on one list: one that holds
 * them all and cannot be evaluated without evaluating one of them, so that
 * failing on an empty list there fails nothing that did not fail already.
 *
 * - the function's body, if a call runs whenever the body does (what this
 *   pass always did: unchanged where that was right);
 * - otherwise the smallest term holding all the calls, if one of them runs
 *   whenever it does (both calls in one arm of a branch);
 * - otherwise `undefined`: no such term.
 */
function wrapTarget( uses: HeadTailUse[] ): IRTerm | undefined
{
    if( uses.some( u => runsWhenever( u, 0 ) ) ) return uses[0].path[0];

    // the deepest term every path goes through
    let depth = 0;
    const first = uses[0].path;
    while(
        depth + 1 < first.length
        && uses.every( u => depth + 1 < u.path.length && u.path[ depth + 1 ] === first[ depth + 1 ] )
    ) depth++;
    // (a call is not the meeting point of two calls)
    if( uses.some( u => u.path.length - 1 === depth ) ) return undefined;

    return uses.some( u => runsWhenever( u, depth ) ) ? first[ depth ] : undefined;
}

/**
 * Scan `root` for free `headList(L)`/`tailList(L)` uses where `L` is NOT
 * shadowed by an enclosing nested IRFunc/IRRecursive within `root`. Returns
 * them by list symbol, each with the terms it is in.
 */
function collectHeadTailUses(
    root: IRTerm,
    boundInOuterFunc: Set<symbol>,
): Map<symbol, HeadTailUse[]>
{
    const uses = new Map<symbol, HeadTailUse[]>();
    const path: IRTerm[] = [];

    function walk( node: IRTerm, locallyBound: Set<symbol> ): void
    {
        path.push( node );
        try
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
                    let ofList = uses.get( arg.name );
                    if( !ofList ) uses.set( arg.name, ofList = [] );
                    ofList.push({ isHead: fn.tag === IRNativeTag.headList, path: path.slice() });
                    // do not descend further — this is a leaf for our purposes
                    return;
                }
                // generic descent
            }
            for( const c of node.children() ) walk( c, locallyBound );
        }
        finally { path.pop(); }
    }

    walk( root, boundInOuterFunc );
    return uses;
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
