import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

// Generic type aliases (0.4.3): `type Al<T> = …` registers on the generic
// registry (per encoding) and `Al<int>` instantiates through the same
// machinery as generic structs, wrapped in a `TirAliasType` named `Al<int>`.

async function compileFn( src: string ): Promise<UPLCTerm> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: "main", entry: "test.pebble", root: "/" });
    if( c.diagnostics.length )
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));
    return parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
}

async function checkOnly( src: string ): Promise<string[]> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.check({ entry: "test.pebble", root: "/" });
    return c.diagnostics.map(d => d.toString());
}

const errorsOnly = ( ds: string[] ) => ds.filter( d => d.startsWith("ERROR") );

function evalInt1( uplc: UPLCTerm, n: bigint ): bigint {
    const r = Machine.eval( new Application( uplc, UPLCConst.int( n ) ) ).result;
    return (r as CEKConst).value as bigint;
}

jest.setTimeout( 60_000 );

describe("generic type aliases", () => {

    test("identity alias `type Id<T> = T` evaluates", async () => {
        const uplc = await compileFn(`
type Id<T> = T;
export function main( n: int ): int {
    const x: Id<int> = n;
    return x + 1;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 6n );
    });

    test("container alias `type Lst<T> = List<T>` evaluates", async () => {
        const uplc = await compileFn(`
type Lst<T> = List<T>;
export function main( n: int ): int {
    const xs: Lst<int> = [ n, 1 ];
    return xs.length();
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 2n );
    });

    test("alias of a generic STRUCT `type B<T> = Box<T>`", async () => {
        const uplc = await compileFn(`
struct Box<T> { v: T }
type B<T> = Box<T>;
export function main( n: int ): int {
    const b: B<int> = Box{ v: n };
    return b.v;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("two-param alias of a generic struct", async () => {
        const uplc = await compileFn(`
struct Pair<A, B> { fst: A, snd: B }
type Swapped<A, B> = Pair<B, A>;
export function main( n: int ): int {
    const p: Swapped<bytes, int> = Pair{ fst: n, snd: #00 };
    return p.fst;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("generic alias in a function signature", async () => {
        const uplc = await compileFn(`
type Lst<T> = List<T>;
function count( xs: Lst<int> ): int { return xs.length(); }
export function main( n: int ): int {
    const xs: Lst<int> = [ n, 1, 2 ];
    return count( xs );
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 3n );
    });

    test("wrong arity is a clear error", async () => {
        const ds = errorsOnly( await checkOnly(`
type Id<T> = T;
export function main( n: int ): int {
    const x: Id<int, bytes> = n;
    return x;
}`) );
        expect( ds.length ).toBeGreaterThan( 0 );
        expect( ds.join("\n").toLowerCase() ).toContain( "type argument" );
    });

    test("duplicate type-param names are rejected", async () => {
        const ds = errorsOnly( await checkOnly(`
type P<T, T> = T;
export function main( n: int ): int { return n; }`) );
        expect( ds.length ).toBeGreaterThan( 0 );
        expect( ds.join("\n").toLowerCase() ).toContain( "already defined" );
    });

    test("exported generic alias imports across files", async () => {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["main.pebble", fromUtf8(`
import { Lst } from "./lib.pebble";
export function main( n: int ): int {
    const xs: Lst<int> = [ n ];
    return xs.length();
}`)],
                ["lib.pebble", fromUtf8(`export type Lst<T> = List<T>;`)],
            ]),
            useConsoleAsOutput: true,
        });
        const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
        await c.check({ entry: "main.pebble", root: "/" });
        expect( c.diagnostics.map(d => d.toString()).filter(d => d.startsWith("ERROR")) ).toEqual( [] );
    });
});
