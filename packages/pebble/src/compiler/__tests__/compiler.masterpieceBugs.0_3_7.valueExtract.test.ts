import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB, DataMap, DataList, DataPair, Data } from "@harmoniclabs/plutus-data";

// masterpiece BUG 22: `unConstrData :: not a data constructor` (receiving an
// output's VALUE map) when a spend method combines: an inputs.find whose
// `.resolved.value` is used twice inline, an outputs.find keyed on the
// input's address, and a use of the found output's `.value` — a shared
// field-extractor letted ended up applied to the wrong subject.

const SRC = `
contract Iveq4Test {
    state A {
        s: int;

        spend m() {
            const { tx, spendingRef } = context;
            const Some{ value: inp } = tx.inputs.find( i => i.ref == spendingRef );
            const ownAddr = inp.resolved.address;
            assert inp.resolved.value.amountOf( #aa, #bb ) == 0;
            const Some{ value: out1 } = tx.outputs.find( o => o.address == ownAddr );
            assert out1.value.amountOf( #aa, #bb ) == 0;
            assert out1.value.lovelaces() >= inp.resolved.value.lovelaces();
        }
    }
    state B { w: int; }
}
`;

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

// ---- script context construction ------------------------------------------

const ref = new DataConstr( 0, [ new DataB( fromHex("aa".repeat(32)) ), new DataI( 0 ) ] );

// Address: payment = script credential, stake = None
const addr = new DataConstr( 0, [
    new DataConstr( 1, [ new DataB( fromHex("cc".repeat(28)) ) ] ),
    new DataConstr( 1, [] ),
]);

// Value map: { "": { "": 2_000_000 } } (lovelaces only)
const lovelaces = ( n: number ) => new DataMap([
    new DataPair(
        new DataB( new Uint8Array(0) ),
        new DataMap([ new DataPair( new DataB( new Uint8Array(0) ), new DataI( n ) ) ])
    )
]);

const noDatum = new DataConstr( 0, [] );        // OutputDatum.NoDatum
const noRefScript = new DataConstr( 1, [] );    // Optional.None

const txOut = ( value: Data ) => new DataConstr( 0, [ addr, value, noDatum, noRefScript ] );
const txIn = new DataConstr( 0, [ ref, txOut( lovelaces( 2_000_000 ) ) ] );

// Tx: 16 fields; unused ones are lazy-decoded so dummies are fine
const tx = new DataConstr( 0, [
    new DataList([ txIn ]),                     // inputs
    new DataList([]),                           // refInputs
    new DataList([ txOut( lovelaces( 3_000_000 ) ) ]), // outputs
    new DataI( 0 ),                             // fee
    new DataMap([]),                            // mint
    new DataList([]),                           // certificates
    new DataMap([]),                            // withdrawals
    new DataI( 0 ),                             // validityInterval (unused)
    new DataList([]),                           // requiredSigners
    new DataMap([]),                            // redeemers
    new DataMap([]),                            // datums
    new DataB( fromHex("dd".repeat(32)) ),      // hash
    new DataMap([]),                            // votes
    new DataList([]),                           // proposals
    new DataConstr( 1, [] ),                    // currentTreasury: None
    new DataConstr( 1, [] ),                    // treasuryDonation: None
]);

const datum = new DataConstr( 0, [ new DataI( 1 ) ] );  // state A { s: 1 }
const redeemer = new DataConstr( 0, [] );               // method m, no args

// ScriptContext: Constr 0 [ tx, redeemer, Spend{ ref, Some{datum} } ]
const ctx = new DataConstr( 0, [
    tx,
    redeemer,
    new DataConstr( 1, [ ref, new DataConstr( 0, [ datum ] ) ] ),
]);

jest.setTimeout( 300_000 );

// ---- direct SSA-rename tests -----------------------------------------------
// The root cause was general: the destructure lowering keyed its SSA rename
// by the struct FIELD name for user patterns, so a second `Some{ value: y }`
// destructure remapped the FIRST binding (`value -> x`, then `value -> y`
// chain-remaps `x -> y`). Besides the crash pinned below, this could
// silently produce the WRONG VALUE — these tests pin the semantics for each
// fixed call site via asserts (a corrupted binding fails the assert).

const mintPolicy = fromHex( "bb".repeat( 28 ) );
function mintCtx(): DataConstr {
    const txFields: Data[] = Array.from( { length: 16 }, () => new DataI( 0 ) );
    return new DataConstr( 0, [
        new DataConstr( 0, txFields ),
        new DataConstr( 0, [] ), // redeemer: single no-arg method
        new DataConstr( 0, [ new DataB( mintPolicy ) ] ),
    ]);
}

async function evalMintBody( body: string ): Promise<string> {
    // NOTE: data-encoded struct elements (like the real-world TxIn/TxOut
    // case) — `find` over NATIVE-element lists (List<int>) currently
    // miscompiles the Some payload decode (unrelated latent issue).
    const src = `
struct Box { v: int }
contract T {
    mint m() {
        const { tx } = context;
${body}
    }
}`;
    const flat = await compileIt( src );
    const applied = new Application( parseUPLC( flat ).body, UPLCConst.data( mintCtx() ) );
    const r = Machine.evalSimple( applied );
    return r instanceof CEKError ? "ERROR: " + String( r.msg ?? "" ).slice( 0, 70 ) : "ACCEPT";
}

