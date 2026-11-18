import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

// Regression tests for the bugs found while writing the step scripts of the
// Jacquard reference ledger (the L1 re-execution of one transition) against
// 0.6.0-dev0: BUGs 82 and later, see PEBBLE_BUGS.md. Each `describe` names its
// bug; a case asserts the EVALUATED result, or the exact diagnostic.

async function compileFn( src: string ): Promise<UPLCTerm> {
    const sources = new Map<string, Uint8Array>([["test.pebble", fromUtf8(src)]]);
    const ioApi = createMemoryCompilerIoApi({ sources, useConsoleAsOutput: false });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: "main", entry: "test.pebble", root: "/" });
    const errors = c.diagnostics.map( d => d.toString() ).filter( d => d.startsWith("ERROR") );
    if( errors.length )
        throw new Error("compile failed: " + errors.join("\n"));
    return parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
}

async function diagnosticsOf( src: string ): Promise<string[]> {
    const sources = new Map<string, Uint8Array>([["test.pebble", fromUtf8(src)]]);
    const ioApi = createMemoryCompilerIoApi({ sources, useConsoleAsOutput: false });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.check({ entry: "test.pebble", root: "/" });
    return c.diagnostics.map(d => d.toString());
}

function evalInt1( uplc: UPLCTerm, n: bigint ): bigint {
    const r = Machine.eval( new Application( uplc, UPLCConst.int( n ) ) ).result;
    if( !( r instanceof CEKConst ) ) throw new Error( "eval failed: " + JSON.stringify( (r as any).msg ?? r ) );
    return r.value as bigint;
}

// BUG 82 — the cache of keys a step has opened was first written as a list of
// runtime structs. A UPLC list holds constants; a runtime struct is a
// constructor term. The checker took the type, and the back end failed on the
// first literal with "SoP struct cannot be represented as uplc constants" and
// no place in the source.

describe("BUG 82: a List of runtime structs is refused where it is written", () => {

    const entry = `
runtime struct Entry { key: bytes, value: int }
`;
    const refused = ( diags: string[] ) => diags.filter( d => d.startsWith("ERROR 30213") );

    test("as the type of a variable", async () => {
        const diags = await diagnosticsOf( `${entry}
export function main( n: int ): int {
    const none: List<Entry> = [];
    return none.length() + n;
}` );
        expect( refused( diags ).length ).toBe( 1 );
        expect( refused( diags )[0] ).toContain( "'Entry' is a runtime struct" );
    });

    test("as a parameter, and as the values of a map", async () => {
        expect( refused( await diagnosticsOf( `${entry}
function count( xs: List<Entry> ): int { return xs.length(); }
export function main( n: int ): int { return n; }` ) ).length ).toBe( 1 );
        expect( refused( await diagnosticsOf( `${entry}
export function main( n: int ): int {
    const none: LinearMap<int, Entry> = {};
    return n;
}` ) ).length ).toBe( 1 );
    });

    test("control: the same list of a data struct is built and read", async () => {
        const uplc = await compileFn( `
data struct Entry { key: bytes, value: int }
function sum( xs: List<Entry> ): int {
    let total = 0;
    for( const x of xs ) { total = total + x.value; }
    return total;
}
export function main( n: int ): int {
    const none: List<Entry> = [];
    const xs = none.prepend( Entry{ key: #61, value: n } ).prepend( Entry{ key: #62, value: 2 } );
    return sum( xs );
}` );
        expect( evalInt1( uplc, 40n ) ).toBe( 42n );
    });

    test("control: a recursive runtime struct is a list of runtime structs", async () => {
        const uplc = await compileFn( `
runtime struct Entry { key: bytes, value: int }
runtime struct Cache {
    Nil {}
    Cons { head: Entry, tail: Cache }
}
function sum( c: Cache ): int {
    return case c
        is Nil{} => 0
        is Cons{ head, tail } => head.value + sum( tail )
        ;
}
export function main( n: int ): int {
    const one = Cache.Cons{ head: Entry{ key: #61, value: n }, tail: Cache.Nil{} };
    const two = Cache.Cons{ head: Entry{ key: #62, value: 2 }, tail: one };
    return sum( two );
}` );
        expect( evalInt1( uplc, 40n ) ).toBe( 42n );
    });
});

