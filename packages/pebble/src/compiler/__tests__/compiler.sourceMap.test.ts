import { testOptions, COMPILER_VERSION, CompilerOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { TestResult } from "../test/TestResult";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { blake2b_256 } from "@harmoniclabs/crypto";
import { Application, parseUPLC, UPLCConst } from "@harmoniclabs/uplc";
import { indexProgram, locateFailure, parseSourceMap, SourceLocation } from "@harmoniclabs/plutus-machine";

/**
 * Sourcemaps: where a failing evaluation failed, in the source.
 *
 * Every test pins the exact `file:line:column` of the failure and of each open call
 * (innermost first): a wrong line is worse than no line, so these are golden values.
 */

const lines = ( ...ls: string[] ) => ls.join( "\n" );
const at = ( l: SourceLocation | undefined ) => l ? `${l.source}:${l.line}:${l.column}` : "-";

function makeCompiler( files: [ string, string ][], cfg: Partial<CompilerOptions> = {} )
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map( files.map( ([ name, src ]) => [ name, fromUtf8( src ) ] ) ),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler( ioApi, { ...testOptions, ...cfg, compilerVersion: COMPILER_VERSION } as CompilerOptions );
    return { compiler, ioApi };
}

/** `{ name: [ failure, ...frames ] }`, each as `file:line:column` (frames as `fn@file:line:column`) */
async function failures( files: [ string, string ][], cfg: Partial<CompilerOptions> = {} ): Promise<Record<string, string[]>>
{
    const { compiler } = makeCompiler( files, cfg );
    const results: TestResult[] = await compiler.test({ entry: files[0][0], root: "/" } as any );
    expect( compiler.diagnostics.map( String ) ).toEqual( [] );
    const out: Record<string, string[]> = {};
    for( const r of results )
    {
        const err = r.iterations[ r.iterations.length - 1 ]?.error;
        out[ r.name ] = r.passed ? [ "PASS" ] : [
            at( err?.location ),
            ...( err?.stack ?? [] ).map( f => `${f.functionName ?? "?"}@${at( f.location )}` )
        ];
    }
    return out;
}

// the fixture of the M3 plan (section 4.1): one `error` for three failure sites
const F1 = lines(
/*  1 */ "function check( a: int ): int {",
/*  2 */ "    assert a > 10 else \"a too small\";",
/*  3 */ "    assert a < 100;",
/*  4 */ "    return a;",
/*  5 */ "}",
/*  6 */ "function entry( a: int ): int {",
/*  7 */ "    const b = check( a );",
/*  8 */ "    if( b == 50 ) fail;",
/*  9 */ "    return b + 1;",
/* 10 */ "}",
/* 11 */ "test f1_small() { assert entry( 5 ) == 6; }",
/* 12 */ "test f1_big() { assert entry( 500 ) == 501; }",
/* 13 */ "test f1_fifty() { assert entry( 50 ) == 51; }",
/* 14 */ "test f1_ok() { assert entry( 20 ) == 21; }",
);

// fixture F2 of the sourcemaps plan: conditions call a helper the optimizer copies in;
// "the newest evaluated term" would point into `isBig` for two of these
const F2 = lines(
/*  1 */ "function isBig( a: int ): boolean {",
/*  2 */ "    const doubled = a * 2;",
/*  3 */ "    return doubled > 20;",
/*  4 */ "}",
/*  5 */ "function check( a: int ): int {",
/*  6 */ "    assert isBig( a );",
/*  7 */ "    assert a < 100;",
/*  8 */ "    return a;",
/*  9 */ "}",
/* 10 */ "function entry( a: int ): int {",
/* 11 */ "    const b = check( a );",
/* 12 */ "    if( isBig( b - 40 ) ) fail;",
/* 13 */ "    return b + 1;",
/* 14 */ "}",
/* 15 */ "test f2_small() { assert entry( 5 ) == 6; }",
/* 16 */ "test f2_big() { assert entry( 500 ) == 501; }",
/* 17 */ "test f2_95() { assert entry( 95 ) == 96; }",
);

