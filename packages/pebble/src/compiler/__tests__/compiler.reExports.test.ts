import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

// Re-exports (0.4.3): `export * from "./lib.pebble"` and
// `export { x, y as z } from "./lib.pebble"` merge the referenced file's
// exported symbols into the re-exporting file's exports. Per TS semantics
// the names are NOT brought into the re-exporting file's own scope.

async function project( sources: Record<string, string>, entry: string ) {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map(
            Object.entries( sources ).map(([ p, s ]) => [ p, fromUtf8( s ) ])
        ),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    return { c, ioApi };
}

async function checkProject( sources: Record<string, string>, entry: string ): Promise<string[]> {
    const { c } = await project( sources, entry );
    await c.check({ entry, root: "/" });
    return c.diagnostics.map(d => d.toString());
}

async function runProject( sources: Record<string, string>, entry: string, n: bigint ): Promise<bigint> {
    const { c, ioApi } = await project( sources, entry );
    await c.export({ functionName: "main", entry, root: "/" });
    if( c.diagnostics.length )
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));
    const uplc: UPLCTerm = parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
    const r = Machine.eval( new Application( uplc, UPLCConst.int( n ) ) ).result;
    if( !( r instanceof CEKConst ) ) throw new Error( "eval failed: " + JSON.stringify( (r as any).msg ?? r ) );
    return r.value as bigint;
}

const errorsOnly = ( ds: string[] ) => ds.filter( d => d.startsWith("ERROR") );

jest.setTimeout( 60_000 );

describe("export * from", () => {

    test("re-exported function is importable and runs", async () => {
        const result = await runProject({
            "main.pebble": `
import { double } from "./middle.pebble";
export function main( n: int ): int { return double( n ); }`,
            "middle.pebble": `export * from "./lib.pebble";`,
            "lib.pebble": `export function double( n: int ): int { return n * 2; }`,
        }, "main.pebble", 5n);
        expect( result ).toBe( 10n );
    });

    test("re-exported struct TYPE is importable", async () => {
        const result = await runProject({
            "main.pebble": `
import { Box } from "./middle.pebble";
export function main( n: int ): int {
    const b: Box = Box{ v: n };
    return b.v;
}`,
            "middle.pebble": `export * from "./lib.pebble";`,
            "lib.pebble": `export struct Box { v: int }`,
        }, "main.pebble", 5n);
        expect( result ).toBe( 5n );
    });

    test("re-exported GENERIC struct is importable", async () => {
        const ds = errorsOnly( await checkProject({
            "main.pebble": `
import { Box } from "./middle.pebble";
export function main( n: int ): int {
    const b: Box<int> = Box{ v: n };
    return b.v;
}`,
            "middle.pebble": `export * from "./lib.pebble";`,
            "lib.pebble": `export struct Box<T> { v: T }`,
        }, "main.pebble") );
        expect( ds ).toEqual( [] );
    });

    test("star re-export CHAIN (a -> b -> c) resolves", async () => {
        const result = await runProject({
            "main.pebble": `
import { double } from "./a.pebble";
export function main( n: int ): int { return double( n ); }`,
            "a.pebble": `export * from "./b.pebble";`,
            "b.pebble": `export * from "./c.pebble";`,
            "c.pebble": `export function double( n: int ): int { return n * 2; }`,
        }, "main.pebble", 5n);
        expect( result ).toBe( 10n );
    });

    test("star re-export does NOT bring names into the local scope", async () => {
        const ds = errorsOnly( await checkProject({
            "main.pebble": `
export * from "./lib.pebble";
export function main( n: int ): int { return double( n ); }`,
            "lib.pebble": `export function double( n: int ): int { return n * 2; }`,
        }, "main.pebble") );
        expect( ds.length ).toBeGreaterThan( 0 );
    });

    test("re-exporter can also declare its own exports", async () => {
        const result = await runProject({
            "main.pebble": `
import { double, triple } from "./middle.pebble";
export function main( n: int ): int { return double( n ) + triple( n ); }`,
            "middle.pebble": `
export * from "./lib.pebble";
export function triple( n: int ): int { return n * 3; }`,
            "lib.pebble": `export function double( n: int ): int { return n * 2; }`,
        }, "main.pebble", 5n);
        expect( result ).toBe( 25n );
    });
});

describe("export { x } from", () => {

    test("named re-export is importable and runs", async () => {
        const result = await runProject({
            "main.pebble": `
import { double } from "./middle.pebble";
export function main( n: int ): int { return double( n ); }`,
            "middle.pebble": `export { double } from "./lib.pebble";`,
            "lib.pebble": `
export function double( n: int ): int { return n * 2; }
export function unrelated( n: int ): int { return n; }`,
        }, "main.pebble", 5n);
        expect( result ).toBe( 10n );
    });

    test("named re-export with ALIAS", async () => {
        const result = await runProject({
            "main.pebble": `
import { twice } from "./middle.pebble";
export function main( n: int ): int { return twice( n ); }`,
            "middle.pebble": `export { double as twice } from "./lib.pebble";`,
            "lib.pebble": `export function double( n: int ): int { return n * 2; }`,
        }, "main.pebble", 5n);
        expect( result ).toBe( 10n );
    });

    test("named re-export only exposes the NAMED symbols", async () => {
        const ds = errorsOnly( await checkProject({
            "main.pebble": `
import { unrelated } from "./middle.pebble";
export function main( n: int ): int { return unrelated( n ); }`,
            "middle.pebble": `export { double } from "./lib.pebble";`,
            "lib.pebble": `
export function double( n: int ): int { return n * 2; }
export function unrelated( n: int ): int { return n; }`,
        }, "main.pebble") );
        expect( ds.length ).toBeGreaterThan( 0 );
    });

    test("re-exporting a MISSING symbol is a clear error", async () => {
        const ds = errorsOnly( await checkProject({
            "main.pebble": `
export { nope } from "./lib.pebble";
export function main( n: int ): int { return n; }`,
            "lib.pebble": `export function double( n: int ): int { return n * 2; }`,
        }, "main.pebble") );
        expect( ds.length ).toBeGreaterThan( 0 );
        expect( ds.join("\n").toLowerCase() ).toContain( "no exported member" );
    });
});