// BUG 83 — the assets of a value read off some data: `unListData( d ) as
// List<Asset>`. The checker takes a cast between two lists whenever their
// elements cast to each other; the back end had no case for a list at all.

describe("BUG 83: a cast between two lists", () => {

    const asset = `
data struct Asset { policy: bytes, name: bytes, qty: int }
`;
    const errors = ( diags: string[] ) => diags.filter( d => d.startsWith("ERROR") );

    test("a list of data is read as a list of a data struct, and back", async () => {
        const uplc = await compileFn( `${asset}
function total( xs: List<Asset> ): int {
    let sum = 0;
    for( const x of xs ) { sum = sum + x.qty; }
    return sum;
}
export function main( n: int ): int {
    const one: List<Asset> = [ Asset{ policy: #, name: #, qty: n }, Asset{ policy: #aa, name: #61, qty: 2 } ];
    const raw: data = one.toData();
    const read = std.builtins.unListData( raw ) as List<Asset>;
    const again = read as List<data>;
    return total( read ) + again.length();
}` );
        expect( evalInt1( uplc, 40n ) ).toBe( 44n );
    });

    test("a list of data is decoded into a list of integers, and a list of integers encoded", async () => {
        const uplc = await compileFn( `
export function main( n: int ): int {
    const ints: List<int> = [ n, 2 ];
    const raw: data = ints.toData();
    const read = std.builtins.unListData( raw ) as List<int>;
    const back = read as List<data>;
    return read.head() + read.tail().head() + std.builtins.unIData( back.head() );
}` );
        expect( evalInt1( uplc, 40n ) ).toBe( 82n );
    });

    test("a list of integers is not a list of byte strings: refused where it is written", async () => {
        const diags = await diagnosticsOf( `
export function main( n: int ): int {
    const ints: List<int> = [ n, 2 ];
    const bs = ints as List<bytes>;
    return bs.length();
}` );
        expect( errors( diags ).length ).toBe( 1 );
        expect( errors( diags )[0] ).toContain( "cannot be converted" );
    });

    test("control: a list cast to its own type is itself", async () => {
        const uplc = await compileFn( `
export function main( n: int ): int {
    const ints: List<int> = [ n, 2 ];
    return ( ints as List<int> ).head();
}` );
        expect( evalInt1( uplc, 40n ) ).toBe( 40n );
    });
});

// BUG 84 — the state a step works on is a runtime struct, and the effects of
// the batch are another one, held in a field of it. Any read of the outer
// struct failed in the back end: "simple var decl without init expr".

