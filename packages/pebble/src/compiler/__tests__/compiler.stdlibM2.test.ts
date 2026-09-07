import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB, DataMap, DataList, DataPair, Data } from "@harmoniclabs/plutus-data";

// Milestone 2 stdlib expansion:
//   - Value arithmetic: negate / equals / subtract / isZero / geq / leq /
//     singleton / amountOfAsset (+ the AssetClass prelude struct)
//   - script-context helpers: Tx.signedBy / findInput / outputsToCredential /
//     inputsFromCredential / valuePaidTo, TxOut.inlineDatum,
//     Interval.{lowerBoundFinite,upperBoundFinite,contains,isEntirelyAfter,
//     isEntirelyBefore}
//   - std.list.{at,concat,reverse,sum,count}
//   - std.linearMap.{has,insert,remove}
//
// Each test compiles a `mint` contract and CEK-evaluates it against a
// script context built here in TS — the established stdValueZero pattern.

async function compileIt( src: string ): Promise<Uint8Array> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.compile({ entry: "main.pebble", root: "/" });
    const d = c.diagnostics.map( x => x.toString() ).filter( s => s.startsWith("ERROR") );
    if( d.length ) throw new Error( d[0] );
    return ioApi.outputs.get("out/out.flat")!;
}

const policy = fromHex( "bb".repeat( 28 ) );
const tokenName = fromUtf8( "TOK" );
const txHash = fromHex( "11".repeat( 32 ) );
const otherHash = fromHex( "22".repeat( 28 ) );

// ---- data builders for the prelude shapes --------------------------------

const bData = ( b: Uint8Array ) => new DataB( b );
const iData = ( n: number | bigint ) => new DataI( n );
/** Credential.PubKey{ hash } */
const pubKeyCred = ( hash: Uint8Array ) => new DataConstr( 0, [ bData( hash ) ] );
/** Address{ payment, stake: None } */
const mkAddress = ( payment: Data ) => new DataConstr( 0, [ payment, new DataConstr( 1, [] ) ] );
/** Value data: lovelaces + optional single asset */
const mkValue = ( lovelaces: number, asset?: { policy: Uint8Array; name: Uint8Array; amount: number } ) => {
    const pairs: DataPair<Data, Data>[] = [];
    if( lovelaces !== 0 )
    pairs.push( new DataPair( bData( new Uint8Array(0) ),
        new DataMap([ new DataPair( bData( new Uint8Array(0) ), iData( lovelaces ) ) ]) ) );
    if( asset )
    pairs.push( new DataPair( bData( asset.policy ),
        new DataMap([ new DataPair( bData( asset.name ), iData( asset.amount ) ) ]) ) );
    return new DataMap( pairs );
};
/** TxOutRef{ id, index } */
const mkRef = ( index: number ) => new DataConstr( 0, [ bData( txHash ), iData( index ) ] );
/** OutputDatum.InlineDatum{ datum } */
const inlineDatum = ( d: Data ) => new DataConstr( 2, [ d ] );
const noDatum = new DataConstr( 0, [] );
/** TxOut{ address, value, datum, referenceScript: None } */
const mkTxOut = ( address: Data, value: Data, datum: Data = noDatum ) =>
    new DataConstr( 0, [ address, value, datum, new DataConstr( 1, [] ) ] );
/** TxIn{ ref, resolved } */
const mkTxIn = ( ref: Data, resolved: Data ) => new DataConstr( 0, [ ref, resolved ] );
/** IntervalBoundary{ boundary: Finite{n}, isInclusive } — the isInclusive
 * bool uses the LEDGER encoding (PlutusTx: False = Constr 0, True = Constr 1),
 * which is what the interval helpers read on-chain. */
const finiteBound = ( n: number, inclusive: boolean ) =>
    new DataConstr( 0, [ new DataConstr( 1, [ iData( n ) ] ), new DataConstr( inclusive ? 1 : 0, [] ) ] );
