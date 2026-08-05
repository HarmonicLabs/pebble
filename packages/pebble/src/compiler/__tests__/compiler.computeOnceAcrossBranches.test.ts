import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { Machine } from "@harmoniclabs/buildooor";
import { DataList, DataI } from "@harmoniclabs/plutus-data";

// COMPUTE-ONCE across DISPATCH ARMS (GravityDex accept-path blowup): a
// top-level `const` whose references are spread over the conjuncts of a
// `&&` cascade must still evaluate ONCE.
//
// A `&&` cascade lowers to SEQUENTIAL sibling `IRCase`s (each conjunct is a
// new case on the previous conjunct's boolean), so a per-branch binding of
// a shared value never nests — every conjunct re-bound and re-evaluated it.
// On the real t2t swap validator that meant 44 re-evaluations of one oracle
// fold: 28.35B cpu for a single script eval (17x aiken). Because the source
// declares the value at the UNCONDITIONAL top level of the function, source
// semantics evaluate it exactly once per call regardless of any in-function
// dispatch — that is what `IRLettedMeta.eagerFnScope` records.
//
// Asserting on SCALING (1 conjunct vs 8) rather than an absolute budget
// keeps the test meaningful across cost-model drift: each extra conjunct
// may add its own arithmetic, but never another isqrt.

const CONJUNCTS = [
    "kk > 0",
    "n + kk > 0",
    "n * kk > n",
    "kk + kk > 1",
    "n + kk + kk > 2",
    "kk - 1 < kk",
    "kk * 2 > kk",
    "n + kk * 3 > n",
];

const srcWith = ( nConjuncts: number ) => `
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
export function main( xs: data, k: int ): boolean {
    // ONE expensive fn-scope const, referenced from EVERY conjunct below
    const kk = isqrt(k * 1_000_000 * 1_000_000);
    let n: int = 0;
    for (const e of std.builtins.unListData(xs)) {
        n = n + std.builtins.unIData(e);
    }
    const ok: boolean =
        ${CONJUNCTS.slice( 0, nConjuncts ).join("\n        && ")};
    return ok;
}`;

jest.setTimeout( 120_000 );

async function evalMain( src: string ): Promise<bigint>
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: "main", entry: "test.pebble", root: "/" });
    if( c.diagnostics.length )
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));
    const uplc: UPLCTerm = parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;

    const out = Machine.eval(
        new Application(
            new Application( uplc, UPLCConst.data( new DataList([ new DataI( 5n ) ]) ) ),
            UPLCConst.int( 3n )
        )
    );
    expect( (out.result as any).value ).toBe( true );
    return BigInt( (out as any).budgetSpent?.cpu ?? (out as any).budget?.cpu ?? 0 );
}

test("an expensive const referenced across && conjuncts evaluates once", async () => {
    const one = await evalMain( srcWith( 1 ) );
    const eight = await evalMain( srcWith( 8 ) );

    // seven extra conjuncts add only their own arithmetic. Re-evaluating
    // `kk` per conjunct (the pre-fix behavior) would multiply the isqrt —
    // which dominates the whole script — by 8.
    expect( eight ).toBeLessThan( one * 3n / 2n );
});