describe("BUG 84: a runtime struct in a field of a runtime struct", () => {

    const head = `
runtime struct Fx { acc: bytes, count: int }
runtime struct Work { ok: boolean, leaves: int, fx: Fx }
function start( n: int ): Work {
    return Work{ ok: true, leaves: n, fx: Fx{ acc: #aa, count: 2 } };
}
`;

    test("a field of the outer one is read", async () => {
        const uplc = await compileFn( `${head}
export function main( n: int ): int {
    const w = Work{ ok: true, leaves: n, fx: Fx{ acc: #aa, count: 2 } };
    return w.leaves;
}` );
        expect( evalInt1( uplc, 3n ) ).toBe( 3n );
    });

    test("a field of the inner one is read through the outer", async () => {
        const uplc = await compileFn( `${head}
export function main( n: int ): int {
    const w = start( n );
    return w.fx.count + w.leaves + w.fx.acc.length();
}` );
        expect( evalInt1( uplc, 3n ) ).toBe( 6n );
    });

    test("both are passed to functions and built again from their fields", async () => {
        const uplc = await compileFn( `${head}
function bump( w: Work ): Work {
    const fx = w.fx;
    return Work{ ok: w.ok, leaves: w.leaves + 1, fx: Fx{ acc: fx.acc, count: fx.count + 10 } };
}
export function main( n: int ): int {
    const w = bump( bump( start( n ) ) );
    return w.fx.count + w.leaves + w.fx.acc.length();
}` );
        expect( evalInt1( uplc, 3n ) ).toBe( 28n );
    });

    test("three deep, and destructured by name", async () => {
        const uplc = await compileFn( `
runtime struct A { x: int }
runtime struct B { a: A, y: int }
runtime struct C { b: B, z: int }
function mk( n: int ): C { return C{ b: B{ a: A{ x: n }, y: 10 }, z: 100 }; }
export function main( n: int ): int {
    const c = mk( n );
    const b = c.b;
    const C{ z } = c;
    return c.b.a.x + b.y + z + b.a.x;
}` );
        expect( evalInt1( uplc, 3n ) ).toBe( 116n );
    });

    test("control: a recursive runtime struct in a field was read before, and still is", async () => {
        const uplc = await compileFn( `
runtime struct Cache { Nil {} Entry { key: bytes, rest: Cache } }
runtime struct Work { ok: boolean, leaves: int, cache: Cache }
function sizeOf( c: Cache ): int {
    return case c
        is Nil{} => 0
        is Entry{ rest } => 1 + sizeOf( rest )
        ;
}
export function main( n: int ): int {
    const w = Work{ ok: true, leaves: n, cache: Cache.Entry{ key: #61, rest: Cache.Nil{} } };
    return w.leaves + sizeOf( w.cache );
}` );
        expect( evalInt1( uplc, 3n ) ).toBe( 4n );
    });
});

// BUG 85 — a parameter is `const` unless it says `let`. The parser gave the
// parameter of `x => ...`, the one form that cannot say it, no flag at all,
// and what is not `const` counts as a mutable `let`: a lambda inside could
// not capture it ("Lambdas can only capture 'const' bindings; 't' is a
// mutable 'let'"), while the same code with `( x ) => ...` compiled.

describe("BUG 85: the parameter of `x => ...` is const, like any other parameter", () => {

    test("an inner lambda captures it", async () => {
        const uplc = await compileFn( `
export function main( n: int ): int {
    const rows: List<int> = [ 1, 2, 3 ];
    const cols: List<int> = [ 2, 3, 4 ];
    // rows that some column equals, shifted by n
    let hits = 0;
    for( const r of rows ) {
        if( cols.some( c => c == r ) ) hits = hits + 1;
    }
    const all = rows.every( r => cols.some( c => c == r + 1 ) );
    return ( all ? 10 : 0 ) + hits + n;
}` );
        expect( evalInt1( uplc, 5n ) ).toBe( 17n );
    });

    test("the parenthesized form gives the same result", async () => {
        const uplc = await compileFn( `
export function main( n: int ): int {
    const rows: List<int> = [ 1, 2, 3 ];
    const cols: List<int> = [ 2, 3, 4 ];
    const all = rows.every( ( r ) => cols.some( ( c ) => c == r + 1 ) );
    return ( all ? 10 : 0 ) + n;
}` );
        expect( evalInt1( uplc, 5n ) ).toBe( 15n );
    });

    test("it cannot be assigned, as no other const can", async () => {
        const diags = await diagnosticsOf( `
export function main( n: int ): int {
    const rows: List<int> = [ 1, 2, 3 ];
    return rows.length() + ( rows.some( r => { r = r + 1; return r == n; } ) ? 1 : 0 );
}` );
        expect( diags.filter( d => d.startsWith("ERROR") ).length ).toBeGreaterThan( 0 );
    });
});
