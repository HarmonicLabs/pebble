import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm, showUPLC } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

// Eta reduction of predicate closures (0.4.4): a lambda like
// `(e: int) => e == captured` compiles to the PARTIAL builtin application
// `equalsInteger captured` (commutative flip), and `\x -> f x` reduces to
// `f` when `x` is not free in `f` — no closure allocation, one less
// capture for the letted machinery. See `etaReduceLambdasAndReturnRoot`.

async function compile( src: string ): Promise<{ uplc: UPLCTerm, txt: string }> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: "main", entry: "test.pebble", root: "/" });
    if( c.diagnostics.length )
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));
    const uplc = parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
    return { uplc, txt: showUPLC( uplc ) };
}

function evalInt1( uplc: UPLCTerm, n: bigint ): bigint {
    const r = Machine.eval( new Application( uplc, UPLCConst.int( n ) ) ).result;
    if( !( r instanceof CEKConst ) ) throw new Error( "eval failed: " + JSON.stringify( (r as any).msg ?? r ) );
    return r.value as bigint;
}

jest.setTimeout( 60_000 );

describe("eta reduction of predicate closures", () => {

    test("`(e) => e == captured` becomes a partial equalsInteger application", async () => {
        const { uplc, txt } = await compile(`
function count( xs: List<int>, pred: (e: int) => bool ): int {
    let acc: int = 0;
    for (const x of xs) { if (pred(x)) { acc = acc + 1; } }
    return acc;
}
export function main( n: int ): int {
    const target: int = n * 2;
    const isTarget = (e: int) => e == target;
    const xs: List<int> = [1, 2, 4, 2];
    return count( xs, isTarget );
}`);
        expect( evalInt1( uplc, 1n ) ).toBe( 2n );
        // no lambda wrapping the equality remains in the emitted program
        expect( /\(lam \w+ \[\[\(builtin equalsInteger\) \w+\] \w+\]\)/.test( txt ) ).toBe( false );
        expect( txt ).toContain( "(builtin equalsInteger)" );
    });

    test("non-commutative comparisons keep their semantics", async () => {
        const { uplc } = await compile(`
function count( xs: List<int>, pred: (e: int) => bool ): int {
    let acc: int = 0;
    for (const x of xs) { if (pred(x)) { acc = acc + 1; } }
    return acc;
}
export function main( n: int ): int {
    const limit: int = 3;
    const below = (e: int) => e < limit;
    const xs: List<int> = [1, 2, 4, 5];
    return count( xs, below );
}`);
        // 1 and 2 are < 3
        expect( evalInt1( uplc, 0n ) ).toBe( 2n );
    });

    test("`\\x -> f x` reduces and still evaluates (captured-second shape)", async () => {
        const { uplc } = await compile(`
function apply2( f: (a: int) => int, x: int ): int { return f( f( x ) ); }
export function main( n: int ): int {
    const addN = (a: int) => a + n;
    return apply2( addN, 10 );
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 20n );
    });
});
