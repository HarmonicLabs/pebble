import { IRApp } from "../../IRNodes/IRApp";
import { IRCase } from "../../IRNodes/IRCase";
import { IRConstr } from "../../IRNodes/IRConstr";
import { IRTerm } from "../../IRTerm";

export interface ApplicationTerms {
    func: IRTerm,
    args: IRTerm[],
}

export function getApplicationTerms( term: IRTerm ): ApplicationTerms | undefined
{
    // `unshift` always targets the absolute front and `push` the absolute
    // back, so accumulating the two separately and joining once at the end
    // is exactly equivalent to interleaving them on a single array — but
    // linear instead of quadratic in the spine length. Spines grow with the
    // program, and this helper runs at nearly every node of every rewrite
    // pass, so the quadratic showed up as super-linear compile work.
    const front: IRTerm[] = []; // prepended args, in reverse order
    const back: IRTerm[] = [];  // appended args, in order
    while(
        term instanceof IRApp
        || (
            term instanceof IRCase
            && term.continuations.length === 1
            && term.constrTerm instanceof IRConstr
            && Number( term.constrTerm.index ) === 0
        )
        // go "through" letted and hoisted
        // || term instanceof IRLetted
        // || term instanceof IRHoisted
    ) {
        if( term instanceof IRApp ) {
            front.push( term.arg );
            term = term.fn;
            continue;
        }
        if(
            term instanceof IRCase
            && term.continuations.length === 1
            && term.constrTerm instanceof IRConstr
            && Number( term.constrTerm.index ) === 0
        ) {
            for( const f of term.constrTerm.fields ) back.push( f );
            term = term.continuations[0];
            continue;
        }
        // if( term instanceof IRLetted ) term = term.value;
        // else if( term instanceof IRHoisted ) term = term.hoisted;
    }
    if( front.length === 0 && back.length === 0 ) return undefined;
    front.reverse();
    const args: IRTerm[] = back.length === 0 ? front : front.concat( back );
    return {
        func: term,
        args,
    };
}