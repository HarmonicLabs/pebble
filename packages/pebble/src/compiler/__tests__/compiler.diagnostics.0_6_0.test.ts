import { readFileSync } from "fs";
import { join } from "path";
import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { DiagnosticCategory } from "../../diagnostics/DiagnosticCategory";

/** exports `f`; `ok` is whether the compiler wrote a script */
async function exportF( src: string )
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    try {
        await compiler.export({ entry: "main.pebble", root: "/", functionName: "f" });
    } catch {}
    const ok = ioApi.outputs.get( "out/out.flat" ) instanceof Uint8Array;
    const diagnostics = compiler.diagnostics.map( d => ({ code: d.code, category: d.category, text: d.toString() }) );
    return { ok, diagnostics };
}

const errors = ( ds: { category: DiagnosticCategory }[] ) => ds.filter( d => d.category === DiagnosticCategory.Error );

describe("parser messages (0.6.0)", () => {

    test("a type on a for...of variable: one error, at the type", async () => {
        const { ok, diagnostics } = await exportF(
            `export function f(): int { let t = 0; for( const x: int of [ 1, 2, 3 ] ) { t += x; } return t; }`
        );
        expect( ok ).toBe( false );
        expect( errors( diagnostics ).map( d => d.code ) ).toEqual([ 2483 ]);
        expect( diagnostics[0].text ).toContain( "main.pebble:1:53" );
    });

    test("a block left open at the end of the file: '}' expected", async () => {
        const { ok, diagnostics } = await exportF( `export function f( a: int ): int {\n    return a;\n` );
        expect( ok ).toBe( false );
        expect( errors( diagnostics ).map( d => d.code ) ).toEqual([ 1005 ]);
        expect( diagnostics[0].text ).toContain( "'}' expected." );
    });

    test("a call as a statement: one error that says why, no 'Statement expected' after it", async () => {
        const { ok, diagnostics } = await exportF(
            `function g( x: int ): int { return x; }\nexport function f( a: int ): int { g( a ); return a; }`
        );
        expect( ok ).toBe( false );
        expect( errors( diagnostics ).map( d => d.code ) ).toEqual([ 1395 ]);
        expect( diagnostics[0].text ).toContain( "main.pebble:2:36" );
    });

    test.each([
        [ "a method call", `export function f( xs: List<int> ): int { xs.length(); return 1; }`, 1395 ],
        [ "an element of a call", `function g( x: int ): List<int> { return [ x ]; }\nexport function f( a: int ): int { g( a )[0]; return a; }`, 1395 ],
        [ "a field assignment", `struct P { x: int }\nexport function f( a: int ): int { let p = P{ x: 1 }; p.x = 5; return p.x; }`, 2364 ],
        [ "a field compound assignment", `struct P { x: int }\nexport function f( a: int ): int { let p = P{ x: 1 }; p.x += 2; return p.x; }`, 2364 ],
        [ "a field increment", `struct P { x: int }\nexport function f( a: int ): int { let p = P{ x: 1 }; p.x++; return p.x; }`, 2364 ],
        [ "an element assignment", `export function f( a: int ): int { let xs = [ 1, 2 ]; xs[0] = 5; return a; }`, 2364 ],
        // these threw a JavaScript error out of the parser
        [ "an increment in a return", `export function f( a: int ): int { let x = 1; return x++; }`, 2810 ],
        [ "a decrement in an initializer", `export function f( a: int ): int { let x = 1; const y = x--; return y; }`, 2810 ],
    ])( "%s as a statement: one error", async ( _, src, code ) => {
        const { ok, diagnostics } = await exportF( src );
        expect( ok ).toBe( false );
        expect( errors( diagnostics ).map( d => d.code ) ).toEqual([ code ]);
    });

    test.each([
        [ "annotated", `const A: int = #ff;\nfunction g(): int { return A; }\nexport function f(): int { return A + g(); }`, [ 2322 ] ],
        [ "not annotated", `const A = nope + 1;\nfunction g(): int { return A; }\nexport function f(): int { return A + g(); }`, [ 256 ] ],
    ])( "a top-level const whose value has an error (%s): that error only, not one per use", async ( _, src, codes ) => {
        // each use reported "'A' is not defined"
        const { ok, diagnostics } = await exportF( src );
        expect( ok ).toBe( false );
        expect( errors( diagnostics ).map( d => d.code ) ).toEqual( codes );
        expect( diagnostics.map( d => d.text ).join( "\n" ) ).not.toContain( "'A' is not defined" );
    });

    test.each([
        [ "a body with a type error", `function g(): int { return #00; }\nexport function f(): int { return g() + 1; }`, [ 2322 ] ],
        [ "a body with an undefined name", `function g( x: int ): int { return nope + x; }\nexport function f(): int { return g( 1 ) + g( 2 ); }`, [ 256 ] ],
        [ "a parameter of an undefined type", `function g( x: Nope ): int { return 1; }\nexport function f(): int { return g( 1 ); }`, [ 256 ] ],
    ])( "a function with %s: that error only, its callers do not report it undefined", async ( _, src, codes ) => {
        // each call reported "'g' is not defined"
        const { ok, diagnostics } = await exportF( src );
        expect( ok ).toBe( false );
        expect( errors( diagnostics ).map( d => d.code ) ).toEqual( codes );
        expect( diagnostics.map( d => d.text ).join( "\n" ) ).not.toContain( "'g' is not defined" );
    });

    test("a use of a name that was never declared is still reported", async () => {
        const { diagnostics } = await exportF( `export function f(): int { return B + 1; }` );
        expect( errors( diagnostics ).map( d => d.text ) ).toEqual([ expect.stringContaining( "'B' is not defined" ) ]);
    });

    test("every diagnostic code is used by one message only", () => {
        const messages: Record<string, number> = JSON.parse(
            readFileSync( join( __dirname, "../../diagnostics/diagnosticMessages.json" ), "utf8" )
        );
        const byCode = new Map<number, string[]>();
        for( const [ message, code ] of Object.entries( messages ) )
        {
            byCode.set( code, [ ...( byCode.get( code ) ?? [] ), message ] );
        }
        const duplicates = [ ...byCode ].filter( ([ , ms ]) => ms.length > 1 );
        expect( duplicates ).toEqual( [] );
    });
});

