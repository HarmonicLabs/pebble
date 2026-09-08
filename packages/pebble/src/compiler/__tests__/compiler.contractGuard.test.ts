import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { Data, DataConstr, DataI, dataFromCbor } from "@harmoniclabs/plutus-data";

// `guard name() { ... }` contract methods — the Plutus V4 guarding purpose
// (CIP-0112 / CIP-0118). Only meaningful under
// `targetPlutusVersion: "experimental-v4"`; rejected under "v3".
//
// The guard script contexts below are assembled from the REAL
// plutus-ledger-api 1.68 encodings in fixtures/v4-data-encodings.json:
// `scriptcontext_full`'s tx + script hash with the purpose swapped for
// `scriptinfo_guarding_top` / `scriptinfo_guarding_sub`.

const fixturesPath = path.resolve( __dirname, "fixtures/v4-data-encodings.json" );
const hasFixtures = existsSync( fixturesPath );
const fixtures: Record<string, string> = hasFixtures
    ? JSON.parse( readFileSync( fixturesPath, "utf8" ) ).fixtures
    : {};

async function compileContract(
    src: string,
    target: string | undefined
): Promise<{ flat?: Uint8Array; error?: string; diags: string[] }>
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: false,
    });
    const c = new Compiler( ioApi, {
        ...testOptions,
        compilerVersion: COMPILER_VERSION,
        ...( target ? { targetPlutusVersion: target } : {} ),
    } as any );
    try {
        const flat = await c.compile({ entry: "main.pebble", root: "/" } as any );
        return { flat, diags: c.diagnostics.map( d => d.toString() ) };
    } catch ( e ) {
        return {
            error: e instanceof Error ? e.message : String( e ),
            diags: c.diagnostics.map( d => d.toString() ),
        };
    }
}

/**
 * V4 ScriptContext = Constr 0 [ tx, redeemer, scriptInfo, scriptHash ].
 * The fixture's tx carries `subTxIx = Some 3` (a sub-transaction); the
 * execution level is set explicitly per case since level-less contract
 * methods are top-only (see compiler.contractLevels.test.ts).
 */
function guardContext( purposeFixture: string, redeemer: Data, level: "top" | "nested" = "top" ): Data
{
    const full = dataFromCbor( fromHex( fixtures[ "scriptcontext_full" ] ) ) as DataConstr;
    const tx = full.fields[0] as DataConstr;
    const txFields = tx.fields.slice();
    txFields[1] = level === "top"
        ? new DataConstr( 1, [] )                   // subTxIx = None
        : new DataConstr( 0, [ new DataI( 3 ) ] );  // subTxIx = Some 3
    const purpose = dataFromCbor( fromHex( fixtures[ purposeFixture ] ) );
    return new DataConstr( 0, [ new DataConstr( 0, txFields ), redeemer, purpose, full.fields[3] ] );
}

function run( flat: Uint8Array, ctx: Data ): { ok: boolean; msg?: string; logs: string[] } {
    const res = Machine.eval( new Application( parseUPLC( flat ).body, UPLCConst.data( ctx ) ) );
    return res.result instanceof CEKError
        ? { ok: false, msg: res.result.msg, logs: res.logs }
        : { ok: true, logs: res.logs };
}

const guardOnly = `
contract Batch {
    guard check() {
        const { guardIndex, topTxInfo } = context;
        match topTxInfo {
            when Some{ value: top }: {
                // top-level guard: the whole batch is visible
                assert guardIndex == 14 else "top guard index";
                assert std.list.length( top.subTransactions ) == 1 else "one sub-transaction";
                assert top.simplified.treasuryDonations == 21 else "aggregated donations";
            }
            when None{}: {
                // guard executed inside a sub-transaction
                assert guardIndex == 13 else "sub guard index";
            }
        }
    }
}`;

jest.setTimeout( 300_000 );

describe("`guard` contract methods (Plutus V4 guarding purpose)", () => {

    test("rejected under the default v3 target with a located, actionable diagnostic", async () => {
        const r = await compileContract( guardOnly, undefined );
        expect( r.error ).toBeDefined();
        const diag = r.diags.find( d => d.includes( "guard" ) );
        expect( diag ).toBeDefined();
        expect( diag ).toContain( "targetPlutusVersion" );
        expect( diag ).toContain( "experimental-v4" );
        expect( diag ).toContain( '"v3"' );
    });

    test("`guard` is not allowed inside a `state` (states only have spend methods)", async () => {
        const r = await compileContract(`
contract C {
    state S {
        n: int;
        guard g() {}
    }
}`, "experimental-v4" );
        expect( r.error ).toBeDefined();
    });

    ( hasFixtures ? test : test.skip )("top-level guard sees the batch through context.topTxInfo", async () => {
        const r = await compileContract( guardOnly, "experimental-v4" );
        expect( r.error ).toBeUndefined();
        // single direct method, no params: the merged redeemer is Constr 0 []
        const res = run( r.flat!, guardContext( "scriptinfo_guarding_top", new DataConstr( 0, [] ) ) );
        if( !res.ok ) throw new Error( `rejected: ${res.msg}\n${res.logs.join( "\n" )}` );
    });

    ( hasFixtures ? test : test.skip )("sub-transaction guard gets topTxInfo = None", async () => {
        // a guard meant for sub-transactions must be declared `nested`
        const r = await compileContract( guardOnly.replace( "    guard check()", "    nested guard check()" ), "experimental-v4" );
        expect( r.error ).toBeUndefined();
        const res = run( r.flat!, guardContext( "scriptinfo_guarding_sub", new DataConstr( 0, [] ), "nested" ) );
        if( !res.ok ) throw new Error( `rejected: ${res.msg}\n${res.logs.join( "\n" )}` );
    });

    ( hasFixtures ? test : test.skip )("guard methods coexist with other purposes; their redeemer tag comes last", async () => {
        const r = await compileContract(`
contract Mixed {
    spend take() {
        assert false else "not a spend";
    }
    guard check() {
        const { guardIndex } = context;
        assert guardIndex == 14 else "guard index";
    }
}`, "experimental-v4" );
        expect( r.error ).toBeUndefined();
        // merged direct redeemer: take = 0, check = 1 (guards are appended last)
        const ok = run( r.flat!, guardContext( "scriptinfo_guarding_top", new DataConstr( 1, [] ) ) );
        if( !ok.ok ) throw new Error( `rejected: ${ok.msg}\n${ok.logs.join( "\n" )}` );
        // the spend redeemer against a guard purpose must NOT be accepted
        const wrong = run( r.flat!, guardContext( "scriptinfo_guarding_top", new DataConstr( 0, [] ) ) );
        expect( wrong.ok ).toBe( false );
    });

    test("the pre-existing purposes still compile under experimental-v4 (sugar is V4-aware)", async () => {
        const r = await compileContract(`
contract Plain {
    spend go() {
        const { tx } = context;
        assert std.list.length( tx.guards ) >= 0 else "v4 tx field";
    }
}`, "experimental-v4" );
        expect( r.error ).toBeUndefined();
    });
});
