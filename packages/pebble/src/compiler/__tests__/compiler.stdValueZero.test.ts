import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, showUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB, DataMap, DataList, DataPair, Data } from "@harmoniclabs/plutus-data";

// `std.value.zero` — the empty native `Value`.
//
// There is no UPLC constant of the builtin Value type (it isn't even
// caseable), so it is BUILT at runtime from an empty map:
//   unValueData( mapData( mkNilPairData( () ) ) )
// It is registered as a program constant, which `expressify` wraps in a
// `TirHoistedExpr` — so however many times a contract mentions it, the
// script contains ONE shared binding, and contracts that never mention it
// don't pay for it at all.

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

/** minimal mint context; the `mint` field carries `mintedValue` */
function mintCtx( redeemer: Data, mintedValue: Data = new DataMap([]) ): DataConstr {
    const txFields: Data[] = Array.from( { length: 16 }, () => new DataI( 0 ) );
    txFields[4] = mintedValue; // tx.mint
    return new DataConstr( 0, [
        new DataConstr( 0, txFields ),
        redeemer,
        new DataConstr( 0, [ new DataB( policy ) ] ),
    ]);
}
function evalWith( flat: Uint8Array, mintedValue?: Data ): "ACCEPT" | "ERROR" {
    const applied = new Application(
        parseUPLC( flat ).body,
        UPLCConst.data( mintCtx( new DataConstr( 0, [ new DataI( 1 ) ] ), mintedValue ) )
    );
    return Machine.evalSimple( applied ) instanceof CEKError ? "ERROR" : "ACCEPT";
}

/** a Value map with `lovelaces` ADA and 1 `policy.TOK` */
const someValue = ( lovelaces: number ) => new DataMap([
    new DataPair( new DataB( new Uint8Array(0) ),
        new DataMap([ new DataPair( new DataB( new Uint8Array(0) ), new DataI( lovelaces ) ) ]) ),
    new DataPair( new DataB( policy ),
        new DataMap([ new DataPair( new DataB( tokenName ), new DataI( 1 ) ) ]) ),
]);

/** wraps a `mint go(n: int)` body */
const contract = ( body: string ) => `
contract T {
    mint go( n: int ) {
        const { tx, policy } = context;
${body}
    }
}`;

jest.setTimeout( 300_000 );

describe("std.value.zero", () => {

    test("is the empty Value: no lovelaces, no tokens", async () => {
        const flat = await compileIt( contract(`
        const z = std.value.zero;
        assert z.lovelaces() == 0;
        assert z.amountOf( policy, "TOK" ) == 0;
`) );
        expect( evalWith( flat ) ).toBe( "ACCEPT" );
    });

    test("compiles to a runtime-built empty map converted to a Value", async () => {
        const flat = await compileIt( contract(`
        assert std.value.zero.lovelaces() == 0;
`) );
        const uplc = showUPLC( parseUPLC( flat ).body );
        // nil list of pairs -> mapData -> unValueData
        expect( uplc ).toContain( "mkNilPairData" );
        expect( uplc ).toContain( "mapData" );
        expect( uplc ).toContain( "unValueData" );
    });

    test("is HOISTED: many references share ONE binding", async () => {
        const flat = await compileIt( contract(`
        const a = std.value.zero;
        const b = std.value.zero;
        assert a.lovelaces() == 0;
        assert b.lovelaces() == 0;
        assert std.value.zero.lovelaces() == 0;
        assert std.value.zero.amountOf( policy, "TOK" ) == 0;
`) );
        const uplc = showUPLC( parseUPLC( flat ).body );
        // the construction appears exactly once however many times it is used
        expect( uplc.split( "mkNilPairData" ).length - 1 ).toBe( 1 );
        expect( evalWith( flat ) ).toBe( "ACCEPT" );
    });

    test("costs nothing in a contract that never mentions it", async () => {
        const flat = await compileIt( contract(`
        assert n == 1;
`) );
        expect( showUPLC( parseUPLC( flat ).body ) ).not.toContain( "mkNilPairData" );
    });

    test("is the additive identity for Value arithmetic", async () => {
        const flat = await compileIt( contract(`
        const minted = tx.mint;
        assert minted + std.value.zero == minted;
        assert std.value.zero + minted == minted;
`) );
        expect( evalWith( flat, someValue( 2_000_000 ) ) ).toBe( "ACCEPT" );
        // also with an EMPTY mint: zero + zero == zero
        expect( evalWith( flat, new DataMap([]) ) ).toBe( "ACCEPT" );
    });

    test("equals an empty minted Value, and differs from a non-empty one", async () => {
        const eqZero = await compileIt( contract(`
        assert tx.mint == std.value.zero;
`) );
        expect( evalWith( eqZero, new DataMap([]) ) ).toBe( "ACCEPT" );
        expect( evalWith( eqZero, someValue( 2_000_000 ) ) ).toBe( "ERROR" );
    });

    test("works with union / contains / scale / toData", async () => {
        const flat = await compileIt( contract(`
        const z = std.value.zero;
        // union with zero changes nothing
        assert z.union( tx.mint ) == tx.mint;
        // every Value contains the empty one
        assert tx.mint.contains( z );
        // scaling the empty value stays empty
        assert z.scale( 7 ) == z;
        // an empty Value encodes as the same data as an empty mint
        assert z.toData() == std.value.zero.toData();
`) );
        expect( evalWith( flat, someValue( 5_000_000 ) ) ).toBe( "ACCEPT" );
    });

    test("can be used as a loop accumulator seed", async () => {
        const flat = await compileIt( contract(`
        let acc = std.value.zero;
        for( let i = 0; i < 3; i++ ) {
            acc = acc + tx.mint;
        }
        assert acc == tx.mint.scale( 3 );
`) );
        expect( evalWith( flat, someValue( 1_000_000 ) ) ).toBe( "ACCEPT" );
    });

    test("`using` brings it into scope", async () => {
        const flat = await compileIt( contract(`
        using value = std.value;
        assert value.zero.lovelaces() == 0;
`) );
        expect( evalWith( flat ) ).toBe( "ACCEPT" );
    });
});
