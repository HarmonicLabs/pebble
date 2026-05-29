import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, constT, parseUPLC, UPLCConst } from "@harmoniclabs/uplc";
import { Machine } from "@harmoniclabs/buildooor";

/**
 * Benchmark: accessing an element by index, `List<int>` vs `Array<int>`.
 *
 * Three strategies, each compiled from real pebble source:
 *
 *   1. LIST           — `xs[i]` on a `List<int>`. Walks the spine by repeated
 *                       `tailList` calls, then `headList` — cost is O(i).
 *
 *   2. ARRAY (pure)   — `std.array.at(arr, i)` on an already-built `Array<int>`.
 *                       Lowers to a single `indexArray` builtin — O(1).
 *                       We hand-build the `Array<int>` CEKConst at runtime so
 *                       the conversion cost is NOT charged to this row.
 *
 *   3. ARRAY (+conv)  — `std.array.at(std.array.fromList(xs), i)` on a list.
 *                       Pays `listToArray`'s O(n) conversion every call, then
 *                       O(1) access. The realistic "I only have a list" path.
 *
 * Two scenarios are reported:
 *
 *   A. Last-index access  (i = n - 1): worst case for LIST, fair conversion
 *      load on ARRAY (+conv).
 *
 *   B. First-index access (i = 0): best case for LIST (head() is cheap);
 *      shows where ARRAY (+conv) loses to LIST because the conversion
 *      overhead dwarfs the O(1) saving on a single read.
 *
 * Run with:
 *   npx jest bench.listVsArrayAccess --silent=false
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

function intArray(n: number): UPLCConst {
    // Direct UPLCConst with the `array` type tag — no conversion cost.
    // (`UPLCConst.arrayOf` doesn't exist as a static, but the constructor
    // accepts the array ConstType fine.)
    return new UPLCConst(
        ( constT as any ).arrayOf( constT.int ),
        Array.from({ length: n }, (_, i) => BigInt(i + 1)) as any,
    );
}

interface Row {
    n: number;
    i: number;
    listCpu: bigint;
    listMem: bigint;
    arrPureCpu: bigint;
    arrPureMem: bigint;
    arrFromListCpu: bigint;
    arrFromListMem: bigint;
    expected: number;
    listResult: any;
    arrPureResult: any;
    arrFromListResult: any;
}

function ratio(reference: bigint, candidate: bigint): string {
    if (reference === 0n) return candidate === 0n ? "  ==" : "n/a";
    const f = Number(candidate) / Number(reference);
    if (f < 1) return `${(1 / f).toFixed(2)}× cheaper`;
    return `${f.toFixed(2)}× more`;
}

function printTable(label: string, rows: Row[]): void {
    console.log(`\n=== ${label} ===`);
    console.log("(cpu = CEK CPU budget spent; lower is better)\n");

    const w = 4;
    const col = 12;
    const r = 14;

    console.log(
        "n".padStart(w) + " " +
        "i".padStart(3) + " | " +
        "LIST cpu".padStart(col) + "  " + "LIST mem".padStart(col) + " | " +
        "ARR cpu".padStart(col) + "  " + "ARR mem".padStart(col) + " | " +
        "ARR+conv cpu".padStart(col) + "  " + "ARR+conv mem".padStart(col) + " | " +
        "LIST vs ARR".padStart(r) + "  " + "LIST vs ARR+conv".padStart(r + 4)
    );
    console.log("-".repeat(w + 4 + (col + 2) * 6 + 4 + (r + 4 + 2) * 2));

    for (const row of rows) {
        console.log(
            String(row.n).padStart(w) + " " +
            String(row.i).padStart(3) + " | " +
            fmt(row.listCpu).padStart(col) + "  " + fmt(row.listMem).padStart(col) + " | " +
            fmt(row.arrPureCpu).padStart(col) + "  " + fmt(row.arrPureMem).padStart(col) + " | " +
            fmt(row.arrFromListCpu).padStart(col) + "  " + fmt(row.arrFromListMem).padStart(col) + " | " +
            ratio(row.listCpu, row.arrPureCpu).padStart(r) + "  " +
            ratio(row.listCpu, row.arrFromListCpu).padStart(r + 4)
        );
    }
    console.log("");
}

describe("indexed access: List<int> vs Array<int>", () => {

    test("benchmark suite", async () => {

        // ── Compile the three strategies ──────────────────────────────────

        const list = await compileExport(`
export function listAt( xs: List<int>, i: int ): int {
    return xs[i];
}
        `, "listAt");

        const arrPure = await compileExport(`
export function arrayAt( arr: Array<int>, i: int ): int {
    return std.array.at(arr, i);
}
        `, "arrayAt");

        const arrFromList = await compileExport(`
export function arrayAtFromList( xs: List<int>, i: int ): int {
    const arr: Array<int> = std.array.fromList(xs);
    return std.array.at(arr, i);
}
        `, "arrayAtFromList");

        console.log(
            `\nscript sizes — LIST: ${list.sizeBytes} B   ` +
            `ARR (pure): ${arrPure.sizeBytes} B   ` +
            `ARR (+conv): ${arrFromList.sizeBytes} B`
        );

        // ── Sweep ─────────────────────────────────────────────────────────
        const sizes = [1, 2, 4, 8, 16, 32, 64, 128, 256];

        function runOne(n: number, i: number): Row {
            const listArg = intList(n);
            const arrArg  = intArray(n);
            const idx     = UPLCConst.int( BigInt(i) );

            const listRes = Machine.eval(
                new Application( new Application( list.uplc, listArg ), idx )
            );
            const arrPureRes = Machine.eval(
                new Application( new Application( arrPure.uplc, arrArg ), idx )
            );
            const arrFromListRes = Machine.eval(
                new Application( new Application( arrFromList.uplc, listArg ), idx )
            );

            return {
                n, i,
                listCpu:        listRes.budgetSpent.cpu,
                listMem:        listRes.budgetSpent.mem,
                arrPureCpu:     arrPureRes.budgetSpent.cpu,
                arrPureMem:     arrPureRes.budgetSpent.mem,
                arrFromListCpu: arrFromListRes.budgetSpent.cpu,
                arrFromListMem: arrFromListRes.budgetSpent.mem,
                expected:           i + 1,
                listResult:         ( listRes.result as any ).value,
                arrPureResult:      ( arrPureRes.result as any ).value,
                arrFromListResult:  ( arrFromListRes.result as any ).value,
            };
        }

        // Scenario A: last-index access (worst case for LIST)
        const rowsLast: Row[] = sizes.map( n => runOne( n, n - 1 ) );
        printTable("Scenario A — last-index access  (i = n - 1, worst case for LIST)", rowsLast);

        // Scenario B: first-index access (best case for LIST)
        const rowsFirst: Row[] = sizes.map( n => runOne( n, 0 ) );
        printTable("Scenario B — first-index access (i = 0, best case for LIST)", rowsFirst);

        // ── Sanity ────────────────────────────────────────────────────────
        for (const row of [ ...rowsLast, ...rowsFirst ]) {
            expect( String( row.listResult ) ).toBe( String( row.expected ) );
            expect( String( row.arrPureResult ) ).toBe( String( row.expected ) );
            expect( String( row.arrFromListResult ) ).toBe( String( row.expected ) );
        }
    }, 120_000);
});
