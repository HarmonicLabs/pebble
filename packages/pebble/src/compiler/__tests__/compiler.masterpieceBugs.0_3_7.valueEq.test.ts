import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB, DataMap, Data } from "@harmoniclabs/plutus-data";

// masterpiece BUG 18: `Value ==` was lowered as bidirectional
// `valueContains`, and that builtin FAILS on any negative quantity —
// `tx.mint` legitimately carries negatives for burns, so any exact-mint
// check of a burning tx errored at runtime
// ("valueContains :: negative quantity in first value").
// `Value ==` is now lowered as `equalsData( valueData a, valueData b )`:
// builtin Values are canonically normalized, so data equality is exact,
// order-independent, and total.

const policy = fromHex( "bb".repeat( 28 ) );
function mintCtx( redeemer: Data ): DataConstr {
    const txFields: Data[] = Array.from( { length: 16 }, () => new DataI( 0 ) );
    return new DataConstr( 0, [
        new DataConstr( 0, txFields ),
        redeemer,
        new DataConstr( 0, [ new DataB( policy ) ] ),
    ]);
}

async function evalContract( src: string, redeemer: Data ): Promise<string> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.compile({ entry: "main.pebble", root: "/" });
    const diags = c.diagnostics.map( d => d.toString() );
    if( diags.length ) return "DIAG: " + diags[0].slice( 0, 100 );
    const out = ioApi.outputs.get("out/out.flat");
    if( !out ) return "NO OUTPUT";
    const applied = new Application( parseUPLC( out ).body, UPLCConst.data( mintCtx( redeemer ) ) );
    const r = Machine.evalSimple( applied );
    return r instanceof CEKError ? "ERROR: " + String( r.msg ?? "" ).slice( 0, 90 ) : "ACCEPT";
}

// the empty Value comes in as data (empty map) and gets decoded on-chain
const emptyMapData = new DataMap([]);
const redeemerOf = ( d: Data ) => new DataConstr( 0, [ d ] );

jest.setTimeout( 300_000 );

const contract = ( body: string ) => `
contract T {
    mint check( d: data ) {
        const empty = std.builtins.unValueData( d );
${body}
    }
}`;

describe("masterpiece bug 18 — Value == works on values with negative quantities (burns)", () => {

    test("equal mint-with-burn values compare true (insertion-order independent)", async () => {
        expect( await evalContract( contract(`
        const a = std.builtins.insertCoin( #aa, #01, 1, std.builtins.insertCoin( #cc, #02, -1, empty ) );
        const b = std.builtins.insertCoin( #cc, #02, -1, std.builtins.insertCoin( #aa, #01, 1, empty ) );
        assert a == b;
`), redeemerOf( emptyMapData ) ) ).toBe( "ACCEPT" );
    });

    test("different burn quantities compare false — NOT a runtime error", async () => {
        expect( await evalContract( contract(`
        const a = std.builtins.insertCoin( #cc, #02, -1, empty );
        const b = std.builtins.insertCoin( #cc, #02, -2, empty );
        assert !( a == b );
`), redeemerOf( emptyMapData ) ) ).toBe( "ACCEPT" );
    });

    test("positive-only equality still works", async () => {
        expect( await evalContract( contract(`
        const a = std.builtins.insertCoin( #aa, #01, 5, empty );
        const b = std.builtins.insertCoin( #aa, #01, 5, empty );
        assert a == b;
`), redeemerOf( emptyMapData ) ) ).toBe( "ACCEPT" );
    });

    test("positive-only inequality still works", async () => {
        expect( await evalContract( contract(`
        const a = std.builtins.insertCoin( #aa, #01, 5, empty );
        const b = std.builtins.insertCoin( #aa, #02, 5, empty );
        assert !( a == b );
`), redeemerOf( emptyMapData ) ) ).toBe( "ACCEPT" );
    });
});
