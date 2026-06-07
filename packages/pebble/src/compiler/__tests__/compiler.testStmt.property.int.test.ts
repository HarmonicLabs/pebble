import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { TestResult } from "../test/TestResult";

/**
 * Property-test coverage for the `test name( a: int, ... ) { ... }` feature
 * over the built-in `int` fuzzer.
 *
 * A `test` with one or more parameters is a *property* test. For each
 * parameter whose type has a built-in TS-side generator (here: `int`) the
 * runner samples `propertyIterations` value-tuples from a seeded PRNG
 * (`src/compiler/test/fuzz/PRNG.ts`), applies them to the compiled body and
 * fails on the first iteration that errors (Phase 1: fail-fast, no shrinking).
 *
 * The `int` sampler is edge-biased: ~1/16 of draws are one of
 * {0, 1, -1, INT64_MAX, INT64_MIN, INT32_MAX, INT32_MIN}.
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

describe("test feature — property tests over `int`", () => {

    test("a parameterised test is classified as a `property` test", async () => {
        const { compiler, results } = await runTestSuite(`
test mul_by_zero_is_zero( a: int ) {
    assert a * 0 == 0 else "a*0 != 0";
}`, { propertyIterations: 25, seed: 1 } );
        expect( compiler.diagnostics ).toEqual( [] );
        expect( results[0].kind ).toBe( "property" );
        expect( results[0].skippedReason ).toBeUndefined();
    });

    test("a true property passes across all sampled iterations", async () => {
        const ITERS = 50;
        const { results } = await runTestSuite(`
test addition_commutes( a: int, b: int ) {
    assert a + b == b + a else "addition not commutative";
}`, { propertyIterations: ITERS, seed: 12345 } );

        const r = results[0];
        expect( r.passed ).toBe( true );
        expect( r.iterations ).toHaveLength( ITERS );
        expect( r.iterations.every( it => it.passed ) ).toBe( true );
        // every iteration records the tuple it was fed
        for( const it of r.iterations )
        {
            expect( it.inputs?.map( i => i.name ) ).toEqual( [ "a", "b" ] );
            expect( it.inputs?.every( i => typeof i.value === "bigint" ) ).toBe( true );
        }
    });

    test("a false property fails, stops at the first counterexample, and reports the offending input", async () => {
        // `a < 0` is false for the very first non-negative sample, so the
        // runner must fail fast rather than completing all 100 iterations.
        const { results } = await runTestSuite(`
test all_ints_are_negative( a: int ) {
    assert a < 0 else "found a non-negative int";
}`, { propertyIterations: 100, seed: 1 } );

        const r = results[0];
        expect( r.passed ).toBe( false );
        // fail-fast: far fewer than the 100 requested iterations were run
        expect( r.iterations.length ).toBeGreaterThan( 0 );
        expect( r.iterations.length ).toBeLessThan( 100 );

        const last = r.iterations[ r.iterations.length - 1 ];
        expect( last.passed ).toBe( false );
        expect( last.error?.msg ).toBe( "explicit error from uplc" );
        expect( last.logs ).toContain( "found a non-negative int" );

        // the counterexample is surfaced and is indeed non-negative
        const counterexample = last.inputs?.[0].value as bigint;
        expect( typeof counterexample ).toBe( "bigint" );
        expect( counterexample >= 0n ).toBe( true );
    });

    test("the same seed produces identical input tuples (deterministic)", async () => {
        const src = `
test associates( a: int, b: int, c: int ) {
    assert (a + b) + c == a + (b + c) else "not associative";
}`;
        const a = await runTestSuite( src, { propertyIterations: 30, seed: 777 } );
        const b = await runTestSuite( src, { propertyIterations: 30, seed: 777 } );

        const inputsOf = ( res: TestResult ) =>
            res.iterations.map( it => it.inputs!.map( i => String( i.value ) ) );

        expect( a.results[0].passed ).toBe( true );
        expect( inputsOf( a.results[0] ) ).toEqual( inputsOf( b.results[0] ) );
        expect( a.results[0].seed ).toBe( 777 );
    });

    test("different seeds produce different input tuples", async () => {
        const src = `
test identity( a: int ) {
    assert a == a else "x";
}`;
        const a = await runTestSuite( src, { propertyIterations: 30, seed: 1 } );
        const b = await runTestSuite( src, { propertyIterations: 30, seed: 2 } );

        const inputsOf = ( res: TestResult ) =>
            JSON.stringify( res.iterations.map( it => it.inputs!.map( i => String( i.value ) ) ) );

        expect( inputsOf( a.results[0] ) ).not.toEqual( inputsOf( b.results[0] ) );
    });

    test("`propertyIterations` controls the number of iterations and is floored at 1", async () => {
        const src = `
test trivially_true( a: int ) {
    assert a - a == 0 else "x";
}`;
        const ten  = await runTestSuite( src, { propertyIterations: 10, seed: 5 } );
        expect( ten.results[0].iterations ).toHaveLength( 10 );

        // a non-positive request is clamped up to a single iteration
        const zero = await runTestSuite( src, { propertyIterations: 0, seed: 5 } );
        expect( zero.results[0].iterations ).toHaveLength( 1 );
    });

    test("the edge-biased sampler reliably emits known boundary integers", async () => {
        // `a != -1` is false only for the single value -1. Sampling -1 from
        // the uniform 64-bit range is astronomically unlikely (~2^-64), so a
        // failure within a few hundred iterations can only come from the
        // sampler's edge bias, which lists -1 among its boundary values.
        const { results } = await runTestSuite(`
test never_minus_one( a: int ) {
    assert a != -1 else "sampler produced -1";
}`, { propertyIterations: 500, seed: 0 } );

        const r = results[0];
        expect( r.passed ).toBe( false );
        const counterexample = r.iterations[ r.iterations.length - 1 ].inputs?.[0].value as bigint;
        expect( counterexample ).toBe( -1n );
    });

    test("the aggregate budget is the sum of per-iteration budgets", async () => {
        const ITERS = 8;
        const { results } = await runTestSuite(`
test costs_something( a: int ) {
    assert a + 0 == a else "x";
}`, { propertyIterations: ITERS, seed: 3 } );

        const r = results[0];
        expect( r.iterations ).toHaveLength( ITERS );
        const summedCpu = r.iterations.reduce( ( acc, it ) => acc + it.budgetSpent.cpu, 0n );
        const summedMem = r.iterations.reduce( ( acc, it ) => acc + it.budgetSpent.mem, 0n );
        expect( r.totalBudget.cpu ).toBe( summedCpu );
        expect( r.totalBudget.mem ).toBe( summedMem );
        expect( r.totalBudget.cpu ).toBeGreaterThan( 0n );
    });
});
