import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { createMemoryCompilerIoApi } from "../../compiler/io/CompilerIoApi";
import { ReplResult, ReplSession } from "../ReplSession";

jest.setTimeout( 120_000 );

const LIB = `
export function factorial( n: int ): int {
    let acc = 1;
    for( let i = 2; i <= n; i++ ) { acc = acc * i; }
    return acc;
}
export function failsUnder( n: int, limit: int ): int {
    assert n >= limit else "too small";
    return n;
}
`;

function session( opts: ConstructorParameters<typeof ReplSession>[0] = {} ): ReplSession
{
    return new ReplSession({
        io: createMemoryCompilerIoApi({ sources: new Map([[ "src/lib.pebble", fromUtf8( LIB ) ]]) }),
        ...opts,
    });
}

/** evaluates the lines in order; the result of the last */
async function evalAll( s: ReplSession, ...lines: string[] ): Promise<ReplResult>
{
    let last: ReplResult | undefined = undefined;
    for( const line of lines )
    {
        last = await s.eval( line );
        // every line but the last must succeed
        if( line !== lines[ lines.length - 1 ] && !last.ok )
        throw new Error( `line failed: ${line}\n${JSON.stringify( last.diagnostics.map( d => d.message ) )} ${last.failure?.message ?? ""}` );
    }
    return last!;
}

const value = async ( s: ReplSession, ...lines: string[] ) => {
    const r = await evalAll( s, ...lines );
    if( !r.ok ) throw new Error( "failed: " + JSON.stringify({ diagnostics: r.diagnostics.map( d => d.message ), failure: r.failure?.message }) );
    return r.value?.text;
};

describe("ReplSession: values", () => {

    test("an expression shows its value, with its Pebble type", async () => {
        const s = session();
        const r = await s.eval( "1 + 2" );
        expect( r.ok ).toBe( true );
        expect( r.value?.text ).toBe( "3" );
        expect( r.value?.type ).toBe( "int" );
        expect( r.budget?.cpu ).toBeGreaterThan( 0n );
        expect( await value( s, "[ 1, 2, 3 ]" ) ).toBe( "[1, 2, 3]" );
        expect( await value( s, "#abcd" ) ).toBe( "#abcd" );
        expect( await value( s, "1 < 2" ) ).toBe( "true" );
    });

    test("a struct shows its fields", async () => {
        const s = session();
        expect( await value( s, "struct P { x: int, y: int }", "const p = P{ x: 1, y: 2 };", "p" ) ).toBe( "P{ x: 1, y: 2 }" );
        expect( await value( s, "p.x + p.y" ) ).toBe( "3" );
    });

    test("declarations show nothing, and run on their line", async () => {
        const s = session();
        const r = await s.eval( "const a = 40 + 2;" );
        expect( r.ok ).toBe( true );
        expect( r.value ).toBeUndefined();
        expect( r.declared ).toEqual([ "a" ]);
        expect( await value( s, "a" ) ).toBe( "42" );

        // the value is computed: an error shows on the declaration's line
        const bad = await s.eval( "const z = 1 / 0;" );
        expect( bad.ok ).toBe( false );
        expect( bad.failure?.message ).toMatch( /divide by zero/ );
    });

    test("several statements on a line", async () => {
        expect( await value( session(), "const a = 1; const b = a + 1; b * 2" ) ).toBe( "4" );
    });
});

