import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { TestResult } from "../test/TestResult";

/**
 * Coverage for property tests the runner cannot execute: parameters whose
 * type has no built-in fuzzer (runtime/SoP-encoded types, function types)
 * and no usable `via` expression.
 *
 * In those cases `Compiler.test()` returns a `property` `TestResult` with
 * `passed: false`, an empty `iterations` array, and a populated
 * `skippedReason`. See `_runOneTest` in src/compiler/Compiler.ts and
 * `FuzzerInfo` in src/compiler/tir/statements/TirTestStmt.ts.
 */
async function runTestSuite(
    src: string,
    opts: { propertyIterations?: number; seed?: number; nameFilter?: string | RegExp } = {}
): Promise<{ compiler: Compiler; results: TestResult[] }>
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    const results = await compiler.test({ entry: "main.pebble", root: "/", ...opts } as any );
    return { compiler, results };
}

describe("test feature — unsupported fuzzers are skipped, not crashed", () => {

    // (These used a `List` of runtime structs as the type with no fuzzer. That
    // type is refused where it is written since PEBBLE_BUGS 82: no UPLC list
    // holds a constructor term. A function is the type nothing samples now.)
    test("a function has no built-in fuzzer and is skipped", async () => {
        const { compiler, results } = await runTestSuite(`
test needs_a_fuzzer( ps: ( x: int ) => int ) {
    assert true else "x";
}`);
        // the program itself is well-typed — skipping is a runner decision,
        // not a compile error
        expect( compiler.diagnostics ).toEqual( [] );

        const r = results[0];
        expect( r.kind ).toBe( "property" );
        expect( r.passed ).toBe( false );
        expect( r.iterations ).toEqual( [] );
        expect( r.totalBudget ).toEqual( { cpu: 0n, mem: 0n } );
        expect( r.skippedReason ).toBeDefined();
        // the message names the offending parameter and points at the fix
        expect( r.skippedReason ).toContain( "ps" );
        expect( r.skippedReason ).toContain( "no default fuzzer" );
    });

    test("a 'via' expression whose type matches neither fuzzer shape is skipped", async () => {
        const { results } = await runTestSuite(`
test bad_via( a: int via ( x: bytes ) => 0 ) {
    assert a == a else "x";
}`);
        const r = results[0];
        expect( r.kind ).toBe( "property" );
        expect( r.passed ).toBe( false );
        expect( r.iterations ).toEqual( [] );
        expect( r.skippedReason ).toBeDefined();
        expect( r.skippedReason!.toLowerCase() ).toContain( "via" );
    });

    test("if any one parameter is unsupported the whole property test is skipped", async () => {
        // first param has a built-in fuzzer, second does not
        const { results } = await runTestSuite(`
test mixed_support( n: int, w: ( x: int ) => int ) {
    assert n == n else "x";
}`);
        const r = results[0];
        expect( r.passed ).toBe( false );
        expect( r.iterations ).toEqual( [] );
        expect( r.skippedReason ).toContain( "w" );
    });

    test("a skipped test does not prevent sibling tests from running", async () => {
        const { results } = await runTestSuite(`
test unit_ok() {
    assert 1 + 1 == 2 else "x";
}
test prop_skipped( w: ( x: int ) => int ) {
    assert true else "x";
}
test prop_ok( n: int ) {
    assert n == n else "x";
}`, { propertyIterations: 5, seed: 1 } );

        expect( results.map( r => r.name ) ).toEqual( [ "unit_ok", "prop_skipped", "prop_ok" ] );

        const [ unit, skipped, prop ] = results;

        expect( unit.kind ).toBe( "unit" );
        expect( unit.passed ).toBe( true );

        expect( skipped.passed ).toBe( false );
        expect( skipped.skippedReason ).toBeDefined();
        expect( skipped.iterations ).toEqual( [] );

        expect( prop.kind ).toBe( "property" );
        expect( prop.passed ).toBe( true );
        expect( prop.skippedReason ).toBeUndefined();
        expect( prop.iterations ).toHaveLength( 5 );
    });
});
