import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { Data, DataConstr, DataI, dataFromCbor } from "@harmoniclabs/plutus-data";

// Execution levels for contract methods (Plutus V4 nested transactions):
//   `top <purpose>`    — valid only in the top-level transaction (DEFAULT)
//   `nested <purpose>` — valid only inside a sub-transaction
// The derived contract body matches `tx.subTxIx` BEFORE the purpose, so a
// contract written without level keywords always fails when executed in a
// sub-transaction. Under the "v3" target `nested` is an error and `top` is
// a no-op.
//
// Contexts are assembled from the real plutus-ledger-api 1.68 encodings in
// fixtures/v4-data-encodings.json.

const fixturesPath = path.resolve( __dirname, "fixtures/v4-data-encodings.json" );
const hasFixtures = existsSync( fixturesPath );
const fixtures: Record<string, string> = hasFixtures
    ? JSON.parse( readFileSync( fixturesPath, "utf8" ) ).fixtures
    : {};

async function compileContract(
    src: string,
    target?: string
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

const fx = ( name: string ) => dataFromCbor( fromHex( fixtures[ name ] ) );

/**
 * V4 ScriptContext = Constr 0 [ tx, redeemer, scriptInfo, scriptHash ],
 * TxInfo field 1 = subTxIx (None = top-level, Some i = sub-transaction i).
 */
function ctx( opts: {
    level: "top" | "nested";
    purpose: Data;
    redeemer: Data;
}): Data
{
    const full = fx( "scriptcontext_full" ) as DataConstr;
    const tx = full.fields[0] as DataConstr;
    const txFields = tx.fields.slice();
    txFields[1] = opts.level === "top"
        ? new DataConstr( 1, [] )                   // None
        : new DataConstr( 0, [ new DataI( 3 ) ] );  // Some 3
    return new DataConstr( 0, [
        new DataConstr( 0, txFields ),
        opts.redeemer,
        opts.purpose,
        full.fields[3],
    ]);
}

/** Spend{ ref, Some(datum) } built from the spending fixture */
function spendPurpose( datum?: Data ): Data
{
    const p = fx( "scriptinfo_spending" ) as DataConstr;
    if( !datum ) return p;
    return new DataConstr( 1, [ p.fields[0], new DataConstr( 0, [ datum ] ) ] );
}

const unitRedeemer = ( tag: number ) => new DataConstr( tag, [] );

function run( flat: Uint8Array, c: Data ): { ok: boolean; msg?: string; logs: string[] } {
    const res = Machine.eval( new Application( parseUPLC( flat ).body, UPLCConst.data( c ) ) );
    return res.result instanceof CEKError
        ? { ok: false, msg: res.result.msg, logs: res.logs }
        : { ok: true, logs: res.logs };
}

function expectOk( r: { ok: boolean; msg?: string; logs: string[] }, what: string ): void {
    if( !r.ok ) throw new Error( `${what}: rejected: ${r.msg}\n${r.logs.join( "\n" )}` );
}

jest.setTimeout( 300_000 );

const d = hasFixtures ? describe : describe.skip;

d("execution levels — `top` / `nested` contract methods", () => {

    test("a contract without level keywords is top-only: it FAILS in a sub-transaction", async () => {
        const r = await compileContract(`
contract Plain {
    spend go() {
        assert true else "never";
    }
}`, "experimental-v4" );
        expect( r.error ).toBeUndefined();
        expectOk( run( r.flat!, ctx({ level: "top", purpose: spendPurpose(), redeemer: unitRedeemer( 0 ) }) ), "top-level spend" );
        const nested = run( r.flat!, ctx({ level: "nested", purpose: spendPurpose(), redeemer: unitRedeemer( 0 ) }) );
        expect( nested.ok ).toBe( false );
    });

    test("`nested spend` only: valid in a sub-transaction, FAILS at the top level", async () => {
        const r = await compileContract(`
contract Sub {
    nested spend go() {
        assert true else "never";
    }
}`, "experimental-v4" );
        expect( r.error ).toBeUndefined();
        expectOk( run( r.flat!, ctx({ level: "nested", purpose: spendPurpose(), redeemer: unitRedeemer( 0 ) }) ), "nested spend" );
        const top = run( r.flat!, ctx({ level: "top", purpose: spendPurpose(), redeemer: unitRedeemer( 0 ) }) );
        expect( top.ok ).toBe( false );
    });

    test("same purpose at both levels: the level is matched BEFORE the purpose/redeemer", async () => {
        const r = await compileContract(`
contract Both {
    top mint onTop() {
        assert true else "never";
    }
    nested mint onNested() {
        assert true else "never";
    }
}`, "experimental-v4" );
        expect( r.error ).toBeUndefined();
        const minting = fx( "scriptinfo_minting" );
        // merged redeemer: onTop = 0, onNested = 1
        expectOk( run( r.flat!, ctx({ level: "top", purpose: minting, redeemer: unitRedeemer( 0 ) }) ), "top mint" );
        expectOk( run( r.flat!, ctx({ level: "nested", purpose: minting, redeemer: unitRedeemer( 1 ) }) ), "nested mint" );
        // a method of the OTHER level is not reachable even with the right redeemer tag
        expect( run( r.flat!, ctx({ level: "top", purpose: minting, redeemer: unitRedeemer( 1 ) }) ).ok ).toBe( false );
        expect( run( r.flat!, ctx({ level: "nested", purpose: minting, redeemer: unitRedeemer( 0 ) }) ).ok ).toBe( false );
    });

    test("levels apply to state spend methods too", async () => {
        const r = await compileContract(`
contract Vault {
    state Locked {
        amount: int;

        nested spend take() {
            const { state } = context;
            assert state.amount == 99 else "datum";
        }
    }
}`, "experimental-v4" );
        expect( r.error ).toBeUndefined();
        // single-state datum: Locked{ amount: 99 } = Constr 0 [I 99]
        const purpose = spendPurpose( new DataConstr( 0, [ new DataI( 99 ) ] ) );
        expectOk( run( r.flat!, ctx({ level: "nested", purpose, redeemer: unitRedeemer( 0 ) }) ), "nested state spend" );
        expect( run( r.flat!, ctx({ level: "top", purpose, redeemer: unitRedeemer( 0 ) }) ).ok ).toBe( false );
    });

    test("`nested guard` runs in a sub-transaction; a level-less guard fails there", async () => {
        const nestedGuard = await compileContract(`
contract G {
    nested guard check() {
        const { topTxInfo } = context;
        assert topTxInfo is None else "sub-transaction guards get no batch view";
    }
}`, "experimental-v4" );
        expect( nestedGuard.error ).toBeUndefined();
        expectOk( run( nestedGuard.flat!, ctx({ level: "nested", purpose: fx( "scriptinfo_guarding_sub" ), redeemer: unitRedeemer( 0 ) }) ), "nested guard" );

        const topGuard = await compileContract(`
contract G {
    guard check() {
        assert true else "never";
    }
}`, "experimental-v4" );
        expect( topGuard.error ).toBeUndefined();
        expect( run( topGuard.flat!, ctx({ level: "nested", purpose: fx( "scriptinfo_guarding_sub" ), redeemer: unitRedeemer( 0 ) }) ).ok ).toBe( false );
        expectOk( run( topGuard.flat!, ctx({ level: "top", purpose: fx( "scriptinfo_guarding_top" ), redeemer: unitRedeemer( 0 ) }) ), "top guard" );
    });
});

describe("execution levels — v3 target", () => {

    test("`nested` is rejected under v3 with a located diagnostic naming the option", async () => {
        const r = await compileContract(`
contract C {
    nested spend go() {}
}`);
        expect( r.error ).toBeDefined();
        const diag = r.diags.find( d => d.includes( "nested" ) );
        expect( diag ).toBeDefined();
        expect( diag ).toContain( "targetPlutusVersion" );
        expect( diag ).toContain( "experimental-v4" );
    });

    test("`top` is accepted under v3 and compiles byte-identically to no keyword", async () => {
        const plain = await compileContract(`
contract C {
    spend go() { assert true else "x"; }
    mint m() { assert true else "y"; }
}`);
        const explicit = await compileContract(`
contract C {
    top spend go() { assert true else "x"; }
    top mint m() { assert true else "y"; }
}`);
        expect( plain.error ).toBeUndefined();
        expect( explicit.error ).toBeUndefined();
        expect( Buffer.from( explicit.flat! ).equals( Buffer.from( plain.flat! ) ) ).toBe( true );
    });

    test("`top` and `nested` stay usable as identifiers (a state field named `top`)", async () => {
        const r = await compileContract(`
contract C {
    state S {
        top: int;
        nested: int;
        spend go() {
            const { state } = context;
            const top = state.top + state.nested;
            assert top >= 0 else "x";
        }
    }
}`);
        expect( r.error ).toBeUndefined();
    });

    test("a level keyword must be followed by a purpose keyword", async () => {
        const r = await compileContract(`
contract C {
    nested state S { n: int; }
}`, "experimental-v4" );
        expect( r.error ).toBeDefined();
    });
});
