import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

// Regression tests for the GravityDex-port audit
// (`GravityDex-pebble/PEBBLE_BUGS.md`, found on 0.4.3, fixed in 0.4.4).
// Bug numbers below are THAT file's numbering.

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

jest.setTimeout( 120_000 );

// --------------------------------------------------------------------------
// BUGs 1 / 7 / 11 — flat-encoder integer corruption in (2^30, 2^52)
// (fixed in @harmoniclabs/uplc 2.0.7; these prove it through pebble)
// --------------------------------------------------------------------------
describe("GDex BUG 1/7/11 — integer constants in (2^30, 2^52)", () => {

    test("a window literal survives compilation (1e15)", async () => {
        const uplc = await compileFn(`
export function main( _unused: int ): int {
    return 1_000_000_000_000_000;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 1_000_000_000_000_000n );
    });

    test("BUG 7: a const-folded sum landing in the window is correct", async () => {
        const uplc = await compileFn(`
function idInt( x: int ): int { return x; }
export function main( n: int ): int {
    const viaSum: int = 1_000_000_000 + 100_000_000;
    const viaMul: int = idInt(11) * 100_000_000;
    return viaSum == viaMul ? 1 : 0;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 1n );
    });

    test("BUG 11: folded int LIST elements in the window are correct", async () => {
        const uplc = await compileFn(`
function idI( x: int ): int { return x; }
export function main( n: int ): int {
    const xs: List<int> = [1, 614676 * 1_000_000_000 + 815432348];
    return xs.tail().head() == idI(614676) * 1_000_000_000 + 815432348 ? 1 : 0;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 1n );
    });

    test("window boundaries: 2^31 as a const compares right", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const x: int = 2_147_483_648;
    return x == 2_147_483_647 + 1 ? 1 : 0;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 1n );
    });
});

// --------------------------------------------------------------------------
// BUG 8 — `export function` visible to non-exported same-module functions
// --------------------------------------------------------------------------
describe("GDex BUG 8 — export visibility inside the module", () => {
    test("non-exported fn calls an exported one declared first", async () => {
        const uplc = await compileFn(`
export function ff( x: int ): int { return x + 1; }
function gg2( x: int ): int { return ff(x) * 2; }
export function main( n: int ): int { return gg2( n ); }`);
        expect( evalInt1( uplc, 5n ) ).toBe( 12n );
    });
    test("exported struct declared first, used by later non-exported fn", async () => {
        const ds = errorsOnly( await checkOnly(`
export struct SW { a: int }
function mk( x: int ): SW { return SW{ a: x }; }
export function main( n: int ): int { return mk( n ).a; }`) );
        expect( ds ).toEqual( [] );
    });
});

// --------------------------------------------------------------------------
// BUG 2 — `a < (identifier ...)` parses as a comparison
// --------------------------------------------------------------------------
describe("GDex BUG 2 — `<` vs generic-call ambiguity", () => {
    test("`n < (s + 1)` is a comparison", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const s: int = 2;
    return n < (s + 1) ? 1 : 0;
}`);
        expect( evalInt1( uplc, 2n ) ).toBe( 1n );
        expect( evalInt1( uplc, 3n ) ).toBe( 0n );
    });
    test("genuine generic call with parenthesized arg still parses", async () => {
        const uplc = await compileFn(`
function idT<T>( x: T ): T { return x; }
export function main( n: int ): int {
    return idT<int>( (n + 1) );
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 6n );
    });
});

// --------------------------------------------------------------------------
// BUG 3 / 6 + depth>=2 loop control (return / break / continue)
// --------------------------------------------------------------------------
describe("GDex BUG 3/6 — loop control flow at any nesting depth", () => {

    test("BUG 3: return inside a for body (depth 1)", async () => {
        const uplc = await compileFn(`
export function main( x: int ): int {
    let v: int = x;
    for (let i = 5; i > 0; i--) {
        if (v == 0) return 7;
        v = v - 1;
    }
    return v;
}`);
        expect( evalInt1( uplc, 9n ) ).toBe( 4n );
        expect( evalInt1( uplc, 3n ) ).toBe( 7n );
    });

    test("return at if-depth 2 inside for-of propagates (was silently dropped)", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const xs: List<int> = [1,2,3];
    for (const x of xs) { if (true) { if (x == 2) return 42; } }
    return 0;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 42n );
    });

    test("BUG 6: break at if-depth 2 exits the loop", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    let found: int = 0;
    const xs: List<int> = [1, 2, 3];
    for (const x of xs) { if (true) { if (true) { found = 1; break; } } }
    return found;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 1n );
    });

    test("break at if-depth 2 with condition + accumulator", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    let found: int = 0;
    const xs: List<int> = [1,2,3];
    for (const x of xs) { if (true) { if (x == 2) { found = x; break; } } }
    return found;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 2n );
    });

    test("continue at depth 1 advances the iterator (used to loop forever)", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    let acc: int = 0;
    const xs: List<int> = [1,2,3];
    for (const x of xs) { if (x == 2) { continue; } acc = acc + x; }
    return acc;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 4n );
    });

    test("continue at if-depth 2 with tail statements", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    let acc: int = 0;
    const xs: List<int> = [1,2,3];
    for (const x of xs) { if (true) { if (x == 2) { continue; } } acc = acc + x; }
    return acc;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 4n );
    });

    test("continue in a classic for still runs the update", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    let acc: int = 0;
    for (let i = 0; i < 5; i++) {
        if (i == 2) { continue; }
        acc = acc + i;
    }
    return acc;
}`);
        // 0+1+3+4
        expect( evalInt1( uplc, 0n ) ).toBe( 8n );
    });
});

// --------------------------------------------------------------------------
// BUG 4 / 10 — bare struct literals resolve without `using` or annotations
// --------------------------------------------------------------------------
describe("GDex BUG 4/10 — bare struct literals", () => {
    test("inside a loop body (BUG 10 repro)", async () => {
        const uplc = await compileFn(`
export struct SW { a: int }
export function main( n: int ): int {
    let acc: int = 0;
    const xs: List<int> = [1,2,3];
    for (const x of xs) {
        const s = SW { a: x };
        acc = acc + s.a;
    }
    return acc;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 6n );
    });
    test("unannotated at function top level (BUG 4 shape)", async () => {
        const uplc = await compileFn(`
data struct P2 { a: int, b: int }
export function main( n: int ): int {
    const s = P2 { a: 3, b: 9 };
    return s.a + s.b;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 12n );
    });
});

// --------------------------------------------------------------------------
// BUG 5 — unknown property on a loop-bound map entry errors like elsewhere
// --------------------------------------------------------------------------
describe("GDex BUG 5 — map-entry property checking in loops", () => {
    test("`e.fst` on a for-of map entry is a 2339 error", async () => {
        const ds = errorsOnly( await checkOnly(`
export function main( ctx: data ): int {
    const m = std.builtins.unMapData(ctx);
    let acc: int = 0;
    for (const e of m) { acc = acc + std.builtins.unIData(e.fst); }
    return acc;
}`) );
        expect( ds.length ).toBeGreaterThan( 0 );
        expect( ds.join("\n") ).toContain( "2339" );
    });
    test("`e.key` on a for-of map entry compiles", async () => {
        const ds = errorsOnly( await checkOnly(`
export function main( ctx: data ): int {
    const m = std.builtins.unMapData(ctx);
    let acc: int = 0;
    for (const e of m) { acc = acc + std.builtins.unIData(e.key); }
    return acc;
}`) );
        expect( ds ).toEqual( [] );
    });
});

// --------------------------------------------------------------------------
// BUG 9 — `std.builtins.mkNilData()` lowers without a spurious force
// --------------------------------------------------------------------------
describe("GDex BUG 9 — mkNilData", () => {
    test("bind + method call evaluates", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const l = std.builtins.mkNilData();
    return l.isEmpty() ? 1 : 0;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 1n );
    });
    test("direct-argument use evaluates", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const d: data = std.builtins.constrData(1, std.builtins.mkNilData());
    return std.builtins.unConstrData(d).index;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 1n );
    });
});

// --------------------------------------------------------------------------
// BUG 12 — const-bound struct literals do not poison the enclosing function
// --------------------------------------------------------------------------
describe("GDex BUG 12 — const-bound struct literals", () => {
    test("original repro: const-bound literal + test-block caller", async () => {
        const uplc = await compileFn(`
struct CtxE { a: int, b: int }
function mkE( x: int ): int {
    const c = CtxE { a: x, b: 2 };
    return c.a + c.b;
}
export function main( n: int ): int { return mkE( n ); }`);
        expect( evalInt1( uplc, 1n ) ).toBe( 3n );
    });
    test("const-bound literal in an EXPORTED function", async () => {
        const uplc = await compileFn(`
export struct CtxE { a: int, b: int }
export function mkE( x: int ): int {
    const c = CtxE { a: x, b: 2 };
    return c.a + c.b;
}
export function main( n: int ): int { return mkE( n ); }`);
        expect( evalInt1( uplc, 5n ) ).toBe( 7n );
    });
});
