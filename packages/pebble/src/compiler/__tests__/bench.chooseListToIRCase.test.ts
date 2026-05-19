import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, constT } from "@harmoniclabs/uplc";
import { Machine } from "@harmoniclabs/buildooor";

/**
 * Benchmark: chooseList → IRCase migration.
 *
 * Reports compiled UPLC size and (where applicable) CEK CPU/mem budget
 * for a handful of list-heavy programs. To A/B against a baseline,
 * revert the chooseList → IRCase changes, rerun, and diff the outputs.
 *
 * Run with:
 *   npx jest bench.chooseListToIRCase.test.ts --silent=false
 */

async function compileExport(
    srcText: string,
    functionName: string,
): Promise<{ uplc: any; sizeBytes: number }> {
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
        const diagnostics: any[] = (compiler as any).diagnostics;
        if (diagnostics.some((d: any) => d.category === 1)) {
            throw new Error(
                "compilation produced errors:\n" +
                diagnostics.map((d: any) => d.toString()).join("\n")
            );
        }
        const outputBytes = ioApi.outputs.get("out/out.flat") as Uint8Array;
        sizeBytes = outputBytes.length;
        uplc = parseUPLC(outputBytes).body;
    });
    return { uplc, sizeBytes };
}

async function compileContract(srcText: string): Promise<number> {
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

        await compiler.compile({ entry: "test.pebble", root: "/" });
        const diagnostics: any[] = (compiler as any).diagnostics;
        if (diagnostics.some((d: any) => d.category === 1)) {
            throw new Error(
                "compilation produced errors:\n" +
                diagnostics.map((d: any) => d.toString()).join("\n")
            );
        }
        const outputBytes = ioApi.outputs.get("out/out.flat") as Uint8Array;
        sizeBytes = outputBytes.length;
    });
    return sizeBytes;
}

interface Row {
    label: string;
    bytes: number;
    cpu?: bigint;
    mem?: bigint;
    result?: string;
}

function fmt(n: number | bigint): string {
    return n.toLocaleString("en-US");
}

function printTable(rows: Row[]): void {
    const w = Math.max(...rows.map(r => r.label.length), 30);
    const header =
        "scenario".padEnd(w) + "  " +
        "size(B)".padStart(8) + "  " +
        "cpu".padStart(14) + "  " +
        "mem".padStart(10) + "  " +
        "result".padStart(10);
    console.log("\n" + header);
    console.log("-".repeat(header.length));
    for (const r of rows) {
        console.log(
            r.label.padEnd(w) + "  " +
            fmt(r.bytes).padStart(8) + "  " +
            (r.cpu !== undefined ? fmt(r.cpu).padStart(14) : "—".padStart(14)) + "  " +
            (r.mem !== undefined ? fmt(r.mem).padStart(10) : "—".padStart(10)) + "  " +
            (r.result ?? "—").padStart(10)
        );
    }
    console.log("");
}

function intList(n: number): UPLCConst {
    return UPLCConst.listOf(constT.int)(
        Array.from({ length: n }, (_, i) => BigInt(i + 1))
    );
}

function evalAndRow(label: string, uplc: any, sizeBytes: number, arg: UPLCConst): Row {
    const r = Machine.eval(new Application(uplc, arg));
    const val = (r.result as any).value ?? (r.result as any);
    return {
        label,
        bytes: sizeBytes,
        cpu: r.budgetSpent.cpu,
        mem: r.budgetSpent.mem,
        result: String(typeof val === "bigint" ? val : "ok").slice(0, 10),
    };
}

