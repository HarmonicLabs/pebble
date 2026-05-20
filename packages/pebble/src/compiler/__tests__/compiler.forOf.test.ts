import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, constT, prettyUPLC } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

/**
 * Tests dedicated to `for-of` lowering. Use these to iterate on the
 * desugaring in `src/compiler/TirCompiler/expressify/expressifyForStmt.ts`
 * (`loopToForStmt` builds the `isEmpty`/`head`/`tail` skeleton; an
 * IRCase-based rewrite would land here).
 *
 * All tests compile a pure exported function that takes a single
 * argument and assert the evaluated result. No `ScriptContext`
 * scaffolding required.
 *
 * Run with:
 *   npx jest compiler.forOf.test.ts --silent=false
 */

async function exportFunction(srcText: string, functionName: string): Promise<any> {
    let uplc: any;
    let diagnostics: string[] = [];
    await jest.isolateModulesAsync(async () => {
        const { Compiler } = require("../Compiler");
        const { createMemoryCompilerIoApi } = require("../io/CompilerIoApi");
        const { testOptions, COMPILER_VERSION } = require("../../IR");

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([["test.pebble", fromUtf8(srcText)]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await compiler.export({ functionName, entry: "test.pebble", root: "/" });
        diagnostics = (compiler as any).diagnostics.map((d: any) => d.toString());

        const outputBytes = ioApi.outputs.get("out/out.flat") as Uint8Array;
        if (!outputBytes) {
            throw new Error(
                "export produced no output. Diagnostics:\n" + diagnostics.join("\n")
            );
        }
        uplc = parseUPLC(outputBytes).body;
    });
    return uplc;
}

function applyAndExpectInt(uplc: any, arg: UPLCConst, expected: bigint): void {
    const result = Machine.eval(new Application(uplc, arg));
    expect(result.result instanceof CEKConst).toBe(true);
    expect((result.result as CEKConst).value).toBe(expected);
}

function applyAndExpectBool(uplc: any, arg: UPLCConst, expected: boolean): void {
    const result = Machine.eval(new Application(uplc, arg));
    expect(result.result instanceof CEKConst).toBe(true);
    expect((result.result as CEKConst).value).toBe(expected);
}

function intList(values: number[]): UPLCConst {
    return UPLCConst.listOf(constT.int)(values.map(v => BigInt(v)));
}

describe("for-of lowering", () => {

    // ── basic shape ──

    test("for-of over empty list leaves accumulator untouched", async () => {
        const uplc = await exportFunction(`
export function main( xs: List<int> ): int {
    let acc = 42;
    for( const x of xs ) {
        acc = acc + x;
    }
    return acc;
}
`, "main");
        applyAndExpectInt(uplc, intList([]), 42n);
    });

    test("for-of over single-element list runs body exactly once", async () => {
        const uplc = await exportFunction(`
export function main( xs: List<int> ): int {
    let count = 0;
    for( const _x of xs ) {
        count = count + 1;
    }
    return count;
}
`, "main");
        applyAndExpectInt(uplc, intList([7]), 1n);
    });

    test("for-of sums an int list", async () => {
        const uplc = await exportFunction(`
export function main( xs: List<int> ): int {
    let acc = 0;
    for( const x of xs ) {
        acc = acc + x;
    }
    return acc;
}
`, "main");
        applyAndExpectInt(uplc, intList([1, 2, 3, 4, 5]), 15n);
        applyAndExpectInt(uplc, intList(Array.from({length: 20}, (_, i) => i + 1)), 210n);
    });

    test("for-of body sees the bound element, not the partial list", async () => {
        const uplc = await exportFunction(`
export function main( xs: List<int> ): int {
    let product = 1;
    for( const x of xs ) {
        product = product * x;
    }
    return product;
}
`, "main");
        applyAndExpectInt(uplc, intList([2, 3, 5]), 30n);
    });

    // ── sequential + nested ──

    test("two sequential for-of loops over the same list", async () => {
        // The desugaring rebinds the iterable to a fresh partial-list
        // variable per loop, so the second loop must see the full list,
        // not the tail-exhausted remnant of the first.
        const uplc = await exportFunction(`
export function main( xs: List<int> ): int {
    let a = 0;
    for( const x of xs ) { a = a + x; }
    let b = 0;
    for( const y of xs ) { b = b + y; }
    return a + b;
}
`, "main");
        applyAndExpectInt(uplc, intList([1, 2, 3]), 12n);
    });

    test("nested for-of: outer × inner cross-product sum", async () => {
        const uplc = await exportFunction(`
export function main( xs: List<int> ): int {
    let total = 0;
    for( const x of xs ) {
        for( const y of xs ) {
            total = total + x * y;
        }
    }
    return total;
}
`, "main");
        // (1+2+3)^2 = 36
        applyAndExpectInt(uplc, intList([1, 2, 3]), 36n);
    });

    // ── mutation patterns ──

    test("for-of preserves accumulator updates across iterations", async () => {
        const uplc = await exportFunction(`
export function main( xs: List<int> ): int {
    let parity = 0;
    for( const x of xs ) {
        if( x > 0 ) {
            parity = 1 - parity;
        }
    }
    return parity;
}
`, "main");
        applyAndExpectInt(uplc, intList([1, 1, 1]), 1n);  // toggled 3 times: 0→1→0→1
        applyAndExpectInt(uplc, intList([1, 1, 1, 1]), 0n); // toggled 4 times: 0
        applyAndExpectInt(uplc, intList([0, 0, 0]), 0n);  // no toggle
    });

    test("for-of with conditional body update", async () => {
        const uplc = await exportFunction(`
export function main( xs: List<int> ): int {
    let positives = 0;
    for( const x of xs ) {
        if( x > 0 ) {
            positives = positives + 1;
        }
    }
    return positives;
}
`, "main");
        applyAndExpectInt(uplc, intList([-1, 2, -3, 4, 0, 5]), 3n);
    });

    // ── interaction with other constructs ──

    test("for-of inside a helper function called from main", async () => {
        const uplc = await exportFunction(`
function sumList( xs: List<int> ): int {
    let acc = 0;
    for( const x of xs ) { acc = acc + x; }
    return acc;
}
export function main( xs: List<int> ): int {
    return sumList( xs ) + sumList( xs );
}
`, "main");
        applyAndExpectInt(uplc, intList([10, 20, 30]), 120n);
    });

    test("for-of over a list returned by a function call", async () => {
        const uplc = await exportFunction(`
function take2( xs: List<int> ): List<int> {
    return std.list.filter<int>( x => x < 3, xs );
}
export function main( xs: List<int> ): int {
    let acc = 0;
    for( const x of take2( xs ) ) { acc = acc + x; }
    return acc;
}
`, "main");
        applyAndExpectInt(uplc, intList([1, 2, 3, 4, 5]), 3n);  // 1 + 2
    });

    // ── boolean result smoke test ──

    test("for-of can drive a boolean predicate", async () => {
        const uplc = await exportFunction(`
export function main( xs: List<int> ): boolean {
    let allPositive = true;
    for( const x of xs ) {
        if( x <= 0 ) { allPositive = false; }
    }
    return allPositive;
}
`, "main");
        applyAndExpectBool(uplc, intList([1, 2, 3]), true);
        applyAndExpectBool(uplc, intList([1, 0, 3]), false);
        applyAndExpectBool(uplc, intList([]), true);
    });

    test("inliner skips let-bindings whose single use is inside a recursive body", async () => {
        // `computed` is bound OUTSIDE the for-of and used ONCE INSIDE.
        // If the inliner blindly inlined on the syntactic count of 1,
        // the multiplication would run on every iteration instead of
        // once. We verify by comparing CPU spent against a baseline
        // where `computed` is genuinely inlined at the source level.
        const lettedSrc = `
export function main( xs: List<int>, base: int ): int {
    let computed = base * 100 + 5;
    let result = 0;
    for( const x of xs ) {
        result = result + x * computed;
    }
    return result;
}
`;
        const inlinedSrc = `
export function main( xs: List<int>, base: int ): int {
    let result = 0;
    for( const x of xs ) {
        result = result + x * (base * 100 + 5);
    }
    return result;
}
`;
        const lettedUplc = await exportFunction(lettedSrc, "main");
        const inlinedUplc = await exportFunction(inlinedSrc, "main");

        const xs20 = intList(Array.from({length: 20}, (_, i) => i + 1));
        const base = UPLCConst.int(3n);

        const lettedRes = Machine.eval(
            new Application(new Application(lettedUplc, xs20), base)
        );
        const inlinedRes = Machine.eval(
            new Application(new Application(inlinedUplc, xs20), base)
        );

        // Same numeric result.
        expect((lettedRes.result as CEKConst).value)
            .toBe((inlinedRes.result as CEKConst).value);

        // Letted version should be CHEAPER than inlined (computes the
        // base*100+5 expression once, not 20 times).
        expect(lettedRes.budgetSpent.cpu).toBeLessThan(inlinedRes.budgetSpent.cpu);
        expect(lettedRes.budgetSpent.mem).toBeLessThan(inlinedRes.budgetSpent.mem);
    });

    // ── inliner behaviour matrix ──

    test("inliner DOES inline a single-use let defined in the SAME (recursive) scope", async () => {
        // `temp` is bound inside the for-of body and used once in the
        // same iteration — same scope-frequency as its binding. Safe to
        // inline: each iteration evaluates `temp` exactly once whether
        // inlined or not. After our pipeline the letted form should
        // compile to the SAME UPLC as the explicitly-inlined source, so
        // the CEK budgets must match exactly.
        const lettedSrc = `
export function main( xs: List<int> ): int {
    let acc = 0;
    for( const x of xs ) {
        let temp = x + 1;
        acc = acc + temp;
    }
    return acc;
}
`;
        const inlinedSrc = `
export function main( xs: List<int> ): int {
    let acc = 0;
    for( const x of xs ) {
        acc = acc + ( x + 1 );
    }
    return acc;
}
`;
        const lettedUplc  = await exportFunction(lettedSrc, "main");
        const inlinedUplc = await exportFunction(inlinedSrc, "main");

        const xs20 = intList(Array.from({length: 20}, (_, i) => i + 1));

        const lettedRes  = Machine.eval(new Application(lettedUplc, xs20));
        const inlinedRes = Machine.eval(new Application(inlinedUplc, xs20));

        expect((lettedRes.result as CEKConst).value)
            .toBe((inlinedRes.result as CEKConst).value);
        // Exact equality: the inliner should have collapsed the letted
        // form into the inlined shape.
        expect(lettedRes.budgetSpent.cpu).toBe(inlinedRes.budgetSpent.cpu);
        expect(lettedRes.budgetSpent.mem).toBe(inlinedRes.budgetSpent.mem);
    });

    test("inliner does NOT inline a let from an outer recursive body into a NESTED recursive body", async () => {
        // `inner` is bound in the OUTER for-of body and used once in the
        // INNER for-of body. The inner loop runs n times per outer
        // iteration, so the single syntactic use of `inner` corresponds
        // to n*n evaluations if inlined. The letted form computes
        // `x * x` once per outer iteration (n times total), then reuses
        // it n times — strictly cheaper.
        const lettedSrc = `
export function main( xs: List<int> ): int {
    let result = 0;
    for( const x of xs ) {
        let inner = x * x + 7;
        for( const y of xs ) {
            result = result + y * inner;
        }
    }
    return result;
}
`;
        const inlinedSrc = `
export function main( xs: List<int> ): int {
    let result = 0;
    for( const x of xs ) {
        for( const y of xs ) {
            result = result + y * ( x * x + 7 );
        }
    }
    return result;
}
`;
        const lettedUplc  = await exportFunction(lettedSrc, "main");
        const inlinedUplc = await exportFunction(inlinedSrc, "main");

        const xs10 = intList(Array.from({length: 10}, (_, i) => i + 1));

        const lettedRes  = Machine.eval(new Application(lettedUplc, xs10));
        const inlinedRes = Machine.eval(new Application(inlinedUplc, xs10));

        expect((lettedRes.result as CEKConst).value)
            .toBe((inlinedRes.result as CEKConst).value);
        expect(lettedRes.budgetSpent.cpu).toBeLessThan(inlinedRes.budgetSpent.cpu);
        expect(lettedRes.budgetSpent.mem).toBeLessThan(inlinedRes.budgetSpent.mem);
    });

    test("vectorMul", async () => {
        const uplc = await exportFunction(`
export function vectorMul( xs: List<int>, let ys: List<int> ): int {
    let result = 0;
    for( const x of xs ) {
        result += x * ys.head();
        ys = ys.tail();
    }
    return result;
}
`, "vectorMul");
        console.log("UPLC for vectorMul:", prettyUPLC( uplc ));
        const result = Machine.eval(
            new Application(new Application(uplc, intList([1, 2, 3])), intList([4, 5, 6]))
        );
        expect(result.result instanceof CEKConst).toBe(true);
        expect((result.result as CEKConst).value).toBe(32n);
    });
});