const F1_EXPECTED = {
    f1_small: [ "main.pebble:2:5", "check@main.pebble:2:5", "entry@main.pebble:7:15", "test f1_small@main.pebble:11:26" ],
    f1_big:   [ "main.pebble:3:5", "check@main.pebble:3:5", "entry@main.pebble:7:15", "test f1_big@main.pebble:12:24" ],
    // the `fail` branch is pruned: the failing term is the `if`
    f1_fifty: [ "main.pebble:8:5", "entry@main.pebble:8:5", "test f1_fifty@main.pebble:13:26" ],
    f1_ok:    [ "PASS" ],
};

const F2_EXPECTED = {
    f2_small: [ "main.pebble:6:5", "check@main.pebble:6:5", "entry@main.pebble:11:15", "test f2_small@main.pebble:15:26" ],
    f2_big:   [ "main.pebble:7:5", "check@main.pebble:7:5", "entry@main.pebble:11:15", "test f2_big@main.pebble:16:24" ],
    f2_95:    [ "main.pebble:12:5", "entry@main.pebble:12:5", "test f2_95@main.pebble:17:23" ],
};

describe("sourcemaps: failure locations", () => {

    test("F1: two merged asserts and a pruned `fail`", async () => {
        expect( await failures([[ "main.pebble", F1 ]]) ).toEqual( F1_EXPECTED );
    });

    test("F2: conditions calling a helper the optimizer copied in", async () => {
        expect( await failures([[ "main.pebble", F2 ]]) ).toEqual( F2_EXPECTED );
    });

    test("fail with a message, builtin errors, loops, twin asserts", async () => {
        expect( await failures([[ "main.pebble", lines(
/*  1 */ "function failWithMsg( x: int ): int {",
/*  2 */ "    if( x > 3 ) {",
/*  3 */ "        fail \"too big\";",
/*  4 */ "    }",
/*  5 */ "    return x;",
/*  6 */ "}",
/*  7 */ "function divide( a: int, b: int ): int {",
/*  8 */ "    const q = a / b;",
/*  9 */ "    return q + 1;",
/* 10 */ "}",
/* 11 */ "function firstOf( xs: List<int> ): int {",
/* 12 */ "    const h = xs.head();",
/* 13 */ "    return h * 2;",
/* 14 */ "}",
/* 15 */ "function sumPositive( xs: List<int> ): int {",
/* 16 */ "    let total = 0;",
/* 17 */ "    for( const x of xs ) {",
/* 18 */ "        assert x > 0 else \"not positive\";",
/* 19 */ "        total = total + x;",
/* 20 */ "    }",
/* 21 */ "    return total;",
/* 22 */ "}",
/* 23 */ "function twinA( x: int ): int {",
/* 24 */ "    assert x != 7;",
/* 25 */ "    return x;",
/* 26 */ "}",
/* 27 */ "function twinB( x: int ): int {",
/* 28 */ "    assert x != 7;",
/* 29 */ "    return x;",
/* 30 */ "}",
/* 31 */ "test t_fail_msg() { assert failWithMsg( 5 ) == 5; }",
/* 32 */ "test t_div_zero() { assert divide( 4, 0 ) == 1; }",
/* 33 */ "test t_head_empty() { assert firstOf( [] ) == 0; }",
/* 34 */ "test t_loop() { assert sumPositive( [ 1, 2, -3, 4 ] ) == 4; }",
/* 35 */ "test t_twin_b() { assert twinA( 1 ) + twinB( 7 ) == 8; }",
/* 36 */ "test t_twin_a() { assert twinA( 7 ) + twinB( 1 ) == 8; }",
        )]]) ).toEqual({
            t_fail_msg:   [ "main.pebble:3:9", "failWithMsg@main.pebble:3:9", "test t_fail_msg@main.pebble:31:28" ],
            t_div_zero:   [ "main.pebble:8:15", "divide@main.pebble:8:15", "test t_div_zero@main.pebble:32:28" ],
            // the standard library's `head` fails: located at the user's call
            t_head_empty: [ "main.pebble:12:18", "firstOf@main.pebble:12:18", "test t_head_empty@main.pebble:33:30" ],
            t_loop:       [ "main.pebble:18:9", "sumPositive@main.pebble:18:9", "test t_loop@main.pebble:34:24" ],
            // identical code on two lines: each failure keeps its own line (the assert, as
            // the case the optimizer dropped its failing branch from says)
            t_twin_b:     [ "main.pebble:28:5", "twinB@main.pebble:28:5", "test t_twin_b@main.pebble:35:39" ],
            t_twin_a:     [ "main.pebble:24:5", "twinA@main.pebble:24:5", "test t_twin_a@main.pebble:36:26" ],
        });
    });

    test("a failure in an imported file", async () => {
        expect( await failures([
            [ "main.pebble", lines(
/*  1 */ "import { risky } from \"./lib.pebble\";",
/*  2 */ "test t_imported() { assert risky( 0 ) == 1; }",
            )],
            [ "lib.pebble", lines(
/*  1 */ "export function risky( x: int ): int {",
/*  2 */ "    assert x > 0 else \"x must be positive\";",
/*  3 */ "    return x;",
/*  4 */ "}",
            )],
        ]) ).toEqual({
            t_imported: [ "lib.pebble:2:5", "risky@lib.pebble:2:5", "test t_imported@main.pebble:2:28" ],
        });
    });

    describe.each([
        [ "legacy", true, "v3" ],
        [ "legacy", false, "v3" ],
        [ "minimal", true, "experimental-v4" ],
        [ "minimal", false, "experimental-v4" ],
        [ "legacy", false, "experimental-v4" ],
    ] as const )( "encodingStrategy %s, removeTraces %s, target %s", ( encodingStrategy, removeTraces, targetPlutusVersion ) => {
        const cfg = { encodingStrategy, removeTraces, targetPlutusVersion } as Partial<CompilerOptions>;
        test("F1 and F2 resolve to the same lines", async () => {
            expect( await failures([[ "main.pebble", F1 ]], cfg ) ).toEqual( F1_EXPECTED );
            expect( await failures([[ "main.pebble", F2 ]], cfg ) ).toEqual( F2_EXPECTED );
        });
    });
});

