import { testOptions, COMPILER_VERSION, CompilerOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { Application, Force, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, CEKError, evaluateWithSourceMap, Machine, UPLCSourceMap } from "@harmoniclabs/plutus-machine";

/**
 * `removeTraces`: the program is compiled as if its traces (`trace`, the messages of `assert`
 * and `fail`) were not there, and its source map keeps them, so evaluating it with the map logs
 * what the program compiled with them would have.
 */

jest.setTimeout( 120_000 );

async function exported( src: string, cfg: Partial<CompilerOptions>, functionName = "f" ): Promise<{ bytes: Uint8Array, map: UPLCSourceMap, body: UPLCTerm }>
{
    const compiler = new Compiler(
        createMemoryCompilerIoApi({ sources: new Map([[ "main.pebble", fromUtf8( src ) ]]) }),
        { ...testOptions, ...cfg, compilerVersion: COMPILER_VERSION } as CompilerOptions
    );
    const { bytes, sourceMap } = await compiler.exportWithSourceMap({ entry: "main.pebble", root: "/", functionName } as any );
    return { bytes, map: sourceMap, body: parseUPLC( bytes ).body };
}

// a function without parameters compiles to a `delay`
const applied = ( body: UPLCTerm, args: number[] ) => args.length === 0
    ? new Force( body )
    : args.reduce<UPLCTerm>( ( t, a ) => new Application( t, UPLCConst.int( a ) ), body );
const resultOf = ( r: any ) => r instanceof CEKError ? "error" : String( ( r as CEKConst ).value );

/** each source declares `f`; the inputs it is called with */
const PROGRAMS: [ string, string, number[][] ][] = [
    [ "a trace, an assert, a fail", `
export function f( x: int ): int {
    trace x * 2;
    assert x > 0 else "x must be positive";
    if( x == 7 ) fail "seven";
    return x + 1;
}`, [ [ 5 ], [ -1 ], [ 7 ] ] ],
    [ "traces in a loop, and of the loop's result", `
export function f( n: int ): int {
    let acc = 0;
    for( let i = 0; i < n; i++ ) {
        trace "step";
        trace i;
        acc = acc + i;
    }
    trace acc;
    return acc;
}`, [ [ 0 ], [ 3 ] ] ],
    [ "a helper with traces, called twice", `
function clamp( x: int, lo: int, hi: int ): int {
    trace "clamp";
    trace x;
    if( x < lo ) { trace "low"; return lo; }
    if( x > hi ) { trace "high"; return hi; }
    return x;
}
export function f( a: int, b: int ): int {
    const p = clamp( a, 0, 10 );
    const q = clamp( b, 5, 8 );
    return p * q;
}`, [ [ -3, 6 ], [ 20, 1 ] ] ],
    [ "merged asserts", `
export function f( x: int ): int {
    assert x > 10 else "not > 10";
    assert x > 20 else "not > 20";
    return x;
}`, [ [ 5 ], [ 15 ], [ 25 ] ] ],
    [ "a match with failing arms", `
data struct T { A{ a: int } B{ b: int } C{ c: int } }
export function f( n: int ): int {
    const t: T = n == 0 ? T.A{ a: 1 } : n == 1 ? T.B{ b: 2 } : T.C{ c: 3 };
    match t {
        when A{ a } : { return a; }
        when B{ b } : { fail "was B"; }
        when C{ c } : { fail "was C"; }
    }
}`, [ [ 0 ], [ 1 ], [ 2 ] ] ],
    [ "a trace of a value only the trace needs", `
export function f( x: int ): int {
    const y = x * 3;
    trace y;
    return x;
}`, [ [ 4 ] ] ],
    [ "a decoded field", `
struct Two { A { a: int } B { b: int } }
export function f( x: int ): int {
    const t: Two = Two.B{ b: x };
    const d = t as data;
    const B{ b: decoded } = d as Two.B;
    trace decoded;
    return 1;
}`, [ [ 42 ] ] ],
    // the message program reads a field of a constant through letted values; compiled on its
    // own, `removeUnusedVarsAndReturnRoot` dropped an argument of an over-applied binding and the
    // message evaluated to a lambda ("cannot force Lambda")
    [ "a decoded field of a constant, in a function without parameters", `
struct Two { A { a: int } B { b: int } }
export function f(): int {
    const t: Two = Two.B{ b: 42 };
    const d = t as data;
    const B{ b: decoded } = d as Two.B;
    trace decoded;
    return 1;
}`, [ [] ] ],
];

describe("removeTraces", () => {

    test.each( PROGRAMS )( "%s: smaller, and the map's traces log what the traced program logs", async ( _name, src, inputs ) => {
        const traced = await exported( src, { removeTraces: false } );
        const stripped = await exported( src, { removeTraces: true } );
        expect( stripped.bytes.length ).toBeLessThan( traced.bytes.length );
        expect( traced.map.traces ).toBeUndefined();
        expect( stripped.map.traces!.length ).toBeGreaterThan( 0 );

        for( const args of inputs )
        {
            const t = Machine.eval( applied( traced.body, args ) );
            const s = evaluateWithSourceMap({ term: applied( stripped.body, args ), map: stripped.map, program: stripped.body });
            expect( resultOf( s.result ) ).toBe( resultOf( t.result ) );
            expect( s.logs ).toEqual( t.logs );
        }
    });

    test("the stripped program is the one compiled from the source without its traces", async () => {
        const src = PROGRAMS[0][1];
        const without = src
            .replace( /\s*trace [^;]*;/g, "" )
            .replace( / else "[^"]*"/g, "" )
            .replace( /fail "[^"]*"/g, "fail" );
        const stripped = await exported( src, { removeTraces: true } );
        const plain = await exported( without, { removeTraces: false } );
        expect( toHex( stripped.bytes ) ).toBe( toHex( plain.bytes ) );
    });

    test("the map keeps each trace: its kind, statement, and message or expression", async () => {
        const { map } = await exported( PROGRAMS[0][1], { removeTraces: true } );
        const traces = map.traces!.map( t => ({ kind: t.kind, line: t.at?.[1], message: t.message, expression: t.expression, computed: t.program !== undefined }) );
        expect( traces ).toEqual( expect.arrayContaining([
            { kind: "trace", line: 3, message: undefined, expression: "x * 2", computed: true },
            { kind: "assert", line: 4, message: "x must be positive", expression: undefined, computed: false },
            { kind: "fail", line: 5, message: "seven", expression: undefined, computed: false },
        ]));
    });

    test("a trace whose code the optimizer removed is in the map without a place", async () => {
        // `double` becomes a partial application of `multiplyInteger`: no call is left to trace
        const { map } = await exported( `
function double( x: int ): int { trace "double"; return x * 2; }
export function f( x: int ): int { return double( x ) + double( x + 1 ); }`, { removeTraces: true } );
        expect( map.traces ).toEqual([ expect.objectContaining({ kind: "trace", message: "double" }) ]);
        expect( map.tracePoints ).toEqual([]);
    });
});

describe("fail with a message", () => {
    test("prints the message, then fails (the failure used to come first)", async () => {
        const { body } = await exported( `export function f( x: int ): int { if( x < 0 ) { fail "negative"; } return x; }`, { removeTraces: false } );
        const r = Machine.eval( applied( body, [ -1 ] ) );
        expect( r.result ).toBeInstanceOf( CEKError );
        expect( r.logs ).toEqual([ "negative" ]);
    });
});

describe("pebble test, debugger and compile output with removeTraces", () => {
    const SRC = `
function check( x: int ): int {
    trace "checking";
    assert x > 0 else "x must be positive";
    return x;
}
test fails() { assert check( -1 ) == -1; }
test passes() { assert check( 1 ) == 1; }`;

    test("tests run the stripped program, and their logs have the traces", async () => {
        const compiler = new Compiler(
            createMemoryCompilerIoApi({ sources: new Map([[ "main.pebble", fromUtf8( SRC ) ]]) }),
            { ...testOptions, removeTraces: true, compilerVersion: COMPILER_VERSION } as CompilerOptions
        );
        const results = await compiler.test({ entry: "main.pebble", root: "/" } as any );
        const byName = Object.fromEntries( results.map( r => [ r.name, r ] ) );
        expect( byName.fails.passed ).toBe( false );
        expect( byName.fails.iterations[0].logs ).toEqual([ "checking", "x must be positive" ]);
        expect( byName.fails.iterations[0].error?.location ).toMatchObject({ line: 4, column: 5 });
        expect( byName.passes.passed ).toBe( true );
        expect( byName.passes.iterations[0].logs ).toEqual([ "checking" ]);
    });

    test("the debugger's recording has them too", async () => {
        const compiler = new Compiler(
            createMemoryCompilerIoApi({ sources: new Map([[ "main.pebble", fromUtf8( SRC ) ]]) }),
            { ...testOptions, removeTraces: true, compilerVersion: COMPILER_VERSION } as CompilerOptions
        );
        const { run } = await compiler.debugTest({ entry: "main.pebble", root: "/", name: "fails" } as any );
        expect( run?.recording.logs ).toEqual([ "checking", "x must be positive" ]);
    });

    test("compile says how many traces it removed", async () => {
        const io = createMemoryCompilerIoApi({ sources: new Map([[ "main.pebble", fromUtf8( `export function f( x: int ): int { trace x; return x; }` ) ]]) });
        const lines: string[] = [];
        const compiler = new Compiler( io, { ...testOptions, silent: false, removeTraces: true, compilerVersion: COMPILER_VERSION } as CompilerOptions );
        compiler.io.stdout = { write: ( s: any ) => { lines.push( String( s ) ); } };
        await compiler.export({ entry: "main.pebble", root: "/", functionName: "f" } as any );
        expect( lines.join( "" ) ).toContain( "1 traces removed (removeTraces); the source map keeps them" );
    });
});
