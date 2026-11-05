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
    ])( "does not warn about %s", async ( _, body ) => {
        expect( await warnings( body ) ).toEqual( [] );
    });

    test("the warning names the value and its line", async () => {
        const { diagnostics } = await exportF( prelude + `export function f( x: int ): int {\n    const ok = check( x );\n    return 1;\n}` );
        const text = diagnostics.find( d => d.code === 6133 )?.text ?? "";
        expect( text ).toContain( "'ok' is never used, so it is never computed" );
        // the prelude takes lines 1 to 8
        expect( text ).toContain( "main.pebble:10:5" );
    });
});
