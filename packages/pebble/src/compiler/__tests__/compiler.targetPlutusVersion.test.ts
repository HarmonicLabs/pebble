import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { dataFromCbor } from "@harmoniclabs/plutus-data";

// `targetPlutusVersion`: decides which ledger-API family the UNSUFFIXED
// prelude type names (`ScriptContext`, `Tx`, `TxOut`, ...) resolve to.
// The suffixed names (`...V3` / `...V4`) are always available.

async function exportWith(
    src: string,
    functionName: string,
    extra: Record<string, unknown> = {}
): Promise<{ flat?: Uint8Array; error?: string; diags: string[] }>
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: false,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION, ...extra } as any );
    try {
        const flat = await c.export({ entry: "main.pebble", root: "/", functionName } as any );
        return { flat, diags: c.diagnostics.map( d => d.toString() ) };
    } catch ( e ) {
        return {
            error: e instanceof Error ? e.message : String( e ),
            diags: c.diagnostics.map( d => d.toString() ),
        };
    }
}

const fixturesPath = path.resolve( __dirname, "fixtures/v4-data-encodings.json" );
const fixtures: Record<string, string> = existsSync( fixturesPath )
    ? JSON.parse( readFileSync( fixturesPath, "utf8" ) ).fixtures
    : {};

function evalFixture( flat: Uint8Array, fixtureName: string ): { ok: boolean; msg?: string; logs: string[] } {
    const d = dataFromCbor( fromHex( fixtures[ fixtureName ] ) );
    const res = Machine.eval( new Application( parseUPLC( flat ).body, UPLCConst.data( d ) ) );
    return res.result instanceof CEKError
        ? { ok: false, msg: res.result.msg, logs: res.logs }
        : { ok: true, logs: res.logs };
}

// touches fields that only exist on the V3 Tx (fee, requiredSigners)
const usesV3Tx = `
export function probe( d: data ): void {
    const ctx = d as ScriptContext;
    assert ctx.tx.fee >= 0 else "fee";
    assert std.list.length( ctx.tx.requiredSigners ) >= 0 else "signers";
}`;
// touches fields that only exist on the V4 Tx (subTxIx, guards, scriptHash)
const usesV4Tx = `
export function probe( d: data ): void {
    const ctx = d as ScriptContext;
    assert std.list.length( ctx.tx.guards ) >= 0 else "guards";
    assert ctx.scriptHash == ctx.scriptHash else "scriptHash";
}`;

jest.setTimeout( 300_000 );

describe("targetPlutusVersion — unsuffixed prelude names", () => {

    test("default (v3): `ScriptContext`/`Tx` are the V3 shapes", async () => {
        const v3 = await exportWith( usesV3Tx, "probe" );
        expect( v3.error ).toBeUndefined();

        const v4 = await exportWith( usesV4Tx, "probe" );
        expect( v4.error ).toBeDefined(); // no `guards` on the V3 Tx
    });

    test("experimental-v4: `ScriptContext`/`Tx` are the V4 shapes", async () => {
        const v4 = await exportWith( usesV4Tx, "probe", { targetPlutusVersion: "experimental-v4" } );
        expect( v4.error ).toBeUndefined();

        const v3 = await exportWith( usesV3Tx, "probe", { targetPlutusVersion: "experimental-v4" } );
        expect( v3.error ).toBeDefined(); // no `fee` on the V4 Tx
    });

    ( Object.keys( fixtures ).length > 0 ? test : test.skip )(
        "experimental-v4: the plain `ScriptContext` decodes the real 1.68 encoding", async () => {
        const { flat, error } = await exportWith(`
export function probe( d: data ): void {
    const ctx = d as ScriptContext;
    const Some{ value: ix } = ctx.tx.subTxIx;
    assert ix == 3 else "subTxIx";
    assert ctx.scriptHash == #11111111111111111111111111111111111111111111111111111111 else "scriptHash";
}`, "probe", { targetPlutusVersion: "experimental-v4" } );
        expect( error ).toBeUndefined();
        const r = evalFixture( flat!, "scriptcontext_full" );
        if( !r.ok ) throw new Error( `rejected: ${r.msg}\n${r.logs.join( "\n" )}` );
    });

    test("the suffixed names are available under BOTH targets", async () => {
        const explicitV3 = `
export function probe( d: data ): void {
    const ctx = d as ScriptContextV3;
    assert ctx.tx.fee >= 0 else "fee";
}`;
        const explicitV4 = `
export function probe( d: data ): void {
    const ctx = d as ScriptContextV4;
    assert std.list.length( ctx.tx.guards ) >= 0 else "guards";
}`;
        for( const target of [ "v3", "experimental-v4" ] )
        {
            const a = await exportWith( explicitV3, "probe", { targetPlutusVersion: target } );
            expect( a.error ).toBeUndefined();
            const b = await exportWith( explicitV4, "probe", { targetPlutusVersion: target } );
            expect( b.error ).toBeUndefined();
        }
    });

    test("`contract` declarations are rejected under experimental-v4 with a clear message", async () => {
        const src = `
contract C {
    spend go() {}
}`;
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
            useConsoleAsOutput: false,
        });
        const c = new Compiler( ioApi, {
            ...testOptions, compilerVersion: COMPILER_VERSION, targetPlutusVersion: "experimental-v4"
        } as any );
        await expect(
            c.compile({ entry: "main.pebble", root: "/" } as any )
        ).rejects.toThrow();
        expect(
            c.diagnostics.some( d => d.toString().includes( "contract" ) && d.toString().includes( "experimental-v4" ) )
        ).toBe( true );
    });

    test("values are normalized case-insensitively; unknown values throw", async () => {
        const ok = await exportWith( usesV4Tx, "probe", { targetPlutusVersion: "Experimental-V4" } );
        expect( ok.error ).toBeUndefined();

        const bad = await exportWith( usesV3Tx, "probe", { targetPlutusVersion: "v5" } );
        expect( bad.error ).toBeDefined();
        expect( bad.error ).toContain( "targetPlutusVersion" );
    });

    test('the plain "v4" spelling is reserved until the fork, with guidance', async () => {
        const r = await exportWith( usesV4Tx, "probe", { targetPlutusVersion: "v4" } );
        expect( r.error ).toBeDefined();
        expect( r.error ).toContain( "reserved" );
        expect( r.error ).toContain( "experimental-v4" );
    });
});
