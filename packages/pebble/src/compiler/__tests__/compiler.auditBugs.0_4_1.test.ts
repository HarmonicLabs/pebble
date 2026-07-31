import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm, showUPLC } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";
import { DataConstr, DataI } from "@harmoniclabs/plutus-data";

// Regression tests for the 0.4.1 type-system audit (BUGs 27-38), see
// packages/pebble/PEBBLE_BUGS.md. Each test asserts the CORRECT post-fix
// behaviour, so it verifies the bug now (fails) and guards the fix later.

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

/** run `check()` and return the diagnostic strings (preserved regardless of BUG 30) */
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

jest.setTimeout( 300_000 );

// --------------------------------------------------------------------------
// BUG 27 — SoP multi-constructor literals hardcode IRConstr(0)
// --------------------------------------------------------------------------
describe("BUG 27 — runtime-struct multi-ctor literal dispatches to the right arm", () => {

    test("T.B literal matches the B arm (SoP)", async () => {
        const uplc = await compileFn("main", `
runtime struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int {
    const v: T = T.B{ y: n };
    return case v is A{ x } => 111 is B{ y } => 222 ;
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 222n );
    });

    test("T.A literal still matches the A arm (SoP)", async () => {
        const uplc = await compileFn("main", `
runtime struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int {
    const v: T = T.A{ x: n };
    return case v is A{ x } => x is B{ y } => 999 ;
}`);
        expect( evalInt1( uplc, 42n ) ).toBe( 42n );
    });

    test("three-constructor runtime struct dispatches to the third", async () => {
        const uplc = await compileFn("main", `
runtime struct T { A{ x: int } B{ y: int } C{ z: int } }
export function main( n: int ): int {
    const v: T = T.C{ z: n };
    return case v is A{ x } => 1 is B{ y } => 2 is C{ z } => z ;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });
});

// --------------------------------------------------------------------------
// BUG 28 — non-exhaustive `case` expression must be rejected at compile time
// --------------------------------------------------------------------------
describe("BUG 28 — non-exhaustive case expression is a compile error", () => {

    test("case missing a constructor is rejected", async () => {
        const ds = errorsOnly( await checkOnly(`
data struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int {
    const v: T = T.B{ y: n };
    return case v is A{ x } => 111 ;
}`) );
        expect( ds.length ).toBeGreaterThan( 0 );
        expect( ds.join("\n").toLowerCase() ).toContain( "exhaustive" );
    });

    test("case covering all constructors is accepted", async () => {
        const ds = errorsOnly( await checkOnly(`
data struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int {
    const v: T = T.B{ y: n };
    return case v is A{ x } => 111 is B{ y } => 222 ;
}`) );
        expect( ds ).toEqual( [] );
    });

    test("case with a wildcard is accepted even when a ctor is missing", async () => {
        const ds = errorsOnly( await checkOnly(`
data struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int {
    const v: T = T.B{ y: n };
    return case v is A{ x } => 111 else 222 ;
}`) );
        expect( ds ).toEqual( [] );
    });
});

// --------------------------------------------------------------------------
// BUG 29 — case arms with mismatched types must be rejected
// --------------------------------------------------------------------------
describe("BUG 29 — case arms with incompatible types are rejected", () => {

    test("int arm and bytes arm without a hint is an error", async () => {
        const ds = errorsOnly( await checkOnly(`
data struct Sh { C{ r: int } S{ s: int } }
export function main( n: int ): int {
    const sh: Sh = Sh.C{ r: n };
    const x = case sh is C{ r } => r is S{ s } => #00 ;
    return n;
}`) );
        expect( ds.length ).toBeGreaterThan( 0 );
    });

    test("arms with the same type are accepted", async () => {
        const ds = errorsOnly( await checkOnly(`
data struct Sh { C{ r: int } S{ s: int } }
export function main( n: int ): int {
    const sh: Sh = Sh.C{ r: n };
    const x = case sh is C{ r } => r is S{ s } => s ;
    return x;
}`) );
        expect( ds ).toEqual( [] );
    });
});

// --------------------------------------------------------------------------
// BUG 34 — return-type inference must handle bodies with multiple returns
// --------------------------------------------------------------------------
describe("BUG 34 — return type inferred across nested returns", () => {

    test("if/else with a return in each branch infers int", async () => {
        const ds = errorsOnly( await checkOnly(`
function f( n: int ) { if( n > 0 ) { return 1; } else { return 2; } }
export function main( n: int ): int { return f( n ); }`) );
        expect( ds ).toEqual( [] );
    });

    test("inferred multi-return function evaluates correctly", async () => {
        const uplc = await compileFn("main", `
function f( n: int ) { if( n > 0 ) { return 1; } else { return 2; } }
export function main( n: int ): int { return f( n ); }`);
        expect( evalInt1( uplc, 5n ) ).toBe( 1n );
        expect( evalInt1( uplc, -5n ) ).toBe( 2n );
    });

    test("single top-level return still infers (no regression)", async () => {
        const ds = errorsOnly( await checkOnly(`
function g( n: int ) { return n + 1; }
export function main( n: int ): int { return g( n ); }`) );
        expect( ds ).toEqual( [] );
    });
});

// --------------------------------------------------------------------------
// BUG 30 — export() must surface diagnostics (throw on errors), not swallow
// --------------------------------------------------------------------------
describe("BUG 30 — export() surfaces error diagnostics", () => {
    async function exportOutcome( src: string ): Promise<"threw" | "ok"> {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([["test.pebble", fromUtf8(src)]]), useConsoleAsOutput: true });
        const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
        try { await c.export({ functionName: "main", entry: "test.pebble", root: "/" }); return "ok"; }
        catch { return "threw"; }
    }
    test("a program with a type error throws from export()", async () => {
        expect( await exportOutcome(`function bad( n: int ): int { return #00; }\nexport function main( n: int ): int { return n; }`) ).toBe("threw");
    });
    test("a valid program exports fine", async () => {
        expect( await exportOutcome(`export function main( n: int ): int { return n; }`) ).toBe("ok");
    });
});

