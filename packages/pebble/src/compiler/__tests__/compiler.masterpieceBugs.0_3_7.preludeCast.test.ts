import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB, Data } from "@harmoniclabs/plutus-data";

// masterpiece BUG 21: prelude struct types (TxOutRef, Address, ...) resolved
// fine in TYPE position but NOT in cast position — `tagData as TxOutRef`
// failed with "'TxOutRef' is not defined". Cause: the cast path required the
// SOP variant of the resolved type to exist, but data-only prelude structs
// register a sop name that is never added to the program's types.

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
    try {
        await c.compile({ entry: "main.pebble", root: "/" });
    } catch {
        // compile throws when diagnostics contain errors; inspected below
    }
    const diags = c.diagnostics.map( d => d.toString() ).filter( s => s.startsWith("ERROR") );
    if( diags.length ) return "DIAG: " + diags[0].slice( 0, 100 );
    const out = ioApi.outputs.get("out/out.flat");
    if( !out ) return "NO OUTPUT";
    const applied = new Application( parseUPLC( out ).body, UPLCConst.data( mintCtx( redeemer ) ) );
    const r = Machine.evalSimple( applied );
    return r instanceof CEKError ? "ERROR: " + String( r.msg ?? "" ).slice( 0, 90 ) : "ACCEPT";
}

const redeemerOf = ( d: Data ) => new DataConstr( 0, [ d ] );

// TxOutRef data encoding: Constr 0 [ B txHash, I index ]
const refData = new DataConstr( 0, [ new DataB( fromHex( "aa".repeat( 32 ) ) ), new DataI( 7 ) ] );

jest.setTimeout( 300_000 );

describe("masterpiece bug 21 — prelude types usable in cast position", () => {

    test("`as TxOutRef` compiles and decodes", async () => {
        expect( await evalContract(`
contract T {
    mint check( d: data ) {
        const { tx, policy } = context;
        const t = d as TxOutRef;
        assert t.index == 7;
        assert t.id == #${ "aa".repeat( 32 ) };
    }
}`, redeemerOf( refData ) ) ).toBe( "ACCEPT" );
    });

    test("`as Address` compiles and decodes", async () => {
        // Address: Constr 0 [ Credential.Script (Constr 1 [B hash]), Optional stake = None (Constr 1 []) ]
        const addrData = new DataConstr( 0, [
            new DataConstr( 1, [ new DataB( fromHex( "cc".repeat( 28 ) ) ) ] ),
            new DataConstr( 1, [] ),
        ]);
        expect( await evalContract(`
contract T {
    mint check( d: data ) {
        const { tx, policy } = context;
        const a = d as Address;
        assert a.payment.hash() == #${ "cc".repeat( 28 ) };
    }
}`, redeemerOf( addrData ) ) ).toBe( "ACCEPT" );
    });

    test("user-defined struct casts keep working", async () => {
        expect( await evalContract(`
struct RefTag { id: bytes, index: int }
contract T {
    mint check( d: data ) {
        const { tx, policy } = context;
        const RefTag{ id, index } = d as RefTag;
        assert index == 7;
    }
}`, redeemerOf( refData ) ) ).toBe( "ACCEPT" );
    });

    test("casting to an unknown type still errors", async () => {
        const r = await evalContract(`
contract T {
    mint check( d: data ) {
        const { tx, policy } = context;
        const t = d as DoesNotExist;
        assert 1 == 1;
    }
}`, redeemerOf( refData ) );
        expect( r.startsWith( "DIAG:" ) ).toBe( true );
        expect( r ).toContain( "is not defined" );
    });
});
