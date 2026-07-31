import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

// Generic structs (0.4.3): `struct Box<T> { v: T }` for BOTH the data and the
// runtime (SoP) encodings — declaration, instantiation in type position,
// construction, field access, and the naming that keeps `Box<int>` and
// `Box<bytes>` distinct types in assignability checks.

/** compile a single exported function to UPLC; throws if diagnostics exist */
async function compileFn( name: string, src: string ): Promise<UPLCTerm> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: name, entry: "test.pebble", root: "/" });
    if( c.diagnostics.length )
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));
    return parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
}

/** run `check()` and return the diagnostic strings */
async function checkOnly( src: string ): Promise<string[]> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.check({ entry: "test.pebble", root: "/" });
    return c.diagnostics.map(d => d.toString());
}

/** multi-file variant of `checkOnly` */
async function checkProject( sources: Record<string, string>, entry: string ): Promise<string[]> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map(
            Object.entries( sources ).map(([ p, s ]) => [ p, fromUtf8( s ) ])
        ),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.check({ entry, root: "/" });
    return c.diagnostics.map(d => d.toString());
}

const errorsOnly = ( ds: string[] ) => ds.filter( d => d.startsWith("ERROR") );

function evalInt1( uplc: UPLCTerm, n: bigint ): bigint {
    const r = Machine.eval( new Application( uplc, UPLCConst.int( n ) ) ).result;
    return (r as CEKConst).value as bigint;
}

jest.setTimeout( 300_000 );

