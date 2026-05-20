/**
 * Inline single-use let-bindings of the shape `((λp. body) value)`:
 *
 *   - If `body` references `p` exactly once AND that reference is NOT
 *     trapped inside a nested closure (IRFunc/IRRecursive) within
 *     `body`, replace the entire app with `body[p := value]`. The
 *     nested-closure guard is critical: a use that's syntactically
 *     "once" inside a recursive body is actually evaluated once per
 *     iteration, and inlining there would move per-iteration work to a
 *     value the caller currently evaluates once.
 *   - If `body` references `p` zero times, drop the let and replace
 *     the app with `body`.
 *
 * IRCase continuations are themselves IRFunc nodes (case-cons branches
 * take h/t lambdas), but the case dispatches each continuation AT MOST
 * ONCE per case eval, so they don't count as "trapping" closures — we
 * treat IRFunc reached *as a direct case continuation* as transparent.
 *
 * If `body` uses `p` two or more times we don't inline either (would
 * duplicate the term in the output).
 */

import { IRApp } from "../../IRNodes/IRApp";
import { IRCase } from "../../IRNodes/IRCase";
import { IRConst } from "../../IRNodes/IRConst";
import { IRDelayed } from "../../IRNodes/IRDelayed";
import { IRFunc } from "../../IRNodes/IRFunc";
import { IRHoisted } from "../../IRNodes/IRHoisted";
import { IRLetted } from "../../IRNodes/IRLetted";
import { IRNative } from "../../IRNodes/IRNative";
import { IRRecursive } from "../../IRNodes/IRRecursive";
import { IRTerm } from "../../IRTerm";
import { IRVar } from "../../IRNodes/IRVar";
import { _modifyChildFromTo } from "../_internal/_modifyChildFromTo";

export function inlineSingleUseLetBindingsAndReturnRoot( term: IRTerm ): IRTerm
{
    // Iterate until a full pass finds nothing to rewrite. Each rewrite
    // restarts the walk from the (possibly new) root because the tree
    // shape near the rewrite changes and may expose further candidates.
    let didChange = true;
    while( didChange )
    {
        didChange = false;
        const stack: IRTerm[] = [ term ];
        outer: while( stack.length > 0 )
        {
            const t = stack.pop()!;

            if(
                t instanceof IRApp
                && t.fn instanceof IRFunc
                && t.fn.params.length === 1
            ) {
                const fn = t.fn;
                const p = fn.params[0];
                const value = t.arg;

                // Beta-reduce when the argument is itself just a
                // variable access. Replacing every `IRVar(p)` with
                // `IRVar(x)` costs the same per access (a single env
                // lookup either way) and saves the surrounding
                // `(λp. …) x` lambda + application. Always safe,
                // regardless of how many times `p` is used and
                // regardless of whether the uses sit inside a recursive
                // body — there's no work to multiply.
                if( value instanceof IRVar )
                {
                    const newBody = substituteAllVar( fn.body, p, value );
                    term = replaceWithBody( term, t, newBody );
                    didChange = true;
                    break outer;
                }

                const stats = countVarUses( fn.body, p );

                if( stats.count === 0 )
                {
                    // Dead let — replace with body, dropping the value.
                    term = replaceWithBody( term, t, fn.body );
                    didChange = true;
                    break outer;
                }
                if( stats.count === 1 && !stats.trapped )
                {
                    substituteVar( fn.body, p, value );
                    term = replaceWithBody( term, t, fn.body );
                    didChange = true;
                    break outer;
                }
                // Trapped single use: the lone occurrence sits inside a
                // nested closure (recursive body or non-case lambda).
                // Inlining a COMPUTATION there would duplicate the
                // per-iteration work, but a syntactic VALUE (closure /
                // constant / var / delay) only pays its (essentially
                // zero) construction cost — the same as a fresh lookup.
                // Pebble also stores recursive helpers as open-recursion
                // lambdas whose body references their own binding name;
                // inlining such a lambda would orphan that self-ref, so
                // also require that the value has no free `IRVar(p)`.
                if(
                    stats.count === 1
                    && stats.trapped
                    && isSyntacticValue( value )
                    && !containsFreeVar( value, p )
                ) {
                    substituteVar( fn.body, p, value );
                    term = replaceWithBody( term, t, fn.body );
                    didChange = true;
                    break outer;
                }
                // count >= 2, or trapped-with-computational-value → leave alone
            }

            stack.push( ...t.children() );
        }
    }
    return term;
}

/** Returns true if `term` contains a free `IRVar(p)` reference. A
 * binding inside `term` that re-uses `p`'s symbol shadows it (these
 * are rare given fresh-symbol minting, but the check is cheap). */
function containsFreeVar( term: IRTerm, p: symbol ): boolean
{
    const stack: IRTerm[] = [ term ];
    while( stack.length > 0 )
    {
        const t = stack.pop()!;
        if( t instanceof IRVar && t.name === p ) return true;
        if( t instanceof IRFunc && t.params.includes( p ) ) continue;
        if( t instanceof IRRecursive && t.name === p ) continue;
        stack.push( ...t.children() );
    }
    return false;
}

