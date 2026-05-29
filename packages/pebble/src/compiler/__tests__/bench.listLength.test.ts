import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, constT, parseUPLC, UPLCConst } from "@harmoniclabs/uplc";
import { Machine } from "@harmoniclabs/buildooor";

/**
 * Benchmark: computing the length of a `List<int>`.
 *
 * Two strategies compared:
 *
 *   1. NATIVE  — `xs.length()` (== `std.list.length(xs)`). Lowers to the
 *      hoisted recursive helper `IRNative._length`, which walks the list
 *      spine with `case L of [cons → 1 + self(tail L); nil → 0]`.
 *
 *   2. ARRAY   — `std.array.length(std.array.fromList(xs))`. Lowers to two
 *      UPLC builtins applied in sequence: `lengthOfArray (listToArray xs)`.
 *
 * Both strategies are compiled from real pebble source through the production
 * pipeline.
 *
 * For each list size `n` we apply both compiled UPLC terms to the same
 * `UPLCConst.listOf(int)` of length `n` and report:
 *   - script size in bytes (constant per strategy)
 *   - CEK CPU budget spent
 *   - CEK memory budget spent
 *   - the computed length (sanity check)
 *
 * Run with:
 *   npx jest bench.listLength --silent=false
 */

async function compileExport(srcText: string, functionName: string): Promise<{
    uplc: any,
    sizeBytes: number,
}> {
    let uplc: any;
    let sizeBytes = 0;
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
        if (compiler.diagnostics.some((d: any) => d.category === 1)) {
            throw new Error(`compilation produced errors:\n${compiler.diagnostics.map((d: any) => d.toString()).join("\n")}`);
        }

        const outputBytes = ioApi.outputs.get("out/out.flat") as Uint8Array;
        sizeBytes = outputBytes.length;
        uplc = parseUPLC(outputBytes).body;
    });
    return { uplc, sizeBytes };
}

function fmt(n: bigint | number): string {
    return n.toLocaleString("en-US");
}

function intList(n: number): UPLCConst {
    return UPLCConst.listOf(constT.int)(
        Array.from({ length: n }, (_, i) => BigInt(i + 1))
    );
}

interface Row {
    n: number;
    nativeCpu: bigint;
    nativeMem: bigint;
    arrayCpu: bigint;
    arrayMem: bigint;
    nativeResult: any;
    arrayResult: any;
}

function deltaPct(reference: bigint, candidate: bigint): string {
    if (reference === 0n) return candidate === 0n ? "  ==" : `+${fmt(candidate)}`;
    const num = Number(candidate - reference);
    const ref = Number(reference);
    const pct = (num / ref) * 100;
    const sign = num === 0 ? " " : num > 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}%`;
}

function printTable(rows: Row[], nativeSize: number, arraySize: number): void {
    console.log(`\nscript size — NATIVE: ${nativeSize} B   ARRAY: ${arraySize} B`);
    console.log("\nlength benchmark (CEK budget spent — lower is better)");
    console.log("Δ columns: array vs native, negative means array is cheaper\n");

    const w = 4;
    const col = 14;
    const dcol = 9;

    console.log(
        "n".padStart(w) +
        " | " + "NATIVE cpu".padStart(col) +
        "  " + "NATIVE mem".padStart(col) +
        " | " + "ARRAY cpu".padStart(col) +
        "  " + "ARRAY mem".padStart(col) +
        " | " + "Δ cpu".padStart(dcol) +
        "  " + "Δ mem".padStart(dcol)
    );
    console.log("-".repeat(w + 3 + (col + 2) * 4 + 3 + (dcol + 2) * 2));

    for (const r of rows) {
        console.log(
            String(r.n).padStart(w) +
            " | " + fmt(r.nativeCpu).padStart(col) +
            "  " + fmt(r.nativeMem).padStart(col) +
            " | " + fmt(r.arrayCpu).padStart(col) +
            "  " + fmt(r.arrayMem).padStart(col) +
            " | " + deltaPct(r.nativeCpu, r.arrayCpu).padStart(dcol) +
            "  " + deltaPct(r.nativeMem, r.arrayMem).padStart(dcol)
        );
    }
    console.log("");
}

describe("list length: native (_length) vs array (lengthOfArray ∘ listToArray)", () => {

    test("benchmark suite", async () => {

        const native = await compileExport(`
export function lengthViaNative( xs: List<int> ): int {
    return xs.length();
}
        `, "lengthViaNative");

        const array = await compileExport(`
export function lengthViaArray( xs: List<int> ): int {
    return std.array.length(std.array.fromList(xs));
}
        `, "lengthViaArray");

        const sizes = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256];

        const rows: Row[] = [];
        for (const n of sizes) {
            const arg = intList(n);

            const nativeRes = Machine.eval(new Application(native.uplc, arg));
            const arrayRes  = Machine.eval(new Application(array.uplc,  arg));

            rows.push({
                n,
                nativeCpu: nativeRes.budgetSpent.cpu,
                nativeMem: nativeRes.budgetSpent.mem,
                arrayCpu:  arrayRes.budgetSpent.cpu,
                arrayMem:  arrayRes.budgetSpent.mem,
                nativeResult: (nativeRes.result as any).value,
                arrayResult:  (arrayRes.result  as any).value,
            });
        }

        printTable(rows, native.sizeBytes, array.sizeBytes);

        for (const r of rows) {
            expect(String(r.nativeResult)).toBe(String(r.n));
            expect(String(r.arrayResult)).toBe(String(r.n));
        }
    }, 60_000);
});