// --------------------------------------------------------------------------
// declaration + construction + field access
// --------------------------------------------------------------------------
describe("generic struct — construction and field access", () => {

    test("Box<int> (default encodings) round-trips a value", async () => {
        const uplc = await compileFn("main", `
struct Box<T> { v: T }
export function main( n: int ): int {
    const b: Box<int> = Box{ v: n };
    return b.v;
}`);
        expect( evalInt1( uplc, 42n ) ).toBe( 42n );
    });

    test("runtime struct Box<T> (SoP encoding) round-trips a value", async () => {
        const uplc = await compileFn("main", `
runtime struct Box<T> { v: T }
export function main( n: int ): int {
    const b: Box<int> = Box{ v: n };
    return b.v;
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 7n );
    });

    test("data struct Box<T> (data encoding) round-trips a value", async () => {
        const uplc = await compileFn("main", `
data struct Box<T> { v: T }
export function main( n: int ): int {
    const b: Box<int> = Box{ v: n };
    return b.v;
}`);
        expect( evalInt1( uplc, 11n ) ).toBe( 11n );
    });

    test("Box<bytes> compiles clean", async () => {
        const ds = errorsOnly( await checkOnly(`
struct Box<T> { v: T }
export function main( n: int ): int {
    const b: Box<bytes> = Box{ v: #abcd };
    const unused: bytes = b.v;
    return n;
}`) );
        expect( ds ).toEqual( [] );
    });

    test("multi-constructor generic struct dispatches correctly", async () => {
        const uplc = await compileFn("main", `
struct Maybe<T> { Nothing{} Just{ value: T } }
export function main( n: int ): int {
    const m: Maybe<int> = Maybe.Just{ value: n };
    return case m is Nothing{} => 0 is Just{ value } => value ;
}`);
        expect( evalInt1( uplc, 33n ) ).toBe( 33n );
    });
});

// --------------------------------------------------------------------------
// nested applications
// --------------------------------------------------------------------------
describe("generic struct — nested applications", () => {

    test("Box<Box<int>> round-trips a value", async () => {
        const uplc = await compileFn("main", `
struct Box<T> { v: T }
export function main( n: int ): int {
    const inner: Box<int> = Box{ v: n };
    const outer: Box<Box<int>> = Box{ v: inner };
    return outer.v.v;
}`);
        expect( evalInt1( uplc, 21n ) ).toBe( 21n );
    });

    test("Box<List<int>> composes with native generics", async () => {
        // NOTE: iterating the list FIELD (`for( const x of b.v )`) hits a
        // PRE-EXISTING data-decode bug ("mkCons :: incongruent list types")
        // that reproduces identically with a non-generic struct holding a
        // `List<int>` field — unrelated to generic structs, tracked
        // separately. This test only covers the generic-application side:
        // construction, field typing, and evaluation without iteration.
        const uplc = await compileFn("main", `
struct Box<T> { v: T }
export function main( n: int ): int {
    const b: Box<List<int>> = Box{ v: [n, 1, 2] };
    const xs: List<int> = b.v;
    return n + 1;
}`);
        expect( evalInt1( uplc, 10n ) ).toBe( 11n );
    });

    test("generic struct field referencing another generic struct (R2)", async () => {
        const uplc = await compileFn("main", `
struct Wrapper<T> { w: T }
struct Box<T> { inner: Wrapper<T> }
export function main( n: int ): int {
    const b: Box<int> = Box{ inner: Wrapper{ w: n } };
    return b.inner.w;
}`);
        expect( evalInt1( uplc, 55n ) ).toBe( 55n );
    });
});

// --------------------------------------------------------------------------
// type identity (Blocker A) — instantiations are DISTINCT types
// --------------------------------------------------------------------------
describe("generic struct — instantiations are distinct types", () => {

    test("Pair<int,bytes> and Pair<bytes,int> both work", async () => {
        const uplc = await compileFn("main", `
struct Pair<A, B> { fst: A, snd: B }
export function main( n: int ): int {
    const p: Pair<int, bytes> = Pair{ fst: n, snd: #00 };
    const q: Pair<bytes, int> = Pair{ fst: #11, snd: n + 1 };
    return p.fst + q.snd;
}`);
        expect( evalInt1( uplc, 10n ) ).toBe( 21n );
    });

    test("assigning Box<int> where Box<bytes> is expected is rejected", async () => {
        const ds = errorsOnly( await checkOnly(`
struct Box<T> { v: T }
function wantBytes( b: Box<bytes> ): int { return 1; }
export function main( n: int ): int {
    const b: Box<int> = Box{ v: n };
    return wantBytes( b );
}`) );
        expect( ds.length ).toBeGreaterThan( 0 );
    });

    test("passing Pair<bytes,int> where Pair<int,bytes> is expected is rejected", async () => {
        const ds = errorsOnly( await checkOnly(`
struct Pair<A, B> { fst: A, snd: B }
function want( p: Pair<int, bytes> ): int { return p.fst; }
export function main( n: int ): int {
    const q: Pair<bytes, int> = Pair{ fst: #11, snd: n };
    return want( q );
}`) );
        expect( ds.length ).toBeGreaterThan( 0 );
    });
});

// --------------------------------------------------------------------------
// generic structs in generic function signatures
// --------------------------------------------------------------------------
describe("generic struct — in generic function signatures", () => {

    test("function over Box<T> monomorphizes at the call site", async () => {
        const uplc = await compileFn("main", `
struct Box<T> { v: T }
function unbox<T>( b: Box<T> ): T { return b.v; }
export function main( n: int ): int {
    const b: Box<int> = Box{ v: n };
    return unbox<int>( b );
}`);
        expect( evalInt1( uplc, 99n ) ).toBe( 99n );
    });

    test("type args are INFERRED from a generic-struct argument", async () => {
        const uplc = await compileFn("main", `
struct Box<T> { v: T }
function unbox<T>( b: Box<T> ): T { return b.v; }
export function main( n: int ): int {
    const b: Box<int> = Box{ v: n };
    return unbox( b );
}`);
        expect( evalInt1( uplc, 43n ) ).toBe( 43n );
    });

    test("generic function RETURNING a generic struct", async () => {
        const uplc = await compileFn("main", `
struct Box<T> { v: T }
function wrap<T>( v: T ): Box<T> { return Box{ v: v }; }
export function main( n: int ): int {
    const b: Box<int> = wrap<int>( n );
    return b.v;
}`);
        expect( evalInt1( uplc, 44n ) ).toBe( 44n );
    });

    test("generic function over a RECURSIVE generic struct (Tree<T>)", async () => {
        const uplc = await compileFn("main", `
data struct Tree<T> {
    Leaf { value: T }
    Branch { value: T, left: Tree<T>, right: Tree<T> }
}
function size<T>( t: Tree<T> ): int {
    return case t
        is Leaf{ value } => 1
        is Branch{ value, left, right } => 1 + size<T>( left ) + size<T>( right );
}
export function main( n: int ): int {
    const t: Tree<int> = Tree.Branch{ value: n, left: Tree.Leaf{ value: 1 }, right: Tree.Leaf{ value: 2 } };
    return size<int>( t );
}`);
        expect( evalInt1( uplc, 10n ) ).toBe( 3n );
    });

    test("inference rejects inconsistent bindings (Pair<int,int> vs same<T>(Pair<T,T>) with Pair<int,bytes>)", async () => {
        const ds = errorsOnly( await checkOnly(`
struct Pair<A, B> { fst: A, snd: B }
function firstOfSame<T>( p: Pair<T, T> ): T { return p.fst; }
export function main( n: int ): int {
    const p: Pair<int, bytes> = Pair{ fst: n, snd: #00 };
    return firstOfSame( p );
}`) );
        expect( ds.length ).toBeGreaterThan( 0 );
    });
});

// --------------------------------------------------------------------------
// diagnostics
// --------------------------------------------------------------------------
describe("generic struct — diagnostics", () => {

    test("wrong arity Box<int, bytes> is an error", async () => {
        const ds = errorsOnly( await checkOnly(`
struct Box<T> { v: T }
export function main( n: int ): int {
    const b: Box<int, bytes> = Box{ v: n };
    return n;
}`) );
        expect( ds.length ).toBeGreaterThan( 0 );
        expect( ds.join("\n").toLowerCase() ).toContain( "type argument" );
    });

    test("too few args Pair<int> is an error", async () => {
        const ds = errorsOnly( await checkOnly(`
struct Pair<A, B> { fst: A, snd: B }
export function main( n: int ): int {
    const p: Pair<int> = Pair{ fst: n, snd: n };
    return n;
}`) );
        expect( ds.length ).toBeGreaterThan( 0 );
    });

    test("bare Box (no type args) in type position is an error", async () => {
        const ds = errorsOnly( await checkOnly(`
struct Box<T> { v: T }
export function main( n: int ): int {
    const b: Box = Box{ v: n };
    return n;
}`) );
        expect( ds.length ).toBeGreaterThan( 0 );
    });

    test("duplicate type-param names are rejected", async () => {
        const ds = errorsOnly( await checkOnly(`
struct Box<T, T> { v: T }
export function main( n: int ): int { return n; }`) );
        expect( ds.length ).toBeGreaterThan( 0 );
        expect( ds.join("\n").toLowerCase() ).toContain( "already defined" );
    });

    test("methods on a generic struct are rejected with a clear message", async () => {
        const ds = errorsOnly( await checkOnly(`
struct Box<T> { v: T }
type Box implements Show {
    show( self ): bytes { return #00; }
}
export function main( n: int ): int { return n; }`) );
        expect( ds.length ).toBeGreaterThan( 0 );
        expect( ds.join("\n").toLowerCase() ).toContain( "not supported" );
    });
});

// --------------------------------------------------------------------------
// exported generic structs across files (R5)
// --------------------------------------------------------------------------
describe("generic struct — exported across files", () => {

    test("importing a generic struct from another file works", async () => {
        const ds = errorsOnly( await checkProject({
            "main.pebble": `
import { Box } from "./lib.pebble";
export function main( n: int ): int {
    const b: Box<int> = Box{ v: n };
    return b.v;
}`,
            "lib.pebble": `export struct Box<T> { v: T }`,
        }, "main.pebble") );
        expect( ds ).toEqual( [] );
    });
});