describe("ReplSession: declarations (A3, A4)", () => {

    test("a function, struct or import as the first line", async () => {
        const s = session();
        const fn = await s.eval( "function double( x: int ): int { return x * 2; }" );
        expect( fn.ok ).toBe( true );
        expect( fn.budget ).toBeUndefined();
        expect( fn.declared ).toEqual([ "double" ]);
        expect( await value( s, "double( 21 )" ) ).toBe( "42" );

        const t = session();
        expect( ( await t.eval( "struct P { x: int }" ) ).ok ).toBe( true );
        expect( await value( t, "P{ x: 5 }.x" ) ).toBe( "5" );

        const u = session();
        expect( ( await u.eval( "import { factorial } from \"./src/lib.pebble\";" ) ).ok ).toBe( true );
        expect( await value( u, "factorial( 5 )" ) ).toBe( "120" );
    });

    test("a declaration after a reassignment", async () => {
        const s = session();
        expect( await value( s, "let x = 1;", "x = 5" ) ).toBe( "5" );
        expect( ( await s.eval( "function g(): int { return 1; }" ) ).ok ).toBe( true );
        expect( await value( s, "x + g()" ) ).toBe( "6" );
    });

    test("functions and contracts use the session's constants", async () => {
        const s = session();
        expect( await value( s, "const k = 2;", "function f( x: int ): int { return x * k; }", "f( 3 )" ) ).toBe( "6" );
        expect( ( await s.eval( "contract C { spend s() { assert k == 2; } }" ) ).ok ).toBe( true );
    });

    test("a function using a `let` gets an explanation", async () => {
        const s = session();
        await s.eval( "let m = 2;" );
        const r = await s.eval( "function h( x: int ): int { return x * m; }" );
        expect( r.ok ).toBe( false );
        expect( r.diagnostics[0].message ).toBe( "'m' is not defined" );
        expect( r.diagnostics[0].note ).toMatch( /`let`/ );
        expect( r.diagnostics[0].position ).toMatchObject({ in: "input", line: 1, column: 40 });
    });

    test("redeclaring a function replaces it; constants computed earlier use the new one", async () => {
        const s = session();
        expect( await value( s, "const c = 1;", "function useC(): int { return c; }", "const c = 5;", "useC()" ) ).toBe( "5" );
        expect( await value( s, "function useC(): int { return c * 10; }", "useC()" ) ).toBe( "50" );
    });

    test("redeclaring a `let` shadows the old one, another type too", async () => {
        const s = session();
        expect( await value( s, "let a = 1;", "a = 2", "let a = 10;", "a" ) ).toBe( "10" );
        expect( await value( s, "let a = #ff;", "a" ) ).toBe( "#ff" );
    });
});

describe("ReplSession: state", () => {

    test("a loop changing a `let` keeps its effect", async () => {
        const s = session();
        expect( await value( s, "let total = 0;", "for( const x of [ 1, 2, 3 ] ) { total += x; }", "total" ) ).toBe( "6" );
        expect( await value( s, "total * 2" ) ).toBe( "12" );
        expect( await value( s, "total += 1", "total" ) ).toBe( "7" );
    });

    test("a failed line changes nothing", async () => {
        const s = session();
        await s.eval( "let n = 1;" );
        expect( ( await s.eval( "n = n / 0" ) ).ok ).toBe( false );
        expect( await value( s, "n" ) ).toBe( "1" );
        const undefinedAfter = await s.eval( "zz" );
        expect( undefinedAfter.diagnostics[0].message ).toBe( "'zz' is not defined" );
    });

    test("reset forgets everything", async () => {
        const s = session();
        await s.eval( "const a = 1;" );
        expect( s.declarations ).toEqual([ { line: 1, text: "const a = 1;" } ]);
        s.reset();
        expect( s.declarations ).toEqual([]);
        expect( ( await s.eval( "a" ) ).ok ).toBe( false );
    });

    test("traces show", async () => {
        const s = session();
        const r = await s.eval( "trace 40 + 2;" );
        expect( r.ok ).toBe( true );
        expect( r.logs ).toEqual([ "42" ]);
        expect( r.value ).toBeUndefined();
    });
});

