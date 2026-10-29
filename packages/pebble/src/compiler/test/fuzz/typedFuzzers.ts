import { Data, DataB, DataConstr, DataI, DataList, DataMap, DataPair } from "@harmoniclabs/plutus-data";
import { Constr, ConstType, constT, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { toHex } from "@harmoniclabs/uint8array-utils";
import { PRNG } from "./PRNG";
import { TirType } from "../../tir/types/TirType";
import { getUnaliased } from "../../tir/types/utils/getUnaliased";
import { TirIntT } from "../../tir/types/TirNativeType/native/int";
import { TirBoolT } from "../../tir/types/TirNativeType/native/bool";
import { TirBytesT } from "../../tir/types/TirNativeType/native/bytes";
import { TirStringT } from "../../tir/types/TirNativeType/native/string";
import { TirDataT } from "../../tir/types/TirNativeType/native/data";
import { TirVoidT } from "../../tir/types/TirNativeType/native/void";
import { TirListT } from "../../tir/types/TirNativeType/native/list";
import { TirLinearMapT } from "../../tir/types/TirNativeType/native/linearMap";
import { TirValueT } from "../../tir/types/TirNativeType/native/value";
import { TirDataOptT } from "../../tir/types/TirNativeType/native/Optional/data";
import { TirSopOptT } from "../../tir/types/TirNativeType/native/Optional/sop";
import { TirEnumType } from "../../tir/types/TirEnumType";
import { TirDataStructType, TirSoPStructType, TirStructType, isTirStructType } from "../../tir/types/TirStructType";

/**
 * A single sampled input value for a property-test parameter.
 *
 * - `term()` is the UPLC term to apply as the test argument: a plain
 *   constant for const-representable types, a `Constr` term for
 *   SoP-encoded values (UPLC >= 1.2).
 * - `runtime()` is the raw UPLC constant value (used for list/map element
 *   aggregation and for reporting scalar inputs); it throws for SoP values.
 * - `data()` is the `Data` encoding (the representation a field of a
 *   `data struct` has).
 *
 * The generator only ever calls the views that are valid for how the
 * sample is consumed — `defaultFuzzerUnsupportedReason` guarantees this
 * before any sampling happens.
 *
 * `shrinks()` returns strictly-"smaller" candidate samples, best first;
 * the runner walks them greedily to minimize a failing input tuple.
 */
export interface TypedSample {
    show: string;
    term(): UPLCTerm;
    runtime(): any;
    data(): Data;
    shrinks(): TypedSample[];
}

/** depth at which aggregate generators switch to minimal shapes */
const SOFT_MAX_DEPTH = 3;
/** absolute recursion backstop: reaching it is a generator bug, not user error */
const HARD_MAX_DEPTH = 32;

/**
 * Returns `undefined` when `t` has a built-in fuzzer whose samples can be
 * passed as an argument to the compiled test; otherwise a human-readable
 * reason (used in the skip message).
 */
export function defaultFuzzerUnsupportedReason( t: TirType ): string | undefined
{
    return _unsupportedReason( t, "runtime", new Set() );
}

/**
 * Returns `undefined` when a value of type `t` produced by a `via` fuzzer
 * (i.e. the CEK-evaluation result of the fuzzer application) is a plain
 * UPLC constant that can be re-applied as a test argument.
 */
export function viaResultUnsupportedReason( t: TirType ): string | undefined
{
    const u = getUnaliased( t ) ?? t;
    if(
        u instanceof TirSoPStructType
        || u instanceof TirSopOptT
    ) return (
        `runtime (SoP) encoded type '${t.toString()}' cannot be produced by a 'via' fuzzer; ` +
        `declare the type as a 'data' struct (or use a data-encoded equivalent) so the ` +
        `fuzzer result is a plain constant`
    );
    return undefined;
}

function _unsupportedReason(
    t: TirType,
    mode: "runtime" | "data",
    visiting: Set<string>
): string | undefined
{
    const u = getUnaliased( t ) ?? t;

    if(
        u instanceof TirIntT
        || u instanceof TirBoolT
        || u instanceof TirBytesT
        || u instanceof TirStringT
        || u instanceof TirDataT
        || u instanceof TirVoidT
        || u instanceof TirEnumType
        || u instanceof TirValueT
    ) return undefined;

    if( u instanceof TirDataOptT || u instanceof TirSopOptT )
    // either encoding carries a data-encoded payload
    // (SoP optionals hold their `Some` payload as raw data by convention)
    return _unsupportedReason( u.typeArg, "data", visiting );

    if( u instanceof TirListT )
    {
        if( mode === "runtime" )
        {
            // runtime lists are UPLC list constants: elements must be
            // const-representable (not SoP)
            const elem = getUnaliased( u.typeArg ) ?? u.typeArg;
            if( elem instanceof TirSoPStructType || elem instanceof TirSopOptT )
            return (
                `type '${t.toString()}' has no default fuzzer: its elements are ` +
                `runtime (SoP) encoded and cannot appear in a UPLC list constant`
            );
        }
        return _unsupportedReason( u.typeArg, mode, visiting );
    }

    if( u instanceof TirLinearMapT )
    return (
        _unsupportedReason( u.keyTypeArg, "data", visiting )
        ?? _unsupportedReason( u.valTypeArg, "data", visiting )
    );

    if( u instanceof TirDataStructType || u instanceof TirSoPStructType )
    {
        const fieldMode = u instanceof TirDataStructType ? "data" : mode;
        // recursive structs terminate through the minimal-constructor
        // choice at depth; don't recurse forever while *checking*
        const key = u.toTirTypeKey();
        if( visiting.has( key ) ) return undefined;
        visiting.add( key );
        for( const ctor of u.constructors )
        for( const field of ctor.fields )
        {
            const r = _unsupportedReason( field.type as TirType, fieldMode, visiting );
            if( r !== undefined ) return r;
        }
        visiting.delete( key );
        return undefined;
    }

    return `type '${t.toString()}' has no default fuzzer`;
}

/**
 * Samples a value for a test parameter of type `t`.
 *
 * Callers MUST have validated the type first (`defaultFuzzerUnsupportedReason`
 * returned `undefined`); an unsupported type throws here.
 */
export function sampleForType( t: TirType, prng: PRNG ): TypedSample
{
    return _sample( t, prng, 0 );
}

function _sample( t: TirType, prng: PRNG, depth: number ): TypedSample
{
    if( depth > HARD_MAX_DEPTH )
    throw new Error(
        "typedFuzzers: recursion depth exceeded while sampling type '" + t.toString() + "'"
    );

    const u = getUnaliased( t ) ?? t;

    if( u instanceof TirIntT ) return mkIntSample( prng.nextIntBiased() );
    if( u instanceof TirBoolT ) return mkBoolSample( prng.nextBool() );
    if( u instanceof TirBytesT ) return mkBytesSample( prng.nextBytes() );
    if( u instanceof TirStringT ) return mkStrSample( _nextAsciiString( prng ) );
    if( u instanceof TirVoidT ) return mkUnitSample();
    if( u instanceof TirDataT ) return mkDataSample( _nextData( prng, depth ) );

    if( u instanceof TirEnumType )
    {
        const idx = u.members.length > 0 ? prng.next32() % u.members.length : 0;
        return mkEnumSample( u, idx );
    }

    if( u instanceof TirDataOptT || u instanceof TirSopOptT )
    {
        const sop = u instanceof TirSopOptT;
        // None more likely at depth so recursive optionals stay small
        const someProb = depth >= SOFT_MAX_DEPTH ? 0 : 2;
        const isSome = ( prng.next32() % 3 ) < someProb;
        if( !isSome ) return mkNoneSample( sop );
        return mkSomeSample( _sample( u.typeArg, prng, depth + 1 ), sop );
    }

    if( u instanceof TirListT )
    {
        const len = _nextLength( prng, depth );
        const elems: TypedSample[] = new Array( len );
        for( let i = 0; i < len; i++ ) elems[i] = _sample( u.typeArg, prng, depth + 1 );
        return mkListSample( elems, u.typeArg.toUplcConstType() );
    }

    if( u instanceof TirLinearMapT )
    {
        const len = _nextLength( prng, depth );
        const entries: [ TypedSample, TypedSample ][] = new Array( len );
        for( let i = 0; i < len; i++ )
        entries[i] = [
            _sample( u.keyTypeArg, prng, depth + 1 ),
            _sample( u.valTypeArg, prng, depth + 1 )
        ];
        return mkLinearMapSample( entries );
    }

    if( u instanceof TirValueT ) return mkValueSample( prng );

    if( u instanceof TirDataStructType || u instanceof TirSoPStructType )
    return _sampleStruct( u, prng, depth );

    throw new Error(
        "typedFuzzers: no generator for type '" + t.toString() + "'"
    );
}

function _sampleStruct( t: TirStructType, prng: PRNG, depth: number ): TypedSample
{
    const ctors = t.constructors;
    let ctorIdx: number;
    if( ctors.length === 0 )
    throw new Error( "typedFuzzers: struct '" + t.toString() + "' has no constructors" );

    if( depth >= SOFT_MAX_DEPTH )
    {
        // minimal shape: the constructor with the fewest fields,
        // preferring one that doesn't reference the struct itself
        // (recursive structs must terminate)
        let best = 0;
        let bestScore = Infinity;
        for( let i = 0; i < ctors.length; i++ )
        {
            const selfRef = ctors[i].fields.some( f =>
                isTirStructType( getUnaliased( f.type as TirType ) )
                && ( getUnaliased( f.type as TirType ) as TirStructType ).toTirTypeKey() === t.toTirTypeKey()
            );
            const score = ctors[i].fields.length + ( selfRef ? 1000 : 0 );
            if( score < bestScore ) { bestScore = score; best = i; }
        }
        ctorIdx = best;
    }
    else ctorIdx = prng.next32() % ctors.length;

    const ctor = ctors[ ctorIdx ];
    const fields = ctor.fields.map( f => ({
        name: f.name,
        sample: _sample( f.type as TirType, prng, depth + 1 )
    }));

    const isSop = t instanceof TirSoPStructType;
    const untagged = t instanceof TirDataStructType && t.untagged === true;
    const show =
        ( ctors.length > 1 ? t.name + "." + ctor.name : t.name )
        + "{ " + fields.map( f => f.name + ": " + f.sample.show ).join( ", " ) + " }";

    return {
        show,
        term(): UPLCTerm {
            if( isSop )
            // SoP structs carry raw runtime field values
            return new Constr( ctorIdx, fields.map( f => f.sample.term() ) );
            return UPLCConst.data( this.data() );
        },
        runtime() {
            if( isSop )
            throw new Error( "SoP struct sample has no constant representation" );
            return this.data();
        },
        data(): Data {
            const fieldData = fields.map( f => f.sample.data() );
            return untagged
                ? new DataList( fieldData )
                : new DataConstr( ctorIdx, fieldData );
        },
        shrinks() { return []; },
    };
}

// ─── scalar samples ────────────────────────────────────────────────────

function mkIntSample( v: bigint ): TypedSample
{
    return {
        show: v.toString(),
        term() { return UPLCConst.int( v ); },
        runtime() { return v; },
        data() { return new DataI( v ); },
        shrinks() {
            if( v === 0n ) return [];
            // toward zero, log-convergent: 0, v/2, then approach v from
            // below by shrinking the gap (v - v/4, v - v/8, ..., v - 1)
            const out: bigint[] = [ 0n ];
            const half = v / 2n;
            if( half !== 0n && half !== v ) out.push( half );
            const sign = v > 0n ? 1n : -1n;
            const abs = v > 0n ? v : -v;
            for( let gap = abs / 4n; gap > 0n; gap /= 2n )
            {
                const cand = sign * ( abs - gap );
                if( cand !== 0n && cand !== v && !out.includes( cand ) ) out.push( cand );
            }
            const dec = sign * ( abs - 1n );
            if( dec !== 0n && dec !== v && !out.includes( dec ) ) out.push( dec );
            return out.map( mkIntSample );
        },
    };
}

function mkBoolSample( v: boolean ): TypedSample
{
    return {
        show: v ? "true" : "false",
        term() { return UPLCConst.bool( v ); },
        runtime() { return v; },
        // convention from `_boolToData`: true = Constr 0, false = Constr 1
        data() { return new DataConstr( v ? 0 : 1, [] ); },
        shrinks() { return v ? [ mkBoolSample( false ) ] : []; },
    };
}

function mkBytesSample( bs: Uint8Array ): TypedSample
{
    return {
        show: "#" + toHex( bs ),
        term() { return UPLCConst.byteString( bs ); },
        runtime() { return bs; },
        data() { return new DataB( bs ); },
        shrinks() {
            if( bs.length === 0 ) return [];
            const out: TypedSample[] = [ mkBytesSample( new Uint8Array( 0 ) ) ];
            const half = bs.slice( 0, bs.length >> 1 );
            if( half.length > 0 ) out.push( mkBytesSample( half ) );
            return out;
        },
    };
}

function mkStrSample( s: string ): TypedSample
{
    return {
        show: JSON.stringify( s ),
        term() { return UPLCConst.str( s ); },
        runtime() { return s; },
        data() { return new DataB( new TextEncoder().encode( s ) ); },
        shrinks() {
            if( s.length === 0 ) return [];
            const out: TypedSample[] = [ mkStrSample( "" ) ];
            const half = s.slice( 0, s.length >> 1 );
            if( half.length > 0 ) out.push( mkStrSample( half ) );
            return out;
        },
    };
}

function mkUnitSample(): TypedSample
{
    return {
        show: "()",
        term() { return UPLCConst.unit; },
        runtime() { return undefined; },
        data() { return new DataConstr( 0, [] ); },
        shrinks() { return []; },
    };
}

function mkEnumSample( t: TirEnumType, idx: number ): TypedSample
{
    return {
        show: t.name + "." + ( t.members[ idx ] ?? String( idx ) ),
        term() { return UPLCConst.int( idx ); },
        runtime() { return BigInt( idx ); },
        data() { return new DataI( idx ); },
        shrinks() { return idx > 0 ? [ mkEnumSample( t, 0 ) ] : []; },
    };
}

function mkDataSample( d: Data ): TypedSample
{
    return {
        show: _showData( d ),
        term() { return UPLCConst.data( d ); },
        runtime() { return d; },
        data() { return d; },
        shrinks() {
            if( d instanceof DataI && d.int === 0n ) return [];
            return [ mkDataSample( new DataI( 0 ) ) ];
        },
    };
}

// ─── aggregate samples ─────────────────────────────────────────────────

function mkNoneSample( sop: boolean ): TypedSample
{
    return {
        show: "None",
        term() {
            return sop
                ? new Constr( 1, [] )
                : UPLCConst.data( this.data() );
        },
        runtime() {
            if( sop ) throw new Error( "SoP optional sample has no constant representation" );
            return this.data();
        },
        data() { return new DataConstr( 1, [] ); },
        shrinks() { return []; },
    };
}

function mkSomeSample( inner: TypedSample, sop: boolean ): TypedSample
{
    return {
        show: "Some( " + inner.show + " )",
        term() {
            // SoP optionals hold their `Some` payload as raw DATA by
            // convention (consumers decode on extraction)
            return sop
                ? new Constr( 0, [ UPLCConst.data( inner.data() ) ] )
                : UPLCConst.data( this.data() );
        },
        runtime() {
            if( sop ) throw new Error( "SoP optional sample has no constant representation" );
            return this.data();
        },
        data() { return new DataConstr( 0, [ inner.data() ] ); },
        shrinks() {
            return [
                mkNoneSample( sop ),
                ...inner.shrinks().map( s => mkSomeSample( s, sop ) )
            ];
        },
    };
}

function mkListSample( elems: TypedSample[], elemConstT: ConstType ): TypedSample
{
    return {
        show: "[" + elems.map( e => e.show ).join( ", " ) + "]",
        term() { return UPLCConst.listOf( elemConstT )( this.runtime() ); },
        runtime() { return elems.map( e => e.runtime() ); },
        data() { return new DataList( elems.map( e => e.data() ) ); },
        shrinks() {
            if( elems.length === 0 ) return [];
            const out: TypedSample[] = [ mkListSample( [], elemConstT ) ];
            const half = elems.slice( 0, elems.length >> 1 );
            if( half.length > 0 ) out.push( mkListSample( half, elemConstT ) );
            out.push( mkListSample( elems.slice( 0, elems.length - 1 ), elemConstT ) );
            return out;
        },
    };
}

function mkLinearMapSample( entries: [ TypedSample, TypedSample ][] ): TypedSample
{
    const constTy = constT.listOf( constT.pairOf( constT.data, constT.data ) );
    return {
        show: "{ " + entries.map( ([ k, v ]) => k.show + ": " + v.show ).join( ", " ) + " }",
        term() { return new UPLCConst( constTy, this.runtime() ); },
        runtime() {
            // runtime repr: `list (pair data data)`
            return entries.map( ([ k, v ]) => ({ fst: k.data(), snd: v.data() }) );
        },
        data() {
            return new DataMap(
                entries.map( ([ k, v ]) => new DataPair( k.data(), v.data() ) )
            );
        },
        shrinks() {
            if( entries.length === 0 ) return [];
            const out: TypedSample[] = [ mkLinearMapSample( [] ) ];
            const half = entries.slice( 0, entries.length >> 1 );
            if( half.length > 0 ) out.push( mkLinearMapSample( half ) );
            return out;
        },
    };
}

function mkValueSample( prng: PRNG ): TypedSample
{
    // keep values canonical and small: lovelace entry (2/3 of the time)
    // plus at most one single-asset policy
    const roll = prng.next32() % 3;
    const lovelaces = BigInt( prng.next32() );
    const entries: { policy: Uint8Array; name: Uint8Array; amount: bigint }[] = [];
    if( roll !== 0 )
    entries.push({ policy: new Uint8Array( 0 ), name: new Uint8Array( 0 ), amount: lovelaces + 1n });
    if( roll === 2 )
    {
        const policy = prng.nextBytesOfLength( 28 );
        const name = prng.nextBytesOfLength( ( prng.next32() % 8 ) + 1 );
        entries.push({ policy, name, amount: BigInt( prng.next32() ) + 1n });
    }
    return mkValueSampleFromEntries( entries );
}

function mkValueSampleFromEntries(
    entries: { policy: Uint8Array; name: Uint8Array; amount: bigint }[]
): TypedSample
{
    return {
        show: entries.length === 0
            ? "Value.zero"
            : "Value{ " + entries.map( e =>
                ( e.policy.length === 0 ? "lovelace" : toHex( e.policy ) + "." + toHex( e.name ) )
                + ": " + e.amount.toString()
            ).join( ", " ) + " }",
        term() { return new UPLCConst( constT.value, this.runtime() ); },
        runtime() {
            // LedgerValue: Array<Pair<policy, Array<Pair<name, amount>>>>
            return entries.map( e => ({
                fst: e.policy,
                snd: [ { fst: e.name, snd: e.amount } ]
            }));
        },
        data() {
            return new DataMap( entries.map( e =>
                new DataPair(
                    new DataB( e.policy ),
                    new DataMap([ new DataPair( new DataB( e.name ), new DataI( e.amount ) ) ])
                )
            ));
        },
        shrinks() {
            if( entries.length === 0 ) return [];
            return [ mkValueSampleFromEntries( [] ) ];
        },
    };
}

// ─── raw generators ────────────────────────────────────────────────────

function _nextLength( prng: PRNG, depth: number ): number
{
    if( depth >= SOFT_MAX_DEPTH ) return prng.next32() % 2; // 0 or 1
    const edgeRoll = prng.next32() & 0x3;
    if( edgeRoll === 0 ) return 0;
    if( edgeRoll === 1 ) return 1;
    return prng.next32() % 9; // 0..8
}

function _nextAsciiString( prng: PRNG ): string
{
    const len = prng.next32() % 25; // 0..24
    let s = "";
    for( let i = 0; i < len; i++ )
    s += String.fromCharCode( 0x20 + ( prng.next32() % 0x5f ) ); // printable ascii
    return s;
}

function _nextData( prng: PRNG, depth: number ): Data
{
    const kind = depth >= SOFT_MAX_DEPTH
        ? prng.next32() % 2        // only I / B at depth
        : prng.next32() % 5;
    switch( kind )
    {
        case 0: return new DataI( prng.nextIntBiased() );
        case 1: return new DataB( prng.nextBytes() );
        case 2: {
            const len = prng.next32() % 4;
            const elems: Data[] = new Array( len );
            for( let i = 0; i < len; i++ ) elems[i] = _nextData( prng, depth + 1 );
            return new DataList( elems );
        }
        case 3: {
            const len = prng.next32() % 3;
            const pairs: DataPair<Data, Data>[] = new Array( len );
            for( let i = 0; i < len; i++ )
            pairs[i] = new DataPair( _nextData( prng, depth + 1 ), _nextData( prng, depth + 1 ) );
            return new DataMap( pairs );
        }
        default: {
            const len = prng.next32() % 4;
            const fields: Data[] = new Array( len );
            for( let i = 0; i < len; i++ ) fields[i] = _nextData( prng, depth + 1 );
            return new DataConstr( prng.next32() % 4, fields );
        }
    }
}

function _showData( d: Data ): string
{
    if( d instanceof DataI ) return "I " + d.int.toString();
    if( d instanceof DataB ) return "B #" + toHex( d.bytes );
    if( d instanceof DataList ) return "List [" + d.list.map( _showData ).join( ", " ) + "]";
    if( d instanceof DataMap )
    return "Map {" + d.map.map( p => _showData( p.fst ) + ": " + _showData( p.snd ) ).join( ", " ) + "}";
    if( d instanceof DataConstr )
    return "Constr " + d.constr.toString() + " [" + d.fields.map( _showData ).join( ", " ) + "]";
    return String( d );
}