/** Interval{ from, to } */
const mkInterval = ( from: Data, to: Data ) => new DataConstr( 0, [ from, to ] );

const addr1 = mkAddress( pubKeyCred( policy ) );
const addr2 = mkAddress( pubKeyCred( otherHash ) );

function mintCtx(): DataConstr {
    const txFields: Data[] = Array.from( { length: 16 }, () => new DataI( 0 ) );
    txFields[0] = new DataList([ // inputs
        mkTxIn( mkRef( 0 ), mkTxOut( addr1, mkValue( 10 ) ) ),
        mkTxIn( mkRef( 1 ), mkTxOut( addr2, mkValue( 20 ) ) ),
    ]);
    txFields[1] = new DataList([]); // refInputs
    txFields[2] = new DataList([ // outputs
        mkTxOut( addr1, mkValue( 5 ), inlineDatum( iData( 42 ) ) ),
        mkTxOut( addr2, mkValue( 7 ) ),
        mkTxOut( addr1, mkValue( 11 ) ),
    ]);
    txFields[4] = mkValue( 5, { policy, name: tokenName, amount: 1 } ); // mint
    txFields[6] = new DataMap([]); // withdrawals
    txFields[7] = mkInterval( finiteBound( 1000, true ), finiteBound( 2000, true ) ); // validityInterval
    txFields[8] = new DataList([ bData( policy ) ]); // requiredSigners
    txFields[10] = new DataMap([]); // datums
    return new DataConstr( 0, [
        new DataConstr( 0, txFields ),
        new DataConstr( 0, [ new DataI( 1 ) ] ), // redeemer
        new DataConstr( 0, [ bData( policy ) ] ), // purpose: Minting{ policy }
    ]);
}

function evalWith( flat: Uint8Array ): { result: "ACCEPT" | "ERROR"; msg?: string; logs: string[] } {
    const applied = new Application(
        parseUPLC( flat ).body,
        UPLCConst.data( mintCtx() )
    );
    const out = Machine.eval( applied );
    return out.result instanceof CEKError
        ? { result: "ERROR", msg: out.result.msg, logs: out.logs }
        : { result: "ACCEPT", logs: out.logs };
}

async function expectAccept( body: string ): Promise<void> {
    const flat = await compileIt(`
contract T {
    mint go( n: int ) {
        const { tx, policy } = context;
${body}
    }
}`);
    const r = evalWith( flat );
    if( r.result !== "ACCEPT" )
    throw new Error( `script rejected: ${r.msg ?? ""}\ntraces:\n${r.logs.join("\n")}` );
}

jest.setTimeout( 300_000 );

describe("milestone 2 stdlib — Value arithmetic", () => {

    test("negate / subtract / isZero / equals", async () => {
        await expectAccept(`
        const m = tx.mint;
        assert m.lovelaces() == 5;
        assert m.negate().lovelaces() == -5;
        assert m.negate().amountOf( policy, "TOK" ) == -1;
        assert m.subtract( m ).isZero();
        assert !m.isZero();
        assert m.equals( m );
        assert !m.equals( std.value.zero );
        assert std.value.zero.isZero();
`);
    });

    test("geq / leq", async () => {
        await expectAccept(`
        const m = tx.mint;
        assert m.geq( std.value.zero );
        assert std.value.zero.leq( m );
        assert m.geq( m );
        assert m.leq( m );
        assert !std.value.zero.geq( m );
`);
    });

    test("singleton / amountOfAsset / AssetClass", async () => {
        await expectAccept(`
        const s = std.value.singleton( policy, "TOK", 7 );
        assert s.amountOf( policy, "TOK" ) == 7;
        assert s.lovelaces() == 0;
        const ac = std.value.assetClass( policy, "TOK" );
        assert tx.mint.amountOfAsset( ac ) == 1;
        assert s.amountOfAsset( ac ) == 7;
`);
    });

    test("namespace forms mirror the methods", async () => {
        await expectAccept(`
        const m = tx.mint;
        assert std.value.equals( std.value.negate( std.value.negate( m ) ), m );
        assert std.value.isZero( std.value.subtract( m, m ) );
        assert std.value.geq( m, std.value.zero );
`);
    });
});