/**
 * A "syntactic value" is a term whose evaluation does no work beyond
 * binding/closure construction — duplicating it across a recursive
 * boundary doesn't multiply runtime cost. Specifically:
 *
 *   - `IRFunc` / `IRRecursive` — closure values; per-construction is
 *     ~zero cost, and the body only runs when the closure is applied
 *     (which happens at the use-site frequency either way).
 *   - `IRConst` — literal value.
 *   - `IRVar` — already just an environment lookup.
 *   - `IRDelayed` — produces a thunk; the inner term only runs on
 *     force, at the use-site frequency.
 *
 * NOTE: `IRNative` is deliberately NOT included. While a bare native
 * reference is itself cheap, in Pebble's pipeline `hoistForcedNatives`
 * specifically wraps each forced builtin (e.g. `headList`,
 * `tailList`, `ifThenElse`) once at the top via `(λvar. …) IRNative`,
 * so that the runtime `force` happens once and is shared. Inlining
 * the `IRNative` back into a recursive body undoes that sharing —
 * the resulting compiled UPLC re-issues the force per iteration.
 * `IRHoisted`/`IRLetted` are transparent wrappers: we unwrap to check
 * the inner term.
 */
function isSyntacticValue( t: IRTerm ): boolean
{
    while( t instanceof IRHoisted ) t = (t as IRHoisted).hoisted;
    while( t instanceof IRLetted ) t = (t as IRLetted).value;
    return (
        t instanceof IRFunc
        || t instanceof IRRecursive
        || t instanceof IRConst
        || t instanceof IRVar
        || t instanceof IRDelayed
    );
}

function replaceWithBody( root: IRTerm, app: IRTerm, body: IRTerm ): IRTerm
{
    const parent = app.parent;
    if( parent === undefined )
    {
        body.parent = undefined;
        return body;
    }
    _modifyChildFromTo( parent, app, body );
    return root;
}

type UseStats = {
    /** total syntactic uses (capped at 2). */
    count: 0 | 1 | 2;
    /** when count === 1, whether that use is trapped inside a nested
     *  closure (IRFunc-non-case-cont or IRRecursive) within `body`. */
    trapped: boolean;
};

/** Count IRVar(p) references in `body` accurately. Caps at 2 — we
 * only care about 0/1/many — but ALWAYS walks the whole tree, so we
 * correctly distinguish "1 trapped use" from "1 trapped + 1 more".
 */
function countVarUses( body: IRTerm, p: symbol ): UseStats
{
    let count = 0;
    let firstUseTrapped = false;

    type Frame = { node: IRTerm; trapped: boolean };
    const stack: Frame[] = [ { node: body, trapped: false } ];

    while( stack.length > 0 )
    {
        const { node: t, trapped } = stack.pop()!;

        if( t instanceof IRVar )
        {
            if( t.name === p )
            {
                if( count === 0 ) firstUseTrapped = trapped;
                count++;
                if( count >= 2 ) return { count: 2, trapped: false };
            }
            continue;
        }

        // Symbols are minted fresh on each binder, so shadowing is rare,
        // but the guard is cheap and protects against any reuse.
        if( t instanceof IRFunc && t.params.includes( p ) ) continue;
        if( t instanceof IRRecursive && t.name === p ) continue;

        // Determine the trap state for descending into this node:
        //   - IRRecursive always traps (loop introduces multi-eval).
        //   - IRFunc traps EXCEPT when it's a direct case continuation
        //     (`IRCase(_, […, this IRFunc, …])`): the case dispatches
        //     it at most once per case eval, so it's transparent.
        let childTrapped = trapped;
        if( t instanceof IRRecursive ) childTrapped = true;
        else if( t instanceof IRFunc )
        {
            const parent = t.parent;
            const isCaseContinuation =
                parent instanceof IRCase
                // direct continuation array membership
                && Array.from( parent.continuations ).includes( t );
            if( !isCaseContinuation ) childTrapped = true;
        }

        for( const c of t.children() ) stack.push( { node: c, trapped: childTrapped } );
    }
    return { count: count as 0 | 1, trapped: firstUseTrapped };
}

/**
 * Replace EVERY `IRVar(p)` inside `body` with a fresh clone of
 * `replacement`. Used for the var-arg beta-reduction: substituting one
 * variable name for another anywhere it appears.
 *
 * Returns the (possibly new) body. If `body` itself is `IRVar(p)`,
 * returns a fresh clone of `replacement` — the caller is responsible
 * for wiring it into the parent.
 */
function substituteAllVar( body: IRTerm, p: symbol, replacement: IRTerm ): IRTerm
{
    if( body instanceof IRVar && body.name === p )
    {
        return replacement.clone();
    }

    const stack: IRTerm[] = [ body ];
    while( stack.length > 0 )
    {
        const t = stack.pop()!;

        // Don't descend into scopes that shadow p (unique-symbol
        // invariant makes this rare, but the guard is cheap).
        if( t instanceof IRFunc && t.params.includes( p ) ) continue;
        if( t instanceof IRRecursive && t.name === p ) continue;

        // Snapshot children before mutating (children() returns a fresh
        // array, so the loop is stable across modifications).
        const children = t.children();
        for( const child of children )
        {
            if( child instanceof IRVar && child.name === p )
            {
                // `t` must be a parent term because we got `child` from
                // `t.children()`. Cast to satisfy the type checker.
                _modifyChildFromTo( t as any, child, replacement.clone() );
            }
            else
            {
                stack.push( child );
            }
        }
    }
    return body;
}

/** Replace the (single) IRVar(p) inside `body` with `replacement`. */
function substituteVar( body: IRTerm, p: symbol, replacement: IRTerm ): void
{
    const stack: IRTerm[] = [ body ];
    while( stack.length > 0 )
    {
        const t = stack.pop()!;

        if( t instanceof IRVar && t.name === p )
        {
            const parent = t.parent;
            if( parent !== undefined ) _modifyChildFromTo( parent, t, replacement );
            return;
        }

        if( t instanceof IRFunc && t.params.includes( p ) ) continue;
        if( t instanceof IRRecursive && t.name === p ) continue;

        stack.push( ...t.children() );
    }
}