describe("sourcemaps: the map", () => {

    const ENTRY = lines(
        "export function entry( a: int ): int {",
        "    assert a > 10 else \"a too small\";",
        "    return a + 1;",
        "}",
    );

    test("describes the program it comes with", async () => {
        const { compiler } = makeCompiler([[ "src/index.pebble", F2 ]]);
        const { bytes, sourceMap } = await compiler.exportWithSourceMap({ entry: "src/index.pebble", root: "/", functionName: "entry" } as any );
        const map = parseSourceMap( JSON.stringify( sourceMap ) );
        const program = parseUPLC( bytes, "flat" );
        expect( map.termCount ).toBe( indexProgram( program.body ).terms.length );
        expect( map.programHash ).toBe( toHex( blake2b_256( bytes ) ) );
        expect( map.programVersion ).toBe( program.version.toString() );
        expect( map.compiler ).toBe( "pebble " + COMPILER_VERSION );
        // project-relative paths: maps hold no local directories
        expect( map.sources ).toEqual([ "src/index.pebble" ]);
        expect( map.names ).toEqual( expect.arrayContaining([ "isBig", "check", "entry" ]) );
        expect( map.asserts.map( a => a[2] ).sort() ).toEqual([ 6, 7 ]);
        expect( map.sourcesContent ).toBeUndefined();
    });

    test("never changes the script", async () => {
        const withMap = await makeCompiler([[ "main.pebble", F2 ]]).compiler
            .export({ entry: "main.pebble", root: "/", functionName: "entry", sourceMap: true } as any );
        const withoutMap = await makeCompiler([[ "main.pebble", F2 ]]).compiler
            .export({ entry: "main.pebble", root: "/", functionName: "entry", sourceMap: false } as any );
        expect( toHex( withMap ) ).toBe( toHex( withoutMap ) );
    });

    test("is written next to `out.flat`, unless disabled", async () => {
        const on = makeCompiler([[ "main.pebble", ENTRY ]]);
        await on.compiler.export({ entry: "main.pebble", root: "/", functionName: "entry" } as any );
        expect( on.ioApi.outputs.has( "out/out.flat" ) ).toBe( true );
        const written = on.ioApi.outputs.get( "out/out.flat.map" );
        expect( written ).toBeDefined();
        expect( parseSourceMap( typeof written === "string" ? written : new TextDecoder().decode( written as Uint8Array ) ).sources ).toEqual([ "main.pebble" ]);

        const off = makeCompiler([[ "main.pebble", ENTRY ]], { sourceMap: false });
        await off.compiler.export({ entry: "main.pebble", root: "/", functionName: "entry" } as any );
        expect( off.ioApi.outputs.has( "out/out.flat" ) ).toBe( true );
        expect( off.ioApi.outputs.has( "out/out.flat.map" ) ).toBe( false );
    });

    test("sourceMapContent includes the sources", async () => {
        const { compiler } = makeCompiler([[ "main.pebble", ENTRY ]], { sourceMapContent: true });
        const { sourceMap } = await compiler.exportWithSourceMap({ entry: "main.pebble", root: "/", functionName: "entry" } as any );
        expect( sourceMap.sourcesContent ).toEqual([ ENTRY ]);
    });

    test("locates a failure of the script with parameters and arguments applied", async () => {
        // a parameterized script as offchain code applies it: root applications
        const { compiler } = makeCompiler([[ "main.pebble", lines(
            "export function guarded( limit: int, a: int ): int {",
            "    assert a < limit else \"over the limit\";",
            "    return a;",
            "}",
        )]]);
        const { bytes, sourceMap } = await compiler.exportWithSourceMap({ entry: "main.pebble", root: "/", functionName: "guarded" } as any );
        // what a transaction builder evaluates: a freshly decoded script, parameter, argument
        const applied = new Application( new Application( parseUPLC( bytes, "flat" ).body, UPLCConst.int( 10 ) ), UPLCConst.int( 11 ) );
        const failure = locateFailure({ term: applied, map: parseSourceMap( JSON.stringify( sourceMap ) ) });
        expect( at( failure?.location ) ).toBe( "main.pebble:2:5" );
        expect( failure?.stack.map( f => f.functionName ) ).toEqual([ "guarded" ]);
    });

    test("compiling again in the same process gives the same map", async () => {
        // `_compTimeDropN` used to hand out its shared `drop` templates, which the passes of
        // the first compilation rewrote (and stamped with its source); a later compilation
        // then listed that source too and had terms mapped to it
        const CONTRACT = lines(
            "contract Counter {",
            "    param owner: PubKeyHash;",
            "    spend take( amount: int ) {",
            "        const { tx } = context;",
            "        assert tx.requiredSigners.includes( this.owner );",
            "        assert tx.fee > amount;",
            "    }",
            "}",
        );
        const first = await makeCompiler([[ "main.pebble", CONTRACT ]]).compiler.compileWithSourceMap({ entry: "main.pebble", root: "/" });
        const second = await makeCompiler([[ "main.pebble", CONTRACT ]]).compiler.compileWithSourceMap({ entry: "main.pebble", root: "/" });
        expect( toHex( second.bytes ) ).toBe( toHex( first.bytes ) );
        expect( second.sourceMap.sources ).toEqual([ "main.pebble" ]);
        expect( second.sourceMap ).toEqual( first.sourceMap );
    });
});
