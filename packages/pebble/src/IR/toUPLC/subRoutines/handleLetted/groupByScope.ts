import { IRDelayed } from "../../../IRNodes/IRDelayed";
import { IRFunc } from "../../../IRNodes/IRFunc";
import { LettedSetEntry } from "../../../IRNodes/IRLetted";
import { IRRecursive } from "../../../IRNodes/IRRecursive";
import { IRSelfCall } from "../../../IRNodes/IRSelfCall";
import { IRVar } from "../../../IRNodes/IRVar";
import { IRTerm } from "../../../IRTerm";

type ScopedLettedTerms = {
    maxScope: IRTerm | undefined, // undefined is any scope (root)
    group: LettedSetEntry[]
}

export function groupByScope( letteds: LettedSetEntry[] ): ScopedLettedTerms[]
{
    const scopes: ScopedLettedTerms[] = [];

    function pushScope( scope: IRTerm | undefined, letted: LettedSetEntry )
    {
        const scopeEntry = scopes.find( entry => entry.maxScope === scope );
        if( scopeEntry === undefined )
        {
            scopes.push({
                maxScope: scope,
                group: [letted]
            });
            return;
        }
        scopeEntry.group.push( letted );
    }

    for( const { letted, nReferences } of letteds )
    {
        const maxScope: IRTerm | undefined = getMaxScope( letted.value );
        pushScope( maxScope, { letted, nReferences } )
    }

    return scopes;
}

export function getMaxScope( term: IRTerm ): IRTerm | undefined // (undefined is root)
{
    const unbounded = getUnboundedVars( term );

    if( unbounded.size === 0 ) return undefined;

    while( term.parent )
    {
        term = term.parent;
        if( term instanceof IRDelayed ) return term;
        if(
            term instanceof IRFunc
            || term instanceof IRRecursive
        ) {
            for( const param of term.params )
            {
                if( unbounded.has( param ) ) return term;
            } 
        }
    }

    throw new Error("Unbounded var not found in any parent term");
}

export function getUnboundedIRVars( term: IRTerm ): (IRVar | IRSelfCall)[]
{
    const result: (IRVar | IRSelfCall)[] = [];
    scopedWalk( term, undefined, ( t, bound ) => {
        if( !bound.has( t.name ) ) result.push( t );
    });
    return result;
}

export function getUnboundedVars( term: IRTerm, knownVars?: Set<symbol> | undefined ): Set<symbol>
{
    const accessedVars = new Set<symbol>();
    scopedWalk( term, knownVars, ( t, bound ) => {
        if( !bound.has( t.name ) ) accessedVars.add( t.name );
    });
    return accessedVars;
}

/**
 * Walk `term` calling `onVarLike` for every `IRVar`/`IRSelfCall` with the
 * set of symbols bound ON THE PATH to that occurrence.
 *
 * The previous implementations collected bound params in a single FLAT set
 * over the whole walk — a binder ANYWHERE in the term masked genuinely
 * FREE occurrences of the same symbol elsewhere (cloned IR reuses binder
 * symbols, so sibling fragments routinely bind the same symbol). That
 * under-reported free variables, which let the letted-placement anchoring
 * climb PAST a value's real binder and hoist open values to the root —
 * surfacing at lowering as "Variable not found in scope chain"
 * (GravityDex BUG 13).
 */
function scopedWalk(
    term: IRTerm,
    knownVars: Set<symbol> | undefined,
    onVarLike: ( t: IRVar | IRSelfCall, bound: ReadonlyMap<symbol, number> ) => void
): void
{
    const bound = new Map<symbol, number>();
    if( knownVars instanceof Set )
        for( const v of knownVars )
            if( typeof v === "symbol" ) bound.set( v, 1 );

    type ExitMarker = { exitParams: readonly symbol[] };
    const stack: ( IRTerm | ExitMarker )[] = [ term ];

    const boundHas = {
        has: ( sym: symbol ) => ( bound.get( sym ) ?? 0 ) > 0,
        get: ( sym: symbol ) => bound.get( sym ),
    } as unknown as ReadonlyMap<symbol, number>;

    while( stack.length > 0 )
    {
        const t = stack.pop()!;

        if( typeof (t as ExitMarker).exitParams !== "undefined" )
        {
            for( const p of (t as ExitMarker).exitParams )
            {
                const n = ( bound.get( p ) ?? 1 ) - 1;
                if( n <= 0 ) bound.delete( p );
                else bound.set( p, n );
            }
            continue;
        }

        const node = t as IRTerm;
        if(
            node instanceof IRVar
            || node instanceof IRSelfCall
        ) {
            onVarLike( node, boundHas );
            continue;
        }

        if(
            node instanceof IRFunc
            || node instanceof IRRecursive
        ) {
            for( const param of node.params ) bound.set( param, ( bound.get( param ) ?? 0 ) + 1 );
            // exit marker BELOW the body: params unbind once the body
            // subtree is fully visited
            stack.push( { exitParams: node.params.slice() } );
            stack.push( node.body );
            continue;
        }

        stack.push( ...node.children() );
    }
}