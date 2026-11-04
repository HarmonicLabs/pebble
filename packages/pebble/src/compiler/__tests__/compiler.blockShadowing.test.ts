import { testOptions, productionOptions, COMPILER_VERSION, CompilerOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

/**
 * A declaration in a block may shadow a variable of the same function:
 *
 *   let x = 1;
 *   { let x = 5; return x; }
 *
 * The type checker accepted this, but the block is compiled inline in the enclosing
 * body, where both declarations had the TIR name `x`: the inner one was dropped and
 * `return x` returned 1 (with another type, the outer value of the wrong type). A
 * shadowing declaration now gets its own TIR name.
 */

jest.setTimeout( 120_000 );

/** each source declares `f` and a test asserting its value */
const cases: [ string, string, string ][] = [
    [ "inner let, return inside the block", "function f(): int { let x = 1; { let x = 5; return x; } }", "f() == 5" ],
    [ "inner let, the outer one after the block", "function f(): int { let x = 1; { let x = 5; } return x; }", "f() == 1" ],
    [ "inner const", "function f(): int { const x = 1; { const x = 5; return x * 3; } }", "f() == 15" ],
    [ "another type", "function f(): bytes { let x = 1; { const x = #ab; return x; } }", "f() == #ab" ],
    [ "a parameter", "function f( x: int ): int { { const x = 7; return x; } }", "f( 1 ) == 7" ],
    [ "the parameter again after the block", "function f( x: int ): int { { const x = 7; } return x; }", "f( 1 ) == 1" ],
    [ "assigning the outer variable from a block", "function f(): int { let x = 1; { x = 5; } return x; }", "f() == 5" ],
    [ "shadowing inside an if branch", "function f( b: boolean ): int { let x = 1; if( b ) { const x = 5; return x; } return x; }", "f( true ) == 5 && f( false ) == 1" ],
    [ "two levels", "function f(): int { let x = 1; { let x = 2; { let x = 3; return x; } } }", "f() == 3" ],
    [ "a closure sees the inner one", "function f(): int { const x = 1; { const x = 4; const g = ( y: int ) => x + y; return g( 1 ); } }", "f() == 5" ],
    [ "a for-of element", "function f(): int { const x = 100; let total = 0; for( const x of [ 1, 2 ] ) { total += x; } return total + x; }", "f() == 103" ],
    [ "a list rest", "function f( xs: List<int> ): int { const rest = 9; { const [ a, ...rest ] = xs; return rest.length(); } }", "f( [ 1, 2, 3 ] ) == 2" ],
];

async function runTests( src: string, cfg: Partial<CompilerOptions> ): Promise<string[]>
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([[ "main.pebble", fromUtf8( src ) ]]),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler( ioApi, { ...testOptions, ...cfg, compilerVersion: COMPILER_VERSION } as CompilerOptions );
    const results = await compiler.test({ entry: "main.pebble", root: "/" } as any );
    const diagnostics = compiler.diagnostics.map( String );
    if( diagnostics.length > 0 ) return diagnostics;
    return results.map( r => r.passed ? "PASS" : "FAIL: " + ( r.iterations[ r.iterations.length - 1 ]?.error?.msg ?? "" ) );
}

describe.each([
    [ "test options", testOptions ],
    [ "production options", productionOptions ],
] as const )( "block shadowing (%s)", ( _name, cfg ) => {
    test.each( cases )( "%s", async ( _case, fn, assertion ) => {
        expect( await runTests( `${fn}\ntest t() { assert ${assertion}; }`, cfg ) ).toEqual([ "PASS" ]);
    });
});

test("a declaration shadowing another in the same block is still an error", async () => {
    expect( await runTests( "function f(): int { let x = 1; let x = 2; return x; }\ntest t() { assert f() == 2; }", {} ) )
    .toEqual( expect.arrayContaining([ expect.stringContaining( "Duplicate identifier 'x'" ) ]) );
});
