import { IRApp } from "../../IRNodes/IRApp";
import { IRCase } from "../../IRNodes/IRCase";
import { IRConstr } from "../../IRNodes/IRConstr";
import { IRFunc } from "../../IRNodes/IRFunc";
import { IRNative } from "../../IRNodes/IRNative";
import { IRNativeTag } from "../../IRNodes/IRNative/IRNativeTag";
import { IRVar } from "../../IRNodes/IRVar";
import { IRTerm } from "../../IRTerm";
import { _modifyChildFromTo } from "../_internal/_modifyChildFromTo";
import { IRForced } from "../../IRNodes/IRForced";
import { IRHoisted } from "../../IRNodes/IRHoisted";
import { IRLetted } from "../../IRNodes/IRLetted";

/**
 * Eliminates data decode-after-encode round trips that struct
 * construction + immediate consumption produce, e.g. (observed in
 * compiled output, see the-cardano-masterpiece BENCHMARK_ANALYSIS.md):
 *
 *     sndPair( unConstrData( constrData( 0, mkCons( x, mkCons( iData( unIData( d ) ), [] ) ) ) ) )
 *
 * Only the ALWAYS-SAFE direction is rewritten — decoding a value that was
 * just encoded (the encoder is total, so the decoder cannot fail and is
 * the identity):
 *
 *   unIData( iData( x ) )        -> x        (same for bData/listData/mapData/valueData)
 *   headList( mkCons( x, xs ) )  -> x
 *   tailList( mkCons( x, xs ) )  -> xs
 *   fstPair( unConstrData( constrData( i, xs ) ) ) -> i
 *   sndPair( unConstrData( constrData( i, xs ) ) ) -> xs
 *   fstPair( mkPairData( a, b ) ) -> a
 *   sndPair( mkPairData( a, b ) ) -> b
 *
 * The reverse (encode-after-decode, e.g. `iData( unIData( d ) )`) is NOT
 * rewritten on its own: removing it would drop the decoder's validation of
 * untrusted data. The safe rules cascade to clean those up anyway whenever
 * the surrounding construction is itself consumed.
 *
 * Builtin HEADS are resolved through the lexical environment: by the time
 * the adjacencies materialize (post letted/hoisted drain), pre-forced
 * builtins like `sndPair` are VARIABLES bound to `(force (force native))`
 * values — the walk tracks `[(λ p body) v]` / grouped case-constr bindings
 * and resolves a var head to its bound native. Rewrites only replace the
 * APPLICATION node with one of its argument subtrees, so sharing is never
 * broken.
 */

const DECODE_TO_ENCODE: Partial<Record<number, number>> = {
    [IRNativeTag.unIData]: IRNativeTag.iData,
    [IRNativeTag.unBData]: IRNativeTag.bData,
    [IRNativeTag.unListData]: IRNativeTag.listData,
    [IRNativeTag.unMapData]: IRNativeTag.mapData,
    [IRNativeTag.unValueData]: IRNativeTag.valueData,
};

type Env = Map<symbol, IRTerm>;

interface Spine { head: IRTerm; args: IRTerm[]; }

function spineOf( term: IRTerm ): Spine {
    // built with `push` + a single `reverse` rather than `unshift` per
    // argument: `unshift` moves the whole array each time, making spine
    // collection quadratic in the spine length (and spines grow with the
    // program, so this showed up as super-linear compile work).
    const args: IRTerm[] = [];
    let head: IRTerm = term;
    while( head instanceof IRApp ) {
        args.push( head.arg );
        head = head.fn;
    }
    args.reverse();
    return { head, args };
}

function nativeTagOf( head: IRTerm, env: Env ): number | undefined {
    let t: IRTerm | undefined = head;
    // resolve variable heads through the lexical environment (bounded to
    // avoid cycles; alias chains are short)
    for( let hops = 0; hops < 8 && t instanceof IRVar; hops++ )
        t = env.get( t.name );
    if( t === undefined ) return undefined;
    while( t instanceof IRForced ) t = t.forced;
    while( t instanceof IRHoisted || t instanceof IRLetted )
        t = t instanceof IRHoisted ? t.hoisted : t.value;
    while( t instanceof IRForced ) t = t.forced;
    if( t instanceof IRNative ) return t.tag;
    return undefined;
}

