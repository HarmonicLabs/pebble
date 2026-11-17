import { IRApp } from "../../IRNodes/IRApp";
import { IRFunc } from "../../IRNodes/IRFunc";
import { IRHoisted } from "../../IRNodes/IRHoisted";
import { IRRecursive } from "../../IRNodes/IRRecursive";
import { IRSelfCall } from "../../IRNodes/IRSelfCall";
import { IRVar } from "../../IRNodes/IRVar";
import { IRTerm } from "../../IRTerm";
import { getChildren } from "../../tree_utils/getChildren";
import { _modifyChildFromTo } from "../_internal/_modifyChildFromTo";

/**
 * `λ recBody. recBody recBody`: what a recursive function is applied through.
 *
 * ONE variable for all of them: with a variable of its own, each recursive function of a
 * program would get a term of its own, equal to the others in everything but that name, and
 * `handleHoisted` — which binds once the terms with the same hash — would see as many
 * different terms as there are recursive functions.
 */
const recBody = Symbol("recBody");

export function handleRecursiveTerms( term: IRTerm ): void
{
    if( term instanceof IRRecursive )
    {
        const bodyPtr = term.body;
        const self = term.name;
        _modifyChildFromTo(
            term.parent!,
            term,
            new IRApp(
                new IRHoisted(
                    new IRFunc( [ recBody ],
                        new IRApp( new IRVar( recBody ), new IRVar( recBody ) )
                    )
                ),
                new IRFunc( [ self ], bodyPtr )
            )
        );
        handleRecursiveTerms( bodyPtr );
        return;
    }
    if( term instanceof IRSelfCall )
    {
        _modifyChildFromTo(
            term.parent!,
            term,
            new IRApp( new IRVar( term.name ), new IRVar( term.name ) )
        );
        return;
    }
    getChildren( term ).forEach( handleRecursiveTerms );
}

export function handleRootRecursiveTerm( term: IRTerm ): IRTerm
{
    if( term instanceof IRRecursive )
    {
        const bodyPtr = term.body;
        const self = term.name;
        const newRoot = new IRApp(
            new IRHoisted(
                new IRFunc( [ recBody ],
                    new IRApp( new IRVar( recBody ), new IRVar( recBody ) )
                )
            ),
            new IRFunc( [ self ], bodyPtr )
        );
        handleRecursiveTerms( bodyPtr );
        return newRoot;
    }
    // else
    handleRecursiveTerms( term );
    return term;
}