describe("ReplSession: errors and failures (A7)", () => {

    test("every diagnostic, at what was typed", async () => {
        const s = session();
        const r = await s.eval( "const z: int = #ff;" );
        expect( r.ok ).toBe( false );
        // not also "'z' is not defined" where the session reads it
        expect( r.diagnostics ).toHaveLength( 1 );
        expect( r.diagnostics[0] ).toMatchObject({
            category: "error",
            message: "Type 'bytes' is not assignable to type 'int'.",
            position: { in: "input", line: 1, column: 16, lineText: "const z: int = #ff;" },
        });
    });

    test("a diagnostic on the second line of an input", async () => {
        const r = await session().eval( "function f( x: int ): int {\n    return x + #ff;\n}" );
        expect( r.ok ).toBe( false );
        expect( r.diagnostics[0].position ).toMatchObject({ in: "input", line: 2 });
    });

    test("a diagnostic in an imported file names the file", async () => {
        const s = new ReplSession({
            io: createMemoryCompilerIoApi({ sources: new Map([[ "bad.pebble", fromUtf8( "export function bad(): int { return #00; }" ) ]]) }),
        });
        const r = await s.eval( "import { bad } from \"./bad.pebble\";" );
        expect( r.ok ).toBe( false );
        expect( r.diagnostics[0].position ).toMatchObject({ in: "file", path: "bad.pebble", line: 1 });
    });

    test("a failing assert, at its line", async () => {
        const r = await session().eval( "assert 1 == 2;" );
        expect( r.ok ).toBe( false );
        expect( r.failure?.message ).toBe( "explicit error from uplc" );
        expect( r.failure?.position ).toMatchObject({ in: "input", line: 1, column: 1 });
    });

    test("a failure in a function entered earlier, and its stack", async () => {
        const s = session();
        await s.eval( "function check( a: int ): int {\n    assert a > 10 else \"small\";\n    return a;\n}" );
        const r = await s.eval( "check( 5 )" );
        expect( r.ok ).toBe( false );
        expect( r.logs ).toEqual([ "small" ]);
        expect( r.failure?.position ).toMatchObject({ in: "session", sessionLine: 1, line: 2, column: 5 });
        expect( r.failure?.stack.map( f => f.name ) ).toEqual([ "check" ]);
    });

    test("a failure in an imported function names the file", async () => {
        const s = session();
        await s.eval( "import { failsUnder } from \"./src/lib.pebble\";" );
        const r = await s.eval( "failsUnder( 1, 5 )" );
        expect( r.ok ).toBe( false );
        expect( r.failure?.position ).toMatchObject({ in: "file", path: "src/lib.pebble", line: 8 });
    });

    test("an endless loop runs out of budget", async () => {
        const s = session({ budget: { cpu: 50_000_000n, mem: 200_000n } });
        await s.eval( "let i = 0;" );
        const r = await s.eval( "while( true ) { i = i + 1; }" );
        expect( r.ok ).toBe( false );
        expect( r.failure?.outOfBudget ).toBe( true );
        expect( await value( s, "i" ) ).toBe( "0" );
    });
});

describe("ReplSession: contracts and tests (A8)", () => {

    test("a contract is checked; its name in an expression is explained", async () => {
        const s = session();
        const r = await s.eval( "contract C { spend s() { } }" );
        expect( r.ok ).toBe( true );
        expect( r.contracts ).toEqual([ "C" ]);
        const used = await s.eval( "C" );
        expect( used.ok ).toBe( false );
        expect( used.diagnostics[0].note ).toMatch( /pebble test/ );
    });

    test("a test runs on its line", async () => {
        const s = session();
        await s.eval( "function double( x: int ): int { return x * 2; }" );
        const pass = await s.eval( "test doubles() { assert double( 2 ) == 4; }" );
        expect( pass.ok ).toBe( true );
        expect( pass.tests ).toMatchObject([{ name: "doubles", passed: true, kind: "unit" }]);

        const fail = await s.eval( "test wrong() { assert double( 2 ) == 5; }" );
        expect( fail.tests ).toMatchObject([{ name: "wrong", passed: false, position: { in: "input", line: 1 } }]);

        const property = await s.eval( "test even( n: int ) { assert double( n ) % 2 == 0; }" );
        expect( property.tests ).toMatchObject([{ name: "even", passed: true, kind: "property" }]);
        // tests are not kept
        expect( s.declarations.map( d => d.text ) ).toEqual([ "function double( x: int ): int { return x * 2; }" ]);
    });
});