/** the replacement for `term` if a safe round-trip rule applies, else undefined */
function rewriteOnce( term: IRTerm, env: Env ): IRTerm | undefined {
    if( !( term instanceof IRApp ) ) return undefined;
    const { head, args } = spineOf( term );
    const tag = nativeTagOf( head, env );
    if( tag === undefined ) return undefined;

    // unX( X( v ) ) -> v
    const enc = DECODE_TO_ENCODE[ tag ];
    if( enc !== undefined && args.length === 1 ) {
        const inner = spineOf( args[0] );
        if( nativeTagOf( inner.head, env ) === enc && inner.args.length === 1 )
            return inner.args[0];
        return undefined;
    }

    if( ( tag === IRNativeTag.headList || tag === IRNativeTag.tailList ) && args.length === 1 ) {
        const inner = spineOf( args[0] );
        if( nativeTagOf( inner.head, env ) === IRNativeTag.mkCons && inner.args.length === 2 )
            return tag === IRNativeTag.headList ? inner.args[0] : inner.args[1];
        return undefined;
    }

    if( ( tag === IRNativeTag.fstPair || tag === IRNativeTag.sndPair ) && args.length === 1 ) {
        const inner = spineOf( args[0] );
        const innerTag = nativeTagOf( inner.head, env );
        if( innerTag === IRNativeTag.mkPairData && inner.args.length === 2 )
            return tag === IRNativeTag.fstPair ? inner.args[0] : inner.args[1];
        if( innerTag === IRNativeTag.unConstrData && inner.args.length === 1 ) {
            const inner2 = spineOf( inner.args[0] );
            if( nativeTagOf( inner2.head, env ) === IRNativeTag.constrData && inner2.args.length === 2 )
                return tag === IRNativeTag.fstPair ? inner2.args[0] : inner2.args[1];
        }
        return undefined;
    }

    return undefined;
}

export function eliminateDataRoundTripsAndReturnRoot( term: IRTerm ): IRTerm
{
    // recursive walk carrying the lexical binding environment.
    // returns the (possibly replaced) node.
    const walk = ( t: IRTerm, env: Env ): IRTerm => {
        // apply rules at this node until none fires
        for(;;) {
            const replacement = rewriteOnce( t, env );
            if( replacement === undefined ) break;
            const parent = t.parent;
            if( parent !== undefined ) _modifyChildFromTo( parent, t, replacement );
            else replacement.parent = undefined;
            t = replacement;
        }

        // grouped binding: (case (constr 0 [v1..vn]) [(λ p1..pn body)])
        if(
            t instanceof IRCase
            && t.constrTerm instanceof IRConstr
            && t.continuations.length === 1
            && t.continuations[0] instanceof IRFunc
            && ( t.continuations[0] as IRFunc ).params.length === t.constrTerm.fields.length
        )
        {
            const constr = t.constrTerm as IRConstr;
            const fn = t.continuations[0] as IRFunc;
            const newFields: IRTerm[] = [];
            for( let i = 0; i < constr.fields.length; i++ )
                newFields.push( walk( constr.fields[i], env ) );
            const innerEnv = new Map( env );
            for( let i = 0; i < fn.params.length; i++ )
                innerEnv.set( fn.params[i], newFields[i] );
            walk( fn.body, innerEnv );
            return t;
        }

        // curried binding: [(λ p1..pn body) a1 .. an]
        if( t instanceof IRApp )
        {
            const { head, args } = spineOf( t );
            if( head instanceof IRFunc && head.params.length === args.length && args.length > 0 )
            {
                const newArgs = args.map( a => walk( a, env ) );
                const innerEnv = new Map( env );
                for( let i = 0; i < head.params.length; i++ )
                    innerEnv.set( head.params[i], newArgs[i] );
                walk( head.body, innerEnv );
                return t;
            }
        }

        // generic descent: lambda params SHADOW anything bound above
        if( t instanceof IRFunc )
        {
            const innerEnv = new Map( env );
            for( const p of t.params ) innerEnv.delete( p );
            walk( t.body, innerEnv );
            return t;
        }

        for( const child of t.children?.() ?? [] ) walk( child, env );
        return t;
    };

    // run to a fixpoint: a cascade can expose new adjacencies above
    for( let i = 0; i < 8; i++ )
    {
        const before = term;
        term = walk( term, new Map() );
        // walk replaces in place via parents; the root only changes if the
        // root itself was rewritten
        if( term === before ) break;
    }
    return term;
}