describe("warning 6133: an unused value that could fail is never computed", () => {

    const prelude = `
function check( x: int ): int { assert x > 0 else "x must be positive"; return x; }
function viaCheck( x: int ): int { return check( x ) + 1; }
function pure( x: int ): int { return x + 1; }
type Amount = int;
type Amount implements {
    validated( self ): int { assert self > 0; return self; }
}
`;
    const warnings = async ( body: string ) => {
        const { ok, diagnostics } = await exportF( prelude + body );
        expect( errors( diagnostics ) ).toEqual( [] );
        // a warning does not stop the compilation
        expect( ok ).toBe( true );
        return diagnostics.filter( d => d.category === DiagnosticCategory.Warning ).map( d => d.code );
    };

    test.each([
        [ "a call to a function that asserts", `export function f( x: int ): int { const ok = check( x ); return 1; }` ],
        [ "a call to a function that calls one", `export function f( x: int ): int { const ok = viaCheck( x ); return 1; }` ],
        [ "a division", `export function f( x: int ): int { const q = 1 / x; return 1; }` ],
        [ "a method that asserts", `export function f( a: Amount ): int { const v = a.validated(); return 1; }` ],
    ])( "warns about %s", async ( _, body ) => {
        expect( await warnings( body ) ).toEqual([ 6133 ]);
    });

    test.each([
        [ "a call to a function that cannot fail", `export function f( x: int ): int { const y = pure( x ); return 1; }` ],
        [ "a used value", `export function f( x: int ): int { const y = check( x ); return y; }` ],
        [ "a value used in an assignment in a loop", `export function f( xs: List<int> ): int { let acc = 0; const k = check( 2 ); for( const e of xs ) { acc = acc + e * k; } return acc; }` ],
        [ "a value used in a closure", `export function f( xs: List<int> ): boolean { const k = check( 2 ); return xs.some( e => e == k ); }` ],
        [ "an unused function value", `export function f( x: int ): int { const g = ( y: int ): int => check( y ); return 1; }` ],
        [ "an unused division by a constant (it cannot fail)", `export function f( x: int ): int { const q = x / 128; return 1; }` ],
    ])( "does not warn about %s", async ( _, body ) => {
        expect( await warnings( body ) ).toEqual( [] );
    });

    // computed only on the ways that read it: on the others the assert in `check` does not run
    test.each([
        [ "read in one branch", `export function f( x: int ): int { const ok = check( x ); if( x > 5 ) { return ok; } return 1; }` ],
        [ "read on the right of &&", `export function f( x: int ): int { const ok = check( x ); if( x > 5 && ok > 0 ) { return 1; } return 0; }` ],
        [ "read in a branch of ?:", `export function f( x: int ): int { const ok = check( x ); return x > 5 ? ok : 0; }` ],
        [ "passed to a function that ignores its parameter", `function ignore( a: int ): int { return 1; }\nexport function f( x: int ): int { const ok = check( x ); return ignore( ok ); }` ],
        [ "read twice, in one branch only", `export function f( x: int ): int { const ok = check( x ); if( x > 5 ) { return ok + ok; } return 0; }` ],
    ])( "warns (6134) about a value %s", async ( _, body ) => {
        expect( await warnings( body ) ).toEqual([ 6134 ]);
    });

    test.each([
        [ "read on every way", `export function f( x: int ): int { const ok = check( x ); if( x > 5 ) { return ok; } return ok + 1; }` ],
        [ "read by a condition", `export function f( x: int ): int { const ok = check( x ); if( ok > 5 ) { return 1; } return 0; }` ],
        [ "read on the way that does not fail", `export function f( x: int ): int { const ok = check( x ); if( x > 5 ) { return ok; } fail; }` ],
        [ "read through a const on every way", `export function f( x: int ): int { const ok = check( x ); const y = ok + 1; if( x > 5 ) { return y; } return y * 2; }` ],
        // seen on the masterpiece contracts: each warned
        [ "read in both branches of ?:", `export function f( x: int ): int { const ok = check( x ); return x > 5 ? ok : ok + 1; }` ],
        [ "read by a closure a pattern's check computes", `export function f( x: int, xs: List<int> ): int { const ok = check( x ); const Some{ value: v } = xs.find( e => e == ok ); return v; }` ],
        [ "passed to a function that reads its parameter", `function use( a: int ): int { return a + 1; }\nexport function f( x: int ): int { const ok = check( x ); const y = use( ok ); if( x > 5 ) { return y; } return y + 1; }` ],
        [ "divided by a constant (it cannot fail)", `export function f( x: int ): int { const q = x / 128; if( x > 5 ) { return q; } return 0; }` ],
        // reads in two branches meet before them: the value is computed there, on every way
        [ "read in two `if`s", `export function f( x: int ): int { const ok = check( x ); if( x > 5 ) { return ok; } if( x > 2 ) { return ok + 1; } return 0; }` ],
        [ "read by two conjuncts of an &&", `export function f( x: int ): boolean { const ok = check( x ); return x > 5 && ok > 0 && ok < 100; }` ],
        [ "read in both arms of nested ?:", `export function f( x: int ): int { const ok = check( x ); return x > 5 ? ok : x > 2 ? ok + 1 : 0; }` ],
        [ "read in a nested branch and after the outer one", `export function f( x: int ): int { const ok = check( x ); if( x > 5 ) { if( x > 9 ) { return ok; } return 2; } return ok; }` ],
    ])( "does not warn (6134) about a value %s", async ( _, body ) => {
        expect( await warnings( body ) ).toEqual( [] );
    });

    test("the warning names the value and its line", async () => {
        const { diagnostics } = await exportF( prelude + `export function f( x: int ): int {\n    const ok = check( x );\n    return 1;\n}` );
        const text = diagnostics.find( d => d.code === 6133 )?.text ?? "";
        expect( text ).toContain( "'ok' is never used, so it is never computed" );
        // the failures it stands for: not only asserts
        expect( text ).toContain( "(an assert in a function it calls, a division by zero)" );
        // the prelude takes lines 1 to 8
        expect( text ).toContain( "main.pebble:10:5" );
    });
});
