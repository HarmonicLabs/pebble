import { defaultOptions, testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, prettyUPLC, UPLCConst } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

function abs( n: bigint ): bigint {
    return n < 0n ? -n : n;
}

/** TypeScript reference implementation of `ecd` (a.k.a. Euclidean GCD). */
function ecd( a: bigint, b: bigint ): bigint {
    if( b === 0n ) return abs( a );

    return ecd( b, a % b );
}

describe("abs", () => {

    test("Pebble `abs` matches the TypeScript reference", async () => {

        const fileName = "test.pebble";
        const srcText = `
export function abs( n: int ): int {
    return n < 0 ? -n : n;
}
`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );

        await compiler.export({ functionName: "abs", entry: fileName, root: "/" });

        expect( compiler.diagnostics.length ).toBe( 0 );

        const output = ioApi.outputs.get("out/out.flat")!;
        expect( output instanceof Uint8Array ).toBe( true );

        const uplc = parseUPLC( output ).body;

        const cases: bigint[] = [
            0n,
            1n,
            -1n,
            42n,
            -42n,
            1000n,
            -1000n,
            // bigger values to ensure no overflow in CEK math
            9_999_999_999n,
            -9_999_999_999n,
            // boundary-ish
            2n ** 63n,
            -( 2n ** 63n ),
        ];

        for( const n of cases ) {
            const expected = abs( n );

            const applied = new Application( uplc, UPLCConst.int( n ) );
            const result = Machine.eval( applied );

            expect( result.result instanceof CEKConst ).toBe( true );
            const actual = ( result.result as CEKConst ).value;
            expect( actual ).toBe( expected );
        }
    });

});

describe("ecd", () => {

    test("Pebble `ecd` matches the TypeScript reference", async () => {

        const fileName = "test.pebble";
        const srcText = `
function abs( n: int ): int {
    return n < 0 ? -n : n;
}

export function ecd( a: int, b: int ): int {
    if( b === 0 ) return abs( a );

    return ecd( b, a % b );
}
`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );

        await compiler.export({ functionName: "ecd", entry: fileName, root: "/" });

        expect( compiler.diagnostics.length ).toBe( 0 );

        const output = ioApi.outputs.get("out/out.flat")!;
        expect( output instanceof Uint8Array ).toBe( true );

        const uplc = parseUPLC( output ).body;

        // Input pairs to compare. Includes:
        //   - small + large coprime / non-coprime cases
        //   - identity edge cases (one operand is 0)
        //   - operand equal to the other
        // Negative-operand cases are skipped because TS `%` and the
        // Plutus `modInteger` / `quotInteger` builtins disagree on the
        // sign of the remainder for negatives, so the two `ecd`
        // implementations would diverge on those even though both are
        // "correct" GCDs.
        const cases: [ bigint, bigint ][] = [
            [ 12n, 8n ],
            [ 8n, 12n ],
            [ 100n, 75n ],
            [ 17n, 5n ],
            [ 5n, 17n ],
            [ 48n, 18n ],
            [ 1000n, 750n ],
            [ 7n, 7n ],
            [ 5n, 0n ],
            [ 0n, 5n ],
            [ 1n, 1n ],
            [ 99991n, 12345n ],
        ];

        for( const [ a, b ] of cases ) {
            const expected = ecd( a, b );

            // Pebble `(a: int, b: int) -> int` compiles to `λa. λb. body`,
            // so we apply twice.
            const applied = new Application(
                new Application( uplc, UPLCConst.int( a ) ),
                UPLCConst.int( b )
            );
            const result = Machine.eval( applied );

            expect( result.result instanceof CEKConst ).toBe( true );
            console.log( result )
            const actual = ( result.result as CEKConst ).value;
            expect( actual ).toBe( expected );
        }
    });

});