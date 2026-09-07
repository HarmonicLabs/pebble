import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { TestResult } from "../test/TestResult";

/**
 * Coverage for the typed default fuzzers (bytes, data, Optional, List,
 * LinearMap, data structs), executable `via` fuzzers (both the
 * `( seed: int ) => T` and the constant `T` shape), and failing-input
 * shrinking. See `test/fuzz/typedFuzzers.ts` and `_runOneTest` in
 * src/compiler/Compiler.ts.
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

describe("test feature — typed default fuzzers", () => {

    test("bytes parameters get a built-in fuzzer", async () => {
        const { compiler, results } = await runTestSuite(`
test bytes_roundtrip( b: bytes ) {
    assert std.bytes.length( b ) >= 0 else "negative length";
}`, { propertyIterations: 20, seed: 42 } );
        expect( compiler.diagnostics ).toEqual( [] );

        const r = results[0];
        expect( r.kind ).toBe( "property" );
        expect( r.skippedReason ).toBeUndefined();
        expect( r.passed ).toBe( true );
        expect( r.iterations ).toHaveLength( 20 );
    });

    test("List<int> parameters get a built-in fuzzer", async () => {
        const { results } = await runTestSuite(`
test list_len( xs: List<int> ) {
    assert std.list.length( xs ) >= 0 else "negative length";
}`, { propertyIterations: 15, seed: 7 } );
        const r = results[0];
        expect( r.skippedReason ).toBeUndefined();
        expect( r.passed ).toBe( true );
        expect( r.iterations ).toHaveLength( 15 );
    });

    test("Optional<int> parameters get a built-in fuzzer", async () => {
        const { results } = await runTestSuite(`
test opt_default( o: Optional<int> ) {
    const v = o ?? 0;
    assert v == v else "not reflexive";
}`, { propertyIterations: 15, seed: 3 } );
        const r = results[0];
        expect( r.skippedReason ).toBeUndefined();
        expect( r.passed ).toBe( true );
    });

    test("data-struct parameters get a built-in fuzzer driven by the struct shape", async () => {
        const { compiler, results } = await runTestSuite(`
struct Datum {
    Datum {
        owner: bytes,
        amount: int
    }
}
test datum_fields( d: Datum ) {
    assert d.amount == d.amount else "not reflexive";
    assert std.bytes.length( d.owner ) >= 0 else "negative length";
}`, { propertyIterations: 15, seed: 11 } );
        expect( compiler.diagnostics ).toEqual( [] );
        const r = results[0];
        expect( r.skippedReason ).toBeUndefined();
        expect( r.passed ).toBe( true );
    });

    test("multi-constructor data-struct parameters exercise every branch", async () => {
        const { results } = await runTestSuite(`
struct Action {
    Deposit { amount: int }
    Withdraw { amount: int, to: bytes }
    Close {}
}
test action_total( a: Action ) {
    match a {
        when Deposit{ amount }: { assert amount == amount else "x"; }
        when Withdraw{ amount, to }: { assert amount == amount else "y"; }
        when Close{}: { assert true else "z"; }
    }
}`, { propertyIterations: 30, seed: 5 } );
        const r = results[0];
        expect( r.skippedReason ).toBeUndefined();
        expect( r.passed ).toBe( true );
        expect( r.iterations ).toHaveLength( 30 );
    });

    test("runtime (SoP) struct parameters are fuzzed through Constr terms", async () => {
        const { compiler, results } = await runTestSuite(`
runtime struct Point {
    Point { x: int, y: int }
}
test sop_struct( p: Point ) {
    assert p.x == p.x && p.y == p.y else "not reflexive";
}`, { propertyIterations: 15, seed: 8 } );
        expect( compiler.diagnostics ).toEqual( [] );
        const r = results[0];
        expect( r.skippedReason ).toBeUndefined();
        expect( r.passed ).toBe( true );
    });

    test("data parameters get a built-in fuzzer", async () => {
        const { results } = await runTestSuite(`
test any_data( d: data ) {
    assert true else "unreachable";
}`, { propertyIterations: 10, seed: 9 } );
        const r = results[0];
        expect( r.skippedReason ).toBeUndefined();
        expect( r.passed ).toBe( true );
    });
});

describe("test feature — executable `via` fuzzers", () => {

    test("a constant `via` expression is a degenerate fuzzer", async () => {
        const { compiler, results } = await runTestSuite(`
test const_via( a: int via 42 ) {
    assert a == 42 else "expected the constant fuzzer value";
}`, { propertyIterations: 5, seed: 1 } );
        expect( compiler.diagnostics ).toEqual( [] );
        const r = results[0];
        expect( r.kind ).toBe( "property" );
        expect( r.skippedReason ).toBeUndefined();
        expect( r.passed ).toBe( true );
        expect( r.iterations ).toHaveLength( 5 );
    });

    test("a `( seed: int ) => T` `via` expression runs on the CEK machine", async () => {
        const { compiler, results } = await runTestSuite(`
test fn_via( a: int via ( seed: int ) => seed % 10 ) {
    assert a >= 0 && a < 10 else "fuzzer out of range";
}`, { propertyIterations: 10, seed: 2 } );
        expect( compiler.diagnostics ).toEqual( [] );
        const r = results[0];
        expect( r.skippedReason ).toBeUndefined();
        expect( r.passed ).toBe( true );
        expect( r.iterations ).toHaveLength( 10 );
        // via inputs are reported (rendered from the CEK constant)
        expect( r.iterations[0].inputs ).toHaveLength( 1 );
    });

    test("`via` can reference a module-level function", async () => {
        const { results } = await runTestSuite(`
function smallInt( seed: int ): int {
    return seed % 100;
}
test named_via( a: int via smallInt ) {
    assert a >= 0 && a < 100 else "fuzzer out of range";
}`, { propertyIterations: 10, seed: 4 } );
        const r = results[0];
        expect( r.skippedReason ).toBeUndefined();
        expect( r.passed ).toBe( true );
    });

    test("mixed typed and `via` parameters work together", async () => {
        const { results } = await runTestSuite(`
test mixed( n: int, small: int via ( seed: int ) => seed % 5 ) {
    assert small < 5 else "via out of range";
    assert n == n else "not reflexive";
}`, { propertyIterations: 8, seed: 6 } );
        const r = results[0];
        expect( r.skippedReason ).toBeUndefined();
        expect( r.passed ).toBe( true );
    });
});

describe("test feature — shrinking", () => {

    test("a failing int input is minimized toward the smallest counterexample", async () => {
        const { results } = await runTestSuite(`
test always_small( n: int ) {
    assert n < 100 || n < 0 else "too big";
}`, { propertyIterations: 100, seed: 1 } );
        const r = results[0];
        expect( r.passed ).toBe( false );
        // the runner shrank the original failing value
        expect( r.shrinkSteps ).toBeDefined();
        expect( r.shrinkSteps! ).toBeGreaterThan( 0 );
        const minimal = r.iterations[ r.iterations.length - 1 ];
        expect( minimal.passed ).toBe( false );
        expect( minimal.inputs ).toHaveLength( 1 );
        // minimal counterexample of "fails iff n >= 100" is exactly 100
        expect( minimal.inputs![0].value ).toBe( 100n );
    });

    test("passing property tests carry no shrink info", async () => {
        const { results } = await runTestSuite(`
test fine( n: int ) {
    assert n == n else "x";
}`, { propertyIterations: 10, seed: 1 } );
        expect( results[0].passed ).toBe( true );
        expect( results[0].shrinkSteps ).toBeUndefined();
    });
});
