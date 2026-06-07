import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { TestResult } from "../test/TestResult";

/**
 * Unit-test coverage for the `test name() { ... }` language feature.
 *
 * A `test` with no parameters is a *unit* test: the compiler synthesises a
 * 0-arg function from the body, compiles it to UPLC and evaluates it once.
 * The test passes iff the body runs to completion without a CEK error; a
 * failing `assert ... else "msg"` raises an error and pushes "msg" onto the
 * iteration logs.
 *
 * See `Compiler.test()` / `_runOneTest` in src/compiler/Compiler.ts and the
 * `TestResult` shape in src/compiler/test/TestResult.ts.
 */
async function runTestSuite(
    src: string,
    opts: { nameFilter?: string | RegExp } = {}
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

describe("test feature — unit tests", () => {

    test("a passing assertion yields one passing `unit` iteration", async () => {
        const { compiler, results } = await runTestSuite(`
test math_holds() {
    assert 1 + 1 == 2 else "math is broken";
}`);
        expect( compiler.diagnostics ).toEqual( [] );
        expect( results ).toHaveLength( 1 );

        const r = results[0];
        expect( r.name ).toBe( "math_holds" );
        expect( r.kind ).toBe( "unit" );
        expect( r.passed ).toBe( true );
        // a unit test is always exactly one iteration
        expect( r.iterations ).toHaveLength( 1 );
        expect( r.iterations[0].passed ).toBe( true );
        expect( r.iterations[0].error ).toBeUndefined();
        // unit tests have no fuzzed inputs
        expect( r.iterations[0].inputs ).toBeUndefined();
    });

    test("a failing assertion fails the test and records the `else` message in logs", async () => {
        const { compiler, results } = await runTestSuite(`
test math_lies() {
    assert 1 + 1 == 3 else "nope";
}`);
        expect( compiler.diagnostics ).toEqual( [] );

        const r = results[0];
        expect( r.kind ).toBe( "unit" );
        expect( r.passed ).toBe( false );
        expect( r.iterations[0].passed ).toBe( false );
        // the failing `assert` lowers to an explicit UPLC error...
        expect( r.iterations[0].error?.msg ).toBe( "explicit error from uplc" );
        // ...and the `else` string is traced before the error fires
        expect( r.iterations[0].logs ).toContain( "nope" );
    });

    test("a body with no assertions trivially passes", async () => {
        const { compiler, results } = await runTestSuite(`
test does_nothing() {
    const x = 1 + 1;
}`);
        expect( compiler.diagnostics ).toEqual( [] );
        expect( results[0].passed ).toBe( true );
    });

    test("`trace` output is captured on the iteration logs", async () => {
        const { results } = await runTestSuite(`
test traces() {
    trace "hello from a test";
    assert true else "unreachable";
}`);
        expect( results[0].passed ).toBe( true );
        expect( results[0].iterations[0].logs ).toEqual( [ "hello from a test" ] );
    });

    test("the first failing assertion stops the body; earlier logs survive", async () => {
        const { results } = await runTestSuite(`
test stops_at_first_failure() {
    trace "before";
    assert true  else "first never fails";
    assert false else "second fails";
    trace "after"; // never reached
}`);
        const r = results[0];
        expect( r.passed ).toBe( false );
        // "before" is traced, the failing assert traces its else-message,
        // and "after" is never reached.
        expect( r.iterations[0].logs ).toEqual( [ "before", "second fails" ] );
    });

    test("a test can call top-level functions defined in the same module", async () => {
        const { compiler, results } = await runTestSuite(`
function double( n: int ): int { return n * 2; }

test uses_helper() {
    assert double( 21 ) == 42 else "double is wrong";
}`);
        expect( compiler.diagnostics ).toEqual( [] );
        expect( results[0].passed ).toBe( true );
    });

    test("every `test` in a file is discovered and reported in declaration order", async () => {
        const { results } = await runTestSuite(`
test first()  { assert true  else "a"; }
test second() { assert false else "b"; }
test third()  { assert true  else "c"; }`);
        expect( results.map( r => r.name ) ).toEqual( [ "first", "second", "third" ] );
        expect( results.map( r => r.passed ) ).toEqual( [ true, false, true ] );
    });

    test("a file with no `test` declarations produces no results", async () => {
        const { compiler, results } = await runTestSuite(`const x = 1 + 1;`);
        expect( compiler.diagnostics ).toEqual( [] );
        expect( results ).toEqual( [] );
    });

    test("`nameFilter` as a substring selects a subset of tests", async () => {
        const src = `
test alpha_one() { assert true else "x"; }
test alpha_two() { assert true else "x"; }
test beta_one()  { assert true else "x"; }`;
        const { results } = await runTestSuite( src, { nameFilter: "alpha" } );
        expect( results.map( r => r.name ) ).toEqual( [ "alpha_one", "alpha_two" ] );
    });

    test("`nameFilter` as a RegExp selects matching tests", async () => {
        const src = `
test alpha_one() { assert true else "x"; }
test alpha_two() { assert true else "x"; }
test beta_one()  { assert true else "x"; }`;
        const { results } = await runTestSuite( src, { nameFilter: /_one$/ } );
        expect( results.map( r => r.name ) ).toEqual( [ "alpha_one", "beta_one" ] );
    });

    test("an executed unit test reports a non-zero budget equal to its single iteration", async () => {
        const { results } = await runTestSuite(`
test spends_budget() {
    assert 2 + 2 == 4 else "x";
}`);
        const r = results[0];
        expect( r.totalBudget.cpu ).toBeGreaterThan( 0n );
        expect( r.totalBudget.mem ).toBeGreaterThan( 0n );
        // totalBudget is the sum over iterations; a unit test has exactly one
        expect( r.totalBudget ).toEqual( r.iterations[0].budgetSpent );
    });
});
