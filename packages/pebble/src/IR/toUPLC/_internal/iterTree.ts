import { IRApp } from "../../IRNodes/IRApp";
import { IRCase } from "../../IRNodes/IRCase";
import { IRConstr } from "../../IRNodes/IRConstr";
import { IRDelayed } from "../../IRNodes/IRDelayed";
import { IRForced } from "../../IRNodes/IRForced";
import { IRFunc } from "../../IRNodes/IRFunc";
import { IRHoisted } from "../../IRNodes/IRHoisted";
import { IRLetted } from "../../IRNodes/IRLetted";
import { IRRecursive } from "../../IRNodes/IRRecursive";
import { IRTerm } from "../../IRTerm";
import { sanifyTree } from "../subRoutines/sanifyTree";

/**
 * Visits every term of `_term`, a term before the terms it holds.
 *
 * `fn` may replace the term it is given in its parent, and must then return `true`: the
 * parent holds other terms than the ones this walk was about to visit, so those are
 * forgotten and the parent is visited again, with what it holds now.
 *
 * ONLY those: the terms still to visit that the PARENT holds. Whatever else is waiting
 * belongs to a term further up — the other branches of a `case` the replaced term is deep
 * inside of, the other fields of a `constr` — and is still to be visited. (This used to
 * forget every waiting term marked as "a later child of its parent", whoever the parent: a
 * term replaced anywhere inside the last branch of a `case` made the walk skip all the
 * other branches, so that a pass replacing something everywhere did it in one branch of
 * the program and left the rest as it was.)
 */
export function iterTree(
    _term: IRTerm,
    fn: ( elem: IRTerm, dbn: number ) => (boolean | undefined | void),
    // necessary for letted hash calculation (exclude hoisted)
    shouldSkipNode?: ( elem: IRTerm, dbn: number ) => boolean,
    shouldExit?: ( elem: IRTerm, dbn: number ) => boolean
): void
{
    const has_shouldSkipNode = typeof shouldSkipNode === "function";
    const has_shouldExit = typeof shouldExit === "function";
    /** `heldBy`: the term that was holding this one when it was added (none for the root) */
    const stack: { term: IRTerm, dbn: number, heldBy?: IRTerm }[] = [{ term: _term, dbn: 0 }];
    /** the depth each term that holds others was visited at: where to visit it again from */
    const dbnOf = new Map<IRTerm, number>();

    while( stack.length > 0 )
    {
        const { term: t, dbn } = stack.pop()!;

        if( has_shouldSkipNode && shouldSkipNode( t, dbn ) ) continue;

        const termParent = t.parent;
        const negDbn = t instanceof IRFunc || t instanceof IRRecursive ? t.arity : 0;

        const modifiedParent = fn( t, dbn ) === true;

        if( has_shouldExit && shouldExit( t, dbn ) ) return;

        if( modifiedParent && termParent !== undefined )
        {
            // what the parent was holding and is still waiting: not what it holds any more
            while( stack.length > 0 && stack[ stack.length - 1 ].heldBy === termParent ) stack.pop();
            // restart from the parent
            stack.push({ term: termParent, dbn: dbnOf.get( termParent ) ?? dbn - negDbn, heldBy: termParent.parent });
            continue;
        }

        dbnOf.set( t, dbn );

        if( t instanceof IRApp )
        {
            stack.push(
                { term: t.fn, dbn, heldBy: t },
                { term: t.arg, dbn, heldBy: t }
            );
            continue;
        }

        if( t instanceof IRCase )
        {
            stack.push(
                { term: t.constrTerm, dbn, heldBy: t },
                ...Array.from( t.continuations ).map( cont =>
                    ({ term: cont, dbn, heldBy: t as IRTerm })
                )
            );
            continue;
        }
        if( t instanceof IRConstr )
        {
            stack.push(
                ...Array.from( t.fields ).map( f =>
                    ({ term: f, dbn, heldBy: t as IRTerm })
                )
            );
            continue;
        }

        if( t instanceof IRDelayed )
        {
            stack.push({ term: t.delayed, dbn, heldBy: t })
            continue;
        }

        if( t instanceof IRForced )
        {
            stack.push({ term: t.forced, dbn, heldBy: t });
            continue;
        }

        if( t instanceof IRFunc )
        {
            stack.push({ term: t.body, dbn: dbn + t.arity, heldBy: t });
            continue;
        }

        if( t instanceof IRRecursive )
        {
            stack.push({ term: t.body, dbn: dbn + t.arity, heldBy: t });
            continue;
        }

        if( t instanceof IRHoisted )
        {
            // 0 because hoisted are closed
            // for hoisted we keep track of the depth inside the term
            stack.push({ term: t.hoisted, dbn: 0, heldBy: t });
            continue;
        }

        if( t instanceof IRLetted )
        {
            // same stuff as the hoisted terms
            // the only difference is that depth is then incremented
            // once the letted term reaches its final position
            stack.push({ term: t.value, dbn, heldBy: t });
            continue;
        }

        stack.push(...t.children().map( c => ({ term: c, dbn, heldBy: t as IRTerm }) ) );
    }
    sanifyTree( _term );
}
