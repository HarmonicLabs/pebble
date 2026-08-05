import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { Machine } from "@harmoniclabs/buildooor";
import { DataList, DataI } from "@harmoniclabs/plutus-data";

// COMPUTE-ONCE guarantee (GravityDex BUG 15): a `const` captured by a loop
// body evaluates ONCE, not once per iteration. Before the fix, a partial
// value (any user-function call) whose only references sat inside a loop
// was inlined into the loop body — the audit measured a fold whose
// marginal cost per element was a FULL isqrt (12.29M cpu; 71x the plu-ts
// swap path on the real validator). The letted-placement machinery now
// binds such values once, just above the loop's recursive node.

const SRC = `
function isqrt( n: int ): int {
    if (n < 2) return n;
    let x: int = n;
    let y: int = (x + 1) / 2;
    while (y < x) {
        x = y;
        y = (x + n / x) / 2;
    }
    return x;
}
export function main( xs: data, k: int ): int {
    const kk = isqrt(k * 1_000_000 * 1_000_000);
    let acc: int = 0;
    for (const e of std.builtins.unListData(xs)) {
        acc = acc + std.builtins.unIData(e) * kk;
    }
    return acc;
}`;

jest.setTimeout( 120_000 );

test("a captured expensive const evaluates once, not per loop element", async () => {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(SRC)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: "main", entry: "test.pebble", root: "/" });
    if( c.diagnostics.length )
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));
    const uplc: UPLCTerm = parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;

    const evalN = ( n: number ) => {
        const lst = new DataList( Array.from({length: n}, (_, i) => new DataI(BigInt(i+1))) );
        const out = Machine.eval(
            new Application( new Application( uplc, UPLCConst.data( lst ) ), UPLCConst.int( 3n ) )
        );
        return {
            v: (out.result as any).value as bigint,
            cpu: BigInt( (out as any).budgetSpent?.cpu ?? (out as any).budget?.cpu ?? 0 ),
        };
    };

    const r2 = evalN(2);
    const r5 = evalN(5);

    // correctness: isqrt(3e12) = 1732050
    expect( r2.v ).toBe( 5196150n );   // (1+2)  * 1732050
    expect( r5.v ).toBe( 25980750n );  // (1..5) * 1732050

    // compute-once: the marginal cost per extra element must be loop
    // overhead only (~0.6M with the current cost model), NOT a full isqrt
    // (~12M). Generous threshold to stay robust across cost-model drift
    // while still catching any per-iteration re-evaluation.
    const marginal = ( r5.cpu - r2.cpu ) / 3n;
    expect( marginal ).toBeLessThan( 3_000_000n );
});