describe("bug 22 root cause — same-constructor destructures never corrupt earlier bindings", () => {

    test("two `const Some{ value: X }` statements: first binding keeps its value", async () => {
        // pre-fix: 'a' was silently remapped to 'b' (a == 8) and the assert failed
        expect( await evalMintBody(`
        const xs: List<Box> = [ Box.Box{ v: 10 }, Box.Box{ v: 20 } ];
        const ys: List<Box> = [ Box.Box{ v: 7 }, Box.Box{ v: 8 } ];
        const Some{ value: a } = xs.find( x => x.v == 20 );
        const Some{ value: b } = ys.find( y => y.v == 8 );
        assert a.v == 20;
        assert b.v == 8;
        assert a.v + b.v == 28;
`) ).toBe( "ACCEPT" );
    });

    test("nested match STATEMENTS with same-named field aliases: outer binding survives", async () => {
        expect( await evalMintBody(`
        const xs: List<Box> = [ Box.Box{ v: 10 }, Box.Box{ v: 20 } ];
        const ys: List<Box> = [ Box.Box{ v: 7 }, Box.Box{ v: 8 } ];
        match xs.find( x => x.v == 20 ) {
            when Some{ value: a }: {
                match ys.find( y => y.v == 8 ) {
                    when Some{ value: b }: {
                        assert a.v == 20;
                        assert b.v == 8;
                    }
                    when None{}: { assert false; }
                }
            }
            when None{}: { assert false; }
        }
`) ).toBe( "ACCEPT" );
    });

    test("match arms with outer `let` reassignment: destructured bindings stay distinct", async () => {
        expect( await evalMintBody(`
        const xs: List<Box> = [ Box.Box{ v: 10 }, Box.Box{ v: 20 } ];
        const ys: List<Box> = [ Box.Box{ v: 7 }, Box.Box{ v: 8 } ];
        let acc: int = 0;
        match xs.find( x => x.v == 20 ) {
            when Some{ value: a }: { acc = a.v; }
            when None{}: { acc = 0 - 1; }
        }
        match ys.find( y => y.v == 8 ) {
            when Some{ value: b }: { acc = acc * 100 + b.v; }
            when None{}: { acc = 0 - 2; }
        }
        assert acc == 2008;
`) ).toBe( "ACCEPT" );
    });

    test("match arm pattern does NOT hijack an outer variable named like the field", async () => {
        // the match-arm variant of the same rename bug: with the rename keyed
        // by FIELD name, `when Some{ value: inner }` remapped any outer
        // variable named `value` to `inner` inside the arm
        expect( await evalMintBody(`
        const value: int = 42;
        const xs: List<Box> = [ Box.Box{ v: 10 }, Box.Box{ v: 20 } ];
        match xs.find( x => x.v == 20 ) {
            when Some{ value: inner }: {
                assert value == 42;
                assert inner.v == 20;
            }
            when None{}: { assert false; }
        }
`) ).toBe( "ACCEPT" );
    });

    test("shorthand `const Some{ value } = ...` keeps working after a second destructure", async () => {
        expect( await evalMintBody(`
        const xs: List<Box> = [ Box.Box{ v: 10 }, Box.Box{ v: 20 } ];
        const ys: List<Box> = [ Box.Box{ v: 7 }, Box.Box{ v: 8 } ];
        const Some{ value } = xs.find( x => x.v == 20 );
        const Some{ value: other } = ys.find( y => y.v == 8 );
        assert value.v == 20;
        assert other.v == 8;
`) ).toBe( "ACCEPT" );
    });
});

describe("masterpiece bug 22 — repeated input-value access + outputs.find keeps extractors on the right subject", () => {

    test("the reporter's minimal repro accepts", async () => {
        const flat = await compileIt( SRC );
        const applied = new Application( parseUPLC( flat ).body, UPLCConst.data( ctx ) );
        const r = Machine.evalSimple( applied );
        const msg = r instanceof CEKError ? "ERROR: " + String( r.msg ?? "" ) : "ACCEPT";
        expect( msg ).toBe( "ACCEPT" );
    });

    test("output with FEWER lovelaces than the input fails the >= assert (not a decode crash)", async () => {
        const poorTx = new DataConstr( 0, [
            new DataList([ txIn ]),
            new DataList([]),
            new DataList([ txOut( lovelaces( 1_000_000 ) ) ]),
            ...( tx.fields.slice( 3 ) ),
        ]);
        const poorCtx = new DataConstr( 0, [
            poorTx,
            redeemer,
            new DataConstr( 1, [ ref, new DataConstr( 0, [ datum ] ) ] ),
        ]);
        const flat = await compileIt( SRC );
        const applied = new Application( parseUPLC( flat ).body, UPLCConst.data( poorCtx ) );
        const r = Machine.evalSimple( applied );
        expect( r instanceof CEKError ).toBe( true );
        // must be the assert failing, not the extractor corruption
        expect( String( ( r as CEKError ).msg ?? "" ) ).not.toContain( "unConstrData" );
    });
});