// --------------------------------------------------------------------------
// BUG 31 — generic structs/aliases/interfaces yield diagnostics, not crashes
// --------------------------------------------------------------------------
describe("BUG 31 — generic type declarations produce located diagnostics", () => {
    for( const [label, src] of [
        ["generic struct", `struct Box<T> { value: T }\nfunction main(n:int):int{return n;}`],
        ["generic alias", `type Alias<T> = T;\nfunction main(n:int):int{return n;}`],
        ["generic interface", `interface Show<T> { show(self): int }\nfunction main(n:int):int{return n;}`],
    ] as [string,string][] ) {
        test(`${label} reports a diagnostic (no crash)`, async () => {
            let ds: string[] = [];
            await expect( (async () => { ds = errorsOnly( await checkOnly( src ) ); })() ).resolves.toBeUndefined();
            expect( ds.length ).toBeGreaterThan(0);
            expect( ds.join("\n").toLowerCase() ).toContain("not supported");
        });
    }
});

// --------------------------------------------------------------------------
// BUG 32 — generic containers in a generic signature compile & monomorphize
// --------------------------------------------------------------------------
describe("BUG 32 — generic container signatures no longer crash", () => {
    test("wrap<T>(): List<T>, first<T>(List<T>), opt<T>(): Optional<T> all compile", async () => {
        for( const src of [
            `function wrap<T>( x: T ): List<T> { return [ x ]; }\nfunction main(n:int):int{return n;}`,
            `function first<T>( xs: List<T> ): T { return xs.head(); }\nfunction main(n:int):int{return n;}`,
            `function opt<T>( x: T ): Optional<T> { return Some{ value: x }; }\nfunction main(n:int):int{return n;}`,
        ] ) {
            expect( errorsOnly( await checkOnly( src ) ) ).toEqual([]);
        }
    });
    test("wrap<int> monomorphizes and evaluates", async () => {
        const uplc = await compileFn("main", `function wrap<T>( x: T ): List<T> { return [ x ]; }\nexport function main( n: int ): int { return wrap<int>( n ).head() + 100; }`);
        expect( evalInt1( uplc, 5n ) ).toBe( 105n );
    });
});

// --------------------------------------------------------------------------
// BUG 33 — nested match patterns: clean diagnostic + else-colon + workaround
// --------------------------------------------------------------------------
describe("BUG 33 — nested patterns diagnostic, else-colon, workaround", () => {
    const P = `data struct Inner { A{ x: int } B{ y: int } }\ndata struct Wrap { W{ i: Inner } }\n`;
    test("nested match pattern gives ONE clear diagnostic (not 3 parse errors)", async () => {
        const ds = errorsOnly( await checkOnly( P+`function main( o: Wrap ): int { match (o) { when W{ i: A{ x } }: { return x; } else: { return 0; } } }`) );
        expect( ds.length ).toBe(1);
        expect( ds[0].toLowerCase() ).toContain("nested patterns");
    });
    test("`else:` colon is accepted on a flat match", async () => {
        expect( errorsOnly( await checkOnly(
            `data struct Inner { A{ x: int } B{ y: int } }\nfunction main( i: Inner ): int { match (i) { when A{ x }: { return x; } else: { return 0; } } }`) ) ).toEqual([]);
    });
    test("documented workaround (bind field, then case) compiles and runs", async () => {
        const src = P+`export function main( o: Wrap ): int { match (o) { when W{ i }: { return case i is A{ x } => x is B{ y } => y ; } } }`;
        expect( errorsOnly( await checkOnly( src ) ) ).toEqual([]);
    });
});