describe("chooseList → IRCase benchmarks", () => {

    test("benchmark suite", async () => {
        const rows: Row[] = [];
        const xs20 = intList(20);

        // ── pure functions: size + CEK budget ──

        {
            const { uplc, sizeBytes } = await compileExport(`
function len( xs: List<int> ): int {
    return std.list.length<int>( xs );
}
export function main( xs: List<int> ): int { return len( xs ); }
`, "main");
            rows.push(evalAndRow("std.list.length (n=20)", uplc, sizeBytes, xs20));
        }

        {
            const { uplc, sizeBytes } = await compileExport(`
export function main( xs: List<int> ): int {
    return std.list.foldl<int,int>( std.int.add, 0, xs );
}
`, "main");
            rows.push(evalAndRow("std.list.foldl sum (n=20)", uplc, sizeBytes, xs20));
        }

        {
            const { uplc, sizeBytes } = await compileExport(`
export function main( xs: List<int> ): int {
    let acc = 0;
    for( const x of xs ) {
        acc = acc + x;
    }
    return acc;
}
`, "main");
            rows.push(evalAndRow("for-of sum (n=20)", uplc, sizeBytes, xs20));
        }

        {
            const { uplc, sizeBytes } = await compileExport(`
export function main( xs: List<int> ): int {
    return std.list.foldr<int,int>( std.int.add, 0, xs );
}
`, "main");
            rows.push(evalAndRow("std.list.foldr sum (n=20)", uplc, sizeBytes, xs20));
        }

        {
            const { uplc, sizeBytes } = await compileExport(`
export function main( xs: List<int> ): int {
    const r = std.list.find<int>( x => x > 15, xs );
    return case r
        is Some{ value } => value
        is None{}        => -1
        ;
}
`, "main");
            rows.push(evalAndRow("std.list.find>15 (n=20)", uplc, sizeBytes, xs20));
        }

        {
            const { uplc, sizeBytes } = await compileExport(`
export function main( xs: List<int> ): int {
    return std.list.foldl<int,int>( std.int.add, 0, std.list.filter<int>( x => x > 10, xs ) );
}
`, "main");
            rows.push(evalAndRow("filter>10 then sum (n=20)", uplc, sizeBytes, xs20));
        }

        // ── contracts: size only (no easy ScriptContext fixture) ──

        rows.push({
            label: "head of int list (size-only)",
            bytes: await compileContract(`
contract HeadOfList {
    spend f() {
        const { tx } = context;
        assert tx.outputs.head().value.lovelaces() > 0;
    }
}
`),
        });

        rows.push({
            label: "find input by ref (size-only)",
            bytes: await compileContract(`
contract FindInput {
    spend f() {
        const { tx, spendingRef } = context;
        const inp = tx.inputs.find( i => i.ref == spendingRef )!.resolved;
        assert inp.value.lovelaces() > 0;
    }
}
`),
        });

        rows.push({
            label: "requiredSigners.includes (size-only)",
            bytes: await compileContract(`
const signer = #aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;
contract IncludesCheck {
    spend f() {
        const { tx } = context;
        assert tx.requiredSigners.includes( signer );
    }
}
`),
        });

        rows.push({
            label: "escrow contract (size-only)",
            bytes: await compileContract(`
const payAmount = 75_000_000;
const buyer  = #aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;
const seller = #bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;
const deadline = 1_800_000;
data struct EscrowDatum { state: int, depositTime: int, }
contract EscrowBench {
    spend deposit() {
        const { tx, spendingRef } = context;
        const spendingInput = tx.inputs.find( i => i.ref == spendingRef )!.resolved;
        const ownHash = spendingInput.address.payment.hash();
        const fstOut = tx.outputs.head();
        const InlineDatum{ datum: { state, depositTime } as EscrowDatum } = fstOut.datum;
        assert state == 0;
        assert tx.requiredSigners.includes( buyer );
        assert fstOut.address.payment.hash() == ownHash;
        assert fstOut.value.lovelaces() == payAmount;
        const Finite{ n: currentTime } = tx.validityInterval.from.boundary;
        assert depositTime == currentTime;
    }
    spend accept() {
        const { tx, spendingRef } = context;
        const spendingInput = tx.inputs.find( i => i.ref == spendingRef )!.resolved;
        const InlineDatum{ datum: { state } as EscrowDatum } = spendingInput.datum;
        const sellerOut = tx.outputs.head();
        assert state == 0;
        assert tx.requiredSigners.includes( seller );
        assert sellerOut.address.payment.hash() == seller;
        assert sellerOut.value.lovelaces() >= payAmount;
    }
    spend refund() {
        const { tx, spendingRef } = context;
        const spendingInput = tx.inputs.find( i => i.ref == spendingRef )!.resolved;
        const InlineDatum{ datum: { state, depositTime } as EscrowDatum } = spendingInput.datum;
        const buyerOut = tx.outputs.head();
        const Finite{ n: currentTime } = tx.validityInterval.from.boundary;
        assert currentTime >= depositTime + deadline;
        assert state == 0;
        assert tx.requiredSigners.includes( buyer );
        assert buyerOut.address.payment.hash() == buyer;
        assert buyerOut.value.lovelaces() >= payAmount;
    }
}
`),
        });

        printTable(rows);
    }, 60_000);
});
