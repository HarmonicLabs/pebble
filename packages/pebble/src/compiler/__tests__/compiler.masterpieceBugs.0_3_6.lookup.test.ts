import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKConst, CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB, DataMap, DataPair, Data } from "@harmoniclabs/plutus-data";

// Bug 15 from `the-cardano-masterpiece` (PEBBLE_BUGS.md, against 0.3.6):
// `lookup` on a TYPED `LinearMap<bytes, bytes>` (struct fields etc.) passed
// the key RAW to the `_lookupLinearMap` native, which compares entry keys
// with `equalsData` — failing on-chain with `equalsData :: not data`.
// The key is now encoded to data at the call site (identity for
// `LinearMap<data, _>`); the found value keeps the raw-data `Some` payload
// convention (consumers decode on extraction).

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

const md = new DataMap([
    new DataPair( new DataB( fromHex("6d6564696154797065") ), new DataB( fromHex("696d6167652f626d70") ) ),
]);
const dStruct = new DataConstr( 0, [ md, new DataI( 1 ) ] );
const redeemerOf = ( d: Data ) => new DataConstr( 0, [ d ] );

describe("masterpiece bug 15 — typed LinearMap.lookup encodes the key", () => {

    test("inline literal key on LinearMap<bytes,bytes> struct field", async () => {
        expect( await evalContract(`
struct D { metadata: LinearMap<bytes, bytes>, version: int }
contract T {
    mint check( d: data ) {
        const { tx, policy } = context;
        const dd = d as D;
        const Some{ value: v } = dd.metadata.lookup( #6d6564696154797065 );
        assert v == #696d6167652f626d70;
    }
}`, redeemerOf( dStruct ) ) ).toBe( "ACCEPT" );
    });

    test("top-level const key + raw const reuse (the masterpiece shape)", async () => {
        expect( await evalContract(`
struct D { metadata: LinearMap<bytes, bytes>, version: int }
const KEY = #6d6564696154797065;
contract T {
    mint check( d: data ) {
        const { tx, policy } = context;
        const dd = d as D;
        const Some{ value: v } = dd.metadata.lookup( KEY );
        assert v == #696d6167652f626d70;
        assert KEY == #6d6564696154797065;
    }
}`, redeemerOf( dStruct ) ) ).toBe( "ACCEPT" );
    });

    test("missing key -> None arm (key comparison actually works)", async () => {
        expect( await evalContract(`
struct D { metadata: LinearMap<bytes, bytes>, version: int }
contract T {
    mint check( d: data ) {
        const { tx, policy } = context;
        const dd = d as D;
        match dd.metadata.lookup( #00 ) {
            when Some{ value }: { assert false; }
            when None{}: { assert true; }
        }
    }
}`, redeemerOf( dStruct ) ) ).toBe( "ACCEPT" );
    });

    test("LinearMap<data, data> via unMapData keeps working", async () => {
        expect( await evalContract(`
contract T {
    mint check( d: data ) {
        const { tx, policy } = context;
        const m = std.builtins.unMapData( d );
        const Some{ value: v } = m.lookup( std.builtins.bData( #6d6564696154797065 ) );
        assert std.builtins.unBData( v ) == #696d6167652f626d70;
    }
}`, redeemerOf( md ) ) ).toBe( "ACCEPT" );
    });
});