// --------------------------------------------------------------------------
// BUG 36 — interface method signature may end with `;`
// --------------------------------------------------------------------------
describe("BUG 36 — trailing semicolon on interface methods", () => {
    test("interface with `;` after the signature parses", async () => {
        expect( errorsOnly( await checkOnly(`interface I { show(self): bytes; }\nfunction main(n: int): int { return n; }`) ) ).toEqual([]);
    });
});

// --------------------------------------------------------------------------
// BUG 37 — qualified namespace path does not leak file-level types
// --------------------------------------------------------------------------
describe("BUG 37 — qualified namespace path is non-walking", () => {
    test("M.Outside (Outside defined at file level, not in M) is rejected", async () => {
        const ds = errorsOnly( await checkOnly(`data struct Outside { O{ a: int } }\nnamespace M { function f( a: int ): int { return a; } }\nexport function main( o: M.Outside ): int { return 0; }`) );
        expect( ds.length ).toBeGreaterThan(0);
        expect( ds.join("\n") ).toContain("has no exported member");
    });
    test("M.Inside (defined inside M) still resolves", async () => {
        expect( errorsOnly( await checkOnly(`namespace M { data struct Inside { I{ b: int } } }\nexport function main( o: M.Inside ): int { return 0; }`) ) ).toEqual([]);
    });
});

// --------------------------------------------------------------------------
// BUG 38 — namespace `export` member + clear re-export diagnostic
// --------------------------------------------------------------------------
describe("BUG 38 — namespace export member + re-export diagnostic", () => {
    test("`export struct` inside a namespace is accepted", async () => {
        expect( errorsOnly( await checkOnly(`namespace M { export struct Inside { I{ b: int } } }\nexport function main( x: M.Inside ): int { return 0; }`) ) ).toEqual([]);
    });
    test("`export * from` yields a clear 'not supported' diagnostic", async () => {
        const ds = errorsOnly( await checkOnly(`export * from "./lib.pebble";\nfunction main(n:int):int{return n;}`) );
        expect( ds.length ).toBeGreaterThan(0);
        expect( ds.join("\n").toLowerCase() ).toContain("re-export");
    });
});

// --------------------------------------------------------------------------
// BUG 35 — a method call on a type-param value PARSES and type-checks
// (the report's "does not parse" no longer reproduces). Constraint-based
// DISPATCH at monomorphization is a separate deferred feature and is NOT
// asserted here.
// --------------------------------------------------------------------------
describe("BUG 35 — type-param method call parses and checks", () => {
    test("`function conv<T implements ToData>( x: T ): data { return x.toData(); }` checks clean", async () => {
        expect( errorsOnly( await checkOnly(
            `function conv<T implements ToData>( x: T ): data { return x.toData(); }\nfunction main( n: int ): int { return n; }`) ) ).toEqual([]);
    });
});

// --------------------------------------------------------------------------
// Show integration wired for real (collateral unmasked by the BUG 30 fix):
// `.show()` on structs / Value, and `trace` of any Show-able value.
// --------------------------------------------------------------------------
describe("Show integration (unmasked + wired by the BUG 30 fix)", () => {
    test("data-struct .show() compiles and serialises", async () => {
        const uplc = await compileFn("main", `data struct Point { x: int, y: int }\nexport function main( p: Point ): bytes { return p.show(); }`);
        // Point{ x:1, y:2 } = Constr 0 [1,2] -> CBOR d8799f0102ff -> hex bytes
        const r = Machine.eval( new Application( uplc, UPLCConst.data( new DataConstr(0,[new DataI(1),new DataI(2)]) ) ) ).result;
        expect( Buffer.from((r as any).value as Uint8Array).toString() ).toBe("d8799f0102ff");
    });
    test("Value .show() compiles clean", async () => {
        expect( errorsOnly( await checkOnly(`function main( v: Value ): bytes { return v.show(); }`) ) ).toEqual([]);
    });
    for( const [label, ty] of [["boolean","boolean"],["List<int>","List<int>"],["data","data"],["data-struct","P"]] as [string,string][] ) {
        test(`trace of ${label} compiles`, async () => {
            const pre = ty === "P" ? `data struct P { x: int }\n` : ``;
            expect( errorsOnly( await checkOnly(`${pre}function main( a: ${ty}, n: int ): int { trace a; return n; }`) ) ).toEqual([]);
        });
    }
});

