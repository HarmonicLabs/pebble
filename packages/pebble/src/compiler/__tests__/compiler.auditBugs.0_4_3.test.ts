import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

// Regression tests for the 0.4.3 second-axis audit (BUGs 45-47), see
// PEBBLE_BUGS.md. BUG 45's full field coverage lives in the
// `compiler.structFieldRoundTrip.test.ts` matrix ("Value" row).

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
    if( !( r instanceof CEKConst ) ) throw new Error( "eval failed: " + JSON.stringify( (r as any).msg ?? r ) );
    return r.value as bigint;
}

jest.setTimeout( 60_000 );

// --------------------------------------------------------------------------
// BUG 45 — `Value` as a `data struct` field round-trips
// --------------------------------------------------------------------------
describe("BUG 45 — Value as a data-struct field", () => {

    test("original repro evaluates", async () => {
        const uplc = await compileFn(`
data struct S { C{ v: Value, n: int } }
export function main( n: int ): int {
    const s: S = S.C{ v: std.value.zero, n: n };
    return case s is C{ v, n: m } => m ;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("the Value field itself decodes (round-trips through data)", async () => {
        const uplc = await compileFn(`
data struct S { C{ v: Value } }
export function main( n: int ): int {
    const s: S = S.C{ v: std.value.zero };
    return case s is C{ v } => ( v.toData() == std.value.zero.toData() ? n : 0 ) ;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });
});

// --------------------------------------------------------------------------
// BUG 46 — `case` initializer is not newline-sensitive
// --------------------------------------------------------------------------
describe("BUG 46 — case-as-initializer parses regardless of line breaks", () => {

    test("one-line `const x = case … ; return x;` parses and evaluates", async () => {
        const uplc = await compileFn(`
data struct Sh { C{ r: int } S{ s: int } }
export function main( n: int ): int {
    const sh: Sh = Sh.C{ r: n }; const x = case sh is C{ r } => r is S{ s } => s ; return x;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("multi-line form still parses identically", async () => {
        const uplc = await compileFn(`
data struct Sh { C{ r: int } S{ s: int } }
export function main( n: int ): int {
    const sh: Sh = Sh.C{ r: n };
    const x = case sh is C{ r } => r is S{ s } => s ;
    return x;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("case in return position keeps its statement semicolon", async () => {
        const uplc = await compileFn(`
data struct Sh { C{ r: int } S{ s: int } }
export function main( n: int ): int {
    const sh: Sh = Sh.C{ r: n };
    return case sh is C{ r } => r is S{ s } => s ;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });
});

// --------------------------------------------------------------------------
// BUG 47 — generic prelude types work in cast position
// --------------------------------------------------------------------------
describe("BUG 47 — generic types in cast position", () => {

    test("`as LinearMap<bytes,bytes>` resolves and compiles", async () => {
        const ds = errorsOnly( await checkOnly(`
export function main( d: data ): int {
    const m = std.builtins.unMapData( d ) as LinearMap<bytes, bytes>;
    return m.length();
}`) );
        expect( ds ).toEqual( [] );
    });

    test("direct cast EXPORTS identically to the alias workaround", async () => {
        // both forms must reach codegen (the alias form was the documented
        // workaround; the direct form used to die with "'LinearMap' is not
        // defined")
        const direct = await compileFn(`
export function main( d: data ): int {
    const m = std.builtins.unMapData( d ) as LinearMap<bytes, bytes>;
    return m.length();
}`);
        const aliased = await compileFn(`
type M2 = LinearMap<bytes, bytes>;
export function main( d: data ): int {
    const m = std.builtins.unMapData( d ) as M2;
    return m.length();
}`);
        expect( direct ).toBeDefined();
        expect( aliased ).toBeDefined();
    });

    test("`as Box<int>` (user generic struct) in cast position resolves", async () => {
        const ds = errorsOnly( await checkOnly(`
struct Box<T> { v: T }
export function main( n: int ): int {
    const b: Box<int> = Box{ v: n };
    const d = b as data;
    const back = d as Box<int>;
    return back.v;
}`) );
        expect( ds ).toEqual( [] );
    });
});

// --------------------------------------------------------------------------
// BUG 48 — struct constructors are reachable through qualified namespace paths
// --------------------------------------------------------------------------
describe("BUG 48 — namespace-qualified struct constructors", () => {

    test("`M.S.C{ ... }` constructs and matches (original repro)", async () => {
        const uplc = await compileFn(`
namespace M { data struct S { C{ v: int } } }
export function main( n: int ): int {
    const s: M.S = M.S.C{ v: n };
    return case s is C{ v } => v ;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("nested namespaces: `A.B.S.C{ ... }`", async () => {
        const uplc = await compileFn(`
namespace A { export namespace B { export data struct S { C{ v: int } } } }
export function main( n: int ): int {
    const s: A.B.S = A.B.S.C{ v: n };
    return case s is C{ v } => v ;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("plain `Type.Constructor{ ... }` form is unaffected", async () => {
        const uplc = await compileFn(`
data struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int {
    const v: T = T.B{ y: n };
    return case v is A{ x } => 111 is B{ y } => y ;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("unknown namespace head errors clearly", async () => {
        const ds = errorsOnly( await checkOnly(`
export function main( n: int ): int {
    const s = Nope.S.C{ v: n };
    return n;
}`) );
        expect( ds.length ).toBeGreaterThan( 0 );
        expect( ds.join("\n") ).toContain( "not defined" );
    });
});
