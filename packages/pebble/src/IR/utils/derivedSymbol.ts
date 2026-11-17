import { toHex } from "@harmoniclabs/uint8array-utils";
import { currentCompilationCtx } from "../CompilationCtx";
import type { IRHash } from "../IRHash";
import { hashVarSym } from "../IRNodes/utils/hashVarSym";

/**
 * The variable a rewrite introduces, AS A FUNCTION OF WHAT IT REWRITES.
 *
 * A term is in the tree once per use: a function called in four places is four copies of
 * one term, which `handleLetted` / `handleHoisted` recognize by their hash and bind ONCE.
 * The hash of a term reads its variables by identity, so the copies stay one term only as
 * long as every pass rewrites them into the same term — with the same variables. A pass that
 * gives each copy a variable of its own (`Symbol("_h")` at every site) leaves four terms
 * that differ in nothing but the names of what they bind: nothing recognizes them any more,
 * and the function is compiled once per call.
 *
 * So a rewrite never makes up a variable: it asks for the one that belongs to what it is
 * rewriting — the hash of the term BEFORE the rewrite, and whatever else tells two variables
 * of that term apart. Equal terms get equal variables, and are rewritten into equal terms.
 *
 * @param description the variable's name, for whoever reads the IR
 * @param from what the variable is derived from: hashes of terms, other variables, numbers
 */
export function derivedSymbol( description: string, ...from: ( IRHash | symbol | number )[] ): symbol
{
    let key = description;
    for( const part of from )
    {
        key += typeof part === "symbol" ? "|var:" + toHex( hashVarSym( part ) ) : "|" + String( part );
    }

    const derived = currentCompilationCtx().derivedSymbols;
    let sym = derived.get( key );
    if( sym === undefined )
    {
        sym = Symbol( description );
        derived.set( key, sym );
    }
    return sym;
}