// --------------------------------------------------------------------------
// BUG 39 — `List.map` with a lambda whose result type is the callback's
// output type param (`(A) => B`). It used to fail with "Type '(int) => T' is
// not assignable to type '(int) => T'" because the lambda adopted the
// unresolved `B` as its own return type (non-concrete → not assignable to
// itself) and the call never inferred `B` from the argument.
// --------------------------------------------------------------------------
describe("BUG 39 — List.map with a lambda type-checks and runs", () => {

    test("map with a bare lambda checks clean", async () => {
        expect( errorsOnly( await checkOnly(
            `export function main( n: int ): int { const l: List<int> = [ n ]; const r: List<int> = l.map( x => x + 1 ); return r.head(); }`) ) ).toEqual([]);
    });

    test("map can change the element type (int -> bytes)", async () => {
        expect( errorsOnly( await checkOnly(
            `export function main( n: int ): int { const l: List<int> = [ n ]; const r: List<bytes> = l.map( x => #00 ); return n; }`) ) ).toEqual([]);
    });

    test("filter still checks clean (no regression)", async () => {
        expect( errorsOnly( await checkOnly(
            `export function main( n: int ): int { const l: List<int> = [ n ]; const r: List<int> = l.filter( x => x > 0 ); return r.head(); }`) ) ).toEqual([]);
    });

    test("map evaluates, including a type-changing map (int -> bool)", async () => {
        const uplc = await compileFn("main", `export function main( n: int ): int { const l: List<int> = [ n, n + 1 ]; return l.map( x => x + 10 ).head(); }`);
        expect( evalInt1( uplc, 4n ) ).toBe( 14n );
        const uplcB = await compileFn("main", `export function main( n: int ): bool { const l: List<int> = [ n ]; return l.map( x => x > 0 ).head(); }`);
        expect( (Machine.eval( new Application( uplcB, UPLCConst.int(4n) ) ).result as any).value ).toBe( true );
    });
});

// --------------------------------------------------------------------------
// BUG 40 — higher-order function declarations. A function type can now be
// written in a parameter annotation with TypeScript syntax `(a: T) => R`,
// and lambdas passed to user HOFs get the SAME optimizations/correctness as
// those passed to `map`/`filter` (the `const`-capture rule and compute-once).
// --------------------------------------------------------------------------
describe("BUG 40 — higher-order function declarations", () => {

    test("`f: (a: int) => int` parameter parses, checks, and the call works", async () => {
        expect( errorsOnly( await checkOnly(
            `function ap( f: (a: int) => int, x: int ): int { return f( x ); }\nexport function main( n: int ): int { return ap( y => y + 1, n ); }`) ) ).toEqual([]);
    });

    test("higher-order function evaluates (applied twice)", async () => {
        const uplc = await compileFn("main",
            `function twice( f: (a: int) => int, x: int ): int { return f( f( x ) ); }\nexport function main( n: int ): int { return twice( y => y + 3, n ); }`);
        expect( evalInt1( uplc, 1n ) ).toBe( 7n );
    });

    test("a function type with the wrong shape is rejected", async () => {
        // passing an (int)=>bytes lambda where (int)=>int is expected
        const ds = errorsOnly( await checkOnly(
            `function ap( f: (a: int) => int, x: int ): int { return f( x ); }\nexport function main( n: int ): int { return ap( y => #00, n ); }`) );
        expect( ds.length ).toBeGreaterThan( 0 );
    });

    test("the `const`-only capture rule (30207) applies to lambdas passed to user HOFs", async () => {
        const ds = errorsOnly( await checkOnly(
            `function ap( f: (a: int) => int, x: int ): int { return f( x ); }\nexport function main( n: int ): int { let k = 5; return ap( y => y + k, n ); }`) );
        expect( ds.some( d => d.includes("30207") ) ).toBe( true );
        // the same with a const is clean
        expect( errorsOnly( await checkOnly(
            `function ap( f: (a: int) => int, x: int ): int { return f( x ); }\nexport function main( n: int ): int { const k = 5; return ap( y => y + k, n ); }`) ) ).toEqual([]);
    });

    test("compute-once: an expensive captured const in a HOF lambda is evaluated once", async () => {
        const uplc = await compileFn("main",
            `function ap( f: (a: int) => int, x: int ): int { return f( x ); }\nexport function main( n: int ): int { const h = std.builtins.lengthOfByteString( std.crypto.sha2_256( #cafe ) ); return ap( y => y + h, n ); }`);
        expect( showUPLC( uplc ).split("sha2_256").length - 1 ).toBe( 1 );
    });
});