describe("milestone 2 stdlib — script-context helpers", () => {

    test("Tx.signedBy", async () => {
        await expectAccept(`
        assert tx.signedBy( policy );
        assert !tx.signedBy( "not a signer" );
`);
    });

    test("Tx.findInput", async () => {
        await expectAccept(`
        const firstRef = std.list.head( tx.inputs ).ref;
        const Some{ value: found } = tx.findInput( firstRef );
        assert found.resolved.value.lovelaces() == 10;
`);
    });

    test("Tx.outputsToCredential / inputsFromCredential", async () => {
        await expectAccept(`
        const o0 = std.list.head( tx.outputs );
        const mine = tx.outputsToCredential( o0.address.payment );
        assert mine.length() == 2;
        const ins = tx.inputsFromCredential( o0.address.payment );
        assert ins.length() == 1;
`);
    });

    test("Tx.valuePaidTo sums every output to the address", async () => {
        await expectAccept(`
        const o0 = std.list.head( tx.outputs );
        const paid = tx.valuePaidTo( o0.address );
        assert paid.lovelaces() == 16; // 5 + 11
`);
    });

    test("TxOut.inlineDatum", async () => {
        await expectAccept(`
        const o0 = std.list.head( tx.outputs );
        const Some{ value: d } = o0.inlineDatum();
        assert ( d as int ) == 42;
        const o1 = std.list.head( std.list.tail( tx.outputs ) );
        assert o1.inlineDatum() is None;
`);
    });

    test("Interval helpers", async () => {
        await expectAccept(`
        const i = tx.validityInterval;
        assert i.contains( 1500 );
        assert i.contains( 1000 );
        assert i.contains( 2000 );
        assert !i.contains( 500 );
        assert !i.contains( 2500 );
        assert i.isEntirelyAfter( 500 );
        assert !i.isEntirelyAfter( 1500 );
        assert i.isEntirelyBefore( 3000 );
        assert !i.isEntirelyBefore( 1500 );
        const Some{ value: lo } = i.lowerBoundFinite();
        assert lo == 1000;
        const Some{ value: hi } = i.upperBoundFinite();
        assert hi == 2000;
`);
    });
});

describe("milestone 2 stdlib — list helpers", () => {

    test("at / concat / reverse / sum / count", async () => {
        await expectAccept(`
        const xs = [1, 2, 3];
        const Some{ value: second } = std.list.at( 1, xs );
        assert second == 2;
        assert std.list.at( 5, xs ) is None;
        const both = std.list.concat( xs, [4, 5] );
        assert std.list.length( both ) == 5;
        assert std.list.sum( both ) == 15;
        const rev = std.list.reverse( xs );
        assert std.list.head( rev ) == 3;
        assert std.list.count( ( x: int ) => x > 1, xs ) == 2;
`);
    });
});

describe("milestone 2 stdlib — linearMap helpers", () => {

    test("has / insert / remove round-trip", async () => {
        await expectAccept(`
        const o0 = std.list.head( tx.outputs );
        const c = o0.address.payment;
        const w0 = tx.withdrawals; // empty
        assert !std.linearMap.has( c, w0 );
        const w1 = std.linearMap.prepend( c, 3, w0 );
        assert std.linearMap.has( c, w1 );
        const w2 = std.linearMap.insert( c, 9, w1 ); // replaces
        assert std.linearMap.length( w2 ) == 1;
        const Some{ value: got } = std.linearMap.lookup( c, w2 );
        assert got == 9;
        assert !std.linearMap.has( c, std.linearMap.remove( c, w2 ) );
`);
    });
});
