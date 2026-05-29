import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";

/**
 * Hermeticity regression tests.
 *
 * These guard against process-global compiler state leaking between
 * compilations. The historical bug: the IR hash was an interned counter
 * that got rewound at the end of every compile, while module-level
 * `hoisted_*` singletons cached hashes from the old numbering — so from
 * the SECOND compile in a process onwards, fresh nodes collided with the
 * singletons' stale hashes and the hoist/let dedup merged unrelated
 * terms. The fix is content-addressed hashing (no counter, no reset).
 *
 * The key property: compiling the same source N times in one process
 * must produce byte-identical, correct output every time — and one
 * program's compilation must never perturb another's.
 */

async function exportFlat( src: string, functionName: string ): Promise<Uint8Array>
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ ["src/main.pebble", fromUtf8(src)] ]),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await compiler.export({ functionName, entry: "src/main.pebble", root: "/" });
    const out = ioApi.outputs.get("out/out.flat");
    if( !(out instanceof Uint8Array) ) throw new Error("no output produced");
    return out;
}

const ECD_SRC = `
function abs( n: int ): int { return n < 0 ? -n : n; }
export function ecd( a: int, b: int ): int {
    if( b === 0 ) return abs( a );
    return ecd( b, a % b );
}`;

const OTHER_SRC = `
export function f( n: int ): int { return n + 1; }`;

describe("compilation is hermetic (no cross-compile global-state leakage)", () => {

    test("compiling the same source 5x in one process is byte-identical", async () => {
        const first = toHex( await exportFlat( ECD_SRC, "ecd" ) );
        for( let i = 1; i < 5; i++ ) {
            const again = toHex( await exportFlat( ECD_SRC, "ecd" ) );
            expect( again ).toBe( first );
        }
    });

    test("compiling an unrelated program first does not change the output", async () => {
        // baseline: ecd as the very first compile in a fresh sub-sequence
        const baseline = toHex( await exportFlat( ECD_SRC, "ecd" ) );
        // now compile something else, then ecd again — must match baseline
        await exportFlat( OTHER_SRC, "f" );
        const afterOther = toHex( await exportFlat( ECD_SRC, "ecd" ) );
        expect( afterOther ).toBe( baseline );
    });

    test("interleaving two programs keeps each one stable", async () => {
        const ecd0 = toHex( await exportFlat( ECD_SRC, "ecd" ) );
        const f0   = toHex( await exportFlat( OTHER_SRC, "f" ) );
        for( let i = 0; i < 3; i++ ) {
            expect( toHex( await exportFlat( ECD_SRC, "ecd" ) ) ).toBe( ecd0 );
            expect( toHex( await exportFlat( OTHER_SRC, "f" ) ) ).toBe( f0 );
        }
    });
});
