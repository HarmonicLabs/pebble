import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { TestResult } from "../test/TestResult";

/**
 * Property-test coverage for the `test name( x: boolean, ... ) { ... }`
 * feature over the built-in `boolean` fuzzer.
 *
 * `boolean` parameters are sampled uniformly (`PRNG.nextBool`). Iteration
 * inputs are recorded as JS booleans. Properties are expressed with the
 * boolean operators `!`, `&&`, `||` and `if` — note that `==`/`!=` on
 * `boolean` currently hits a backend gap (`_equalBoolean` is not lowered),
 * so equality is deliberately avoided here.
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

describe("test feature — property tests over `boolean`", () => {

    test("a boolean parameter makes the test a `property` test and records boolean inputs", async () => {
        const ITERS = 30;
        const { compiler, results } = await runTestSuite(`
test excluded_middle( x: boolean ) {
    assert x || !x else "law of excluded middle failed";
}`, { propertyIterations: ITERS, seed: 1 } );

        expect( compiler.diagnostics ).toEqual( [] );
        const r = results[0];
        expect( r.kind ).toBe( "property" );
        expect( r.passed ).toBe( true );
        expect( r.iterations ).toHaveLength( ITERS );
        for( const it of r.iterations )
        {
            expect( it.inputs?.map( i => i.name ) ).toEqual( [ "x" ] );
            expect( typeof it.inputs?.[0].value ).toBe( "boolean" );
        }
    });

    test("a boolean tautology passes across all iterations", async () => {
        const { results } = await runTestSuite(`
test no_contradiction( x: boolean ) {
    assert !(x && !x) else "x was both true and false";
}`, { propertyIterations: 40, seed: 99 } );
        expect( results[0].passed ).toBe( true );
        expect( results[0].iterations.every( it => it.passed ) ).toBe( true );
    });

    test("a property that holds for only one boolean value fails and reports the counterexample", async () => {
        // `assert x` fails as soon as `x` is sampled `false`. Uniform boolean
        // sampling hits `false` almost immediately.
        const { results } = await runTestSuite(`
test assumes_true( x: boolean ) {
    assert x else "x was false";
}`, { propertyIterations: 100, seed: 1 } );

        const r = results[0];
        expect( r.passed ).toBe( false );
        expect( r.iterations.length ).toBeLessThan( 100 ); // fail-fast

        const last = r.iterations[ r.iterations.length - 1 ];
        expect( last.passed ).toBe( false );
        expect( last.error?.msg ).toBe( "explicit error from uplc" );
        expect( last.logs ).toContain( "x was false" );
        expect( last.inputs?.[0].value ).toBe( false );
    });

    test("multiple boolean parameters are all sampled and recorded per iteration", async () => {
        const { compiler, results } = await runTestSuite(`
test de_morgan( a: boolean, b: boolean ) {
    assert (!(a && b)) || (a && b) else "tautology failed";
}`, { propertyIterations: 50, seed: 7 } );

        expect( compiler.diagnostics ).toEqual( [] );
        const r = results[0];
        expect( r.passed ).toBe( true );
        for( const it of r.iterations )
        {
            expect( it.inputs?.map( i => i.name ) ).toEqual( [ "a", "b" ] );
            expect( it.inputs?.every( i => typeof i.value === "boolean" ) ).toBe( true );
        }
    });

    test("the same seed yields the same boolean draws (deterministic)", async () => {
        const src = `
test idem_or( x: boolean ) {
    assert (x || x) || !x else "x";
}`;
        const a = await runTestSuite( src, { propertyIterations: 25, seed: 4242 } );
        const b = await runTestSuite( src, { propertyIterations: 25, seed: 4242 } );

        const draws = ( res: TestResult ) => res.iterations.map( it => it.inputs![0].value );
        expect( draws( a.results[0] ) ).toEqual( draws( b.results[0] ) );
        // a uniform boolean sampler should produce a mix of both values
        const values = new Set( draws( a.results[0] ) );
        expect( values.has( true ) && values.has( false ) ).toBe( true );
    });

    test("mixed `int` and `boolean` parameters fuzz together", async () => {
        const { compiler, results } = await runTestSuite(`
test guarded( flag: boolean, n: int ) {
    if( flag ) {
        assert n + 0 == n else "int identity broke under flag";
    } else {
        assert n * 1 == n else "int identity broke without flag";
    }
}`, { propertyIterations: 40, seed: 11 } );

        expect( compiler.diagnostics ).toEqual( [] );
        const r = results[0];
        expect( r.kind ).toBe( "property" );
        expect( r.passed ).toBe( true );
        for( const it of r.iterations )
        {
            expect( it.inputs?.map( i => i.name ) ).toEqual( [ "flag", "n" ] );
            expect( typeof it.inputs?.[0].value ).toBe( "boolean" );
            expect( typeof it.inputs?.[1].value ).toBe( "bigint" );
        }
    });
});
