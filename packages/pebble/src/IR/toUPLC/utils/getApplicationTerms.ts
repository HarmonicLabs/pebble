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
    // walking from the outermost application in, each node met holds the last arguments not
    // seen yet: an application its argument, a `case` applying its continuation the fields
    // of its `constr` (`[(case (constr 0 [x y]) [f]) z]` is `f x y z`). They are collected
    // last first and reversed once at the end: linear in the spine length (spines grow with
    // the program, and this helper runs at nearly every node of every rewrite pass)
    const reversed: IRTerm[] = [];
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
            reversed.push( term.arg );
            term = term.fn;
            continue;
        }
        if(
            term instanceof IRCase
            && term.continuations.length === 1
            && term.constrTerm instanceof IRConstr
            && Number( term.constrTerm.index ) === 0
        ) {
            const fields = term.constrTerm.fields;
            for( let i = fields.length - 1; i >= 0; i-- ) reversed.push( fields[i] );
            term = term.continuations[0];
            continue;
        }
        // if( term instanceof IRLetted ) term = term.value;
        // else if( term instanceof IRHoisted ) term = term.hoisted;
    }
    if( reversed.length === 0 ) return undefined;
    return {
        func: term,
        args: reversed.reverse(),
    };
}