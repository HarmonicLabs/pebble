import type { IRTerm } from "../IRTerm";
import { prettyIRInline } from "./showIR";

/** how many times the check ran: a test of the pipeline makes sure it did */
export const _debug_freshHashChecks = { done: 0 };

/** the term, as far as it fits a line or two */
function describe( t: IRTerm ): string
{
    try { return prettyIRInline( t ).replace( /\s+/g, " " ).slice( 0, 600 ); }
    catch { return "(the term cannot be shown)"; }
}

/**
 * Debug check (`PEBBLE_DBG_HASHES`): every hash a node of `root` remembers is the hash of the
 * term it is NOW, and a node that remembers one holds only nodes that do.
 *
 * The first is what makes the hash usable at all: two terms with equal hashes are bound once
 * (`handleLetted`, `handleHoisted`), so a node whose child was replaced without the node
 * being told (`markHashAsInvalid`) can be merged with a term it is no longer equal to. The
 * second is what lets the invalidation stop at the first node that remembers nothing.
 *
 * Then the hash of the whole tree is computed, so that every node remembers one: whichever
 * pass runs next has to invalidate what it changes, or the next check fails.
 *
 * @throws naming the stage after which a hash was found stale
 */
export function _debug_assertFreshHashes( root: IRTerm, stage: string ): void
{
    _debug_freshHashChecks.done++;

    // (a node whose hash is a constant has no field for it)
    const remembers = ( t: IRTerm ): boolean => !( "_hash" in ( t as any ) ) || ( t as any )._hash !== undefined;

    // children before their parents
    const stack: { term: IRTerm, seen: boolean }[] = [ { term: root, seen: false } ];
    while( stack.length > 0 )
    {
        const top = stack.pop()!;
        const t: any = top.term;
        if( !top.seen )
        {
            stack.push( { term: t, seen: true } );
            for( const child of t.children?.() ?? [] ) stack.push( { term: child, seen: false } );
            continue;
        }
        if( !( "_hash" in t ) || t._hash === undefined ) continue;

        for( const child of ( t.children?.() ?? [] ) as IRTerm[] )
        {
            if( !remembers( child ) ) throw new Error(
                `[PEBBLE_DBG_HASHES] after ${stage}: a ${t.constructor.name} remembers its hash, ` +
                `but the ${( child as any ).constructor.name} it holds does not\n` + describe( t )
            );
        }

        const remembered = t._hash;
        t._hash = undefined;
        // its children were checked already: this is the hash of what the node holds now
        const actual = t.hash;
        if( actual !== remembered ) throw new Error(
            `[PEBBLE_DBG_HASHES] after ${stage}: a ${t.constructor.name} remembers the hash ` +
            `${remembered} of a term it no longer is (now ${actual}): one of the terms it holds ` +
            `was replaced without 'markHashAsInvalid'\n` + describe( t )
        );
    }

    // from here on every node remembers a hash
    root.hash;
}
