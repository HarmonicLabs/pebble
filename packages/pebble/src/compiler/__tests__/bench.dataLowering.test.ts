import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst } from "@harmoniclabs/uplc";
import { DataConstr, DataI, Machine } from "@harmoniclabs/buildooor";

/**
 * Benchmark script — reports UPLC byte-size and CEK budget consumed for
 * representative programs that exercise the `unConstrData`-based lowerings
 * we recently refactored:
 *
 *   - `case`/`match` over a data struct (TirCaseExpr._dataStructToIR)
 *   - `Optional<T>` from-Data conversion (TirSopOptT branch)
 *   - single-ctor SoP struct from-Data (_inilneSingeSopConstrFromData)
 *   - multi-ctor SoP struct from-Data (_inlineMultiSopConstrFromData)
 *   - bool from-Data (_boolFromData hoisted helper)
 *
 * Numbers are printed to console — to A/B compare against an earlier
 * state, `git stash` the relevant files and rerun.
 *
 * Run with:
 *   npx jest bench.dataLowering.test.ts --silent=false
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

interface Sample {
    label: string;
    uplcSize: number;
    cpuSpent: bigint;
    memSpent: bigint;
    result: any;
}

function evalAndReport(label: string, uplc: any, sizeBytes: number, arg: UPLCConst): Sample {
    const r = Machine.eval(new Application(uplc, arg));
    return {
        label,
        uplcSize: sizeBytes,
        cpuSpent: r.budgetSpent.cpu,
        memSpent: r.budgetSpent.mem,
        result: (r.result as any).value,
    };
}

function printTable(samples: Sample[]): void {
    const widthLabel = Math.max(...samples.map(s => s.label.length), 20);
    const header = [
        "scenario".padEnd(widthLabel),
        "size(B)".padStart(8),
        "cpu".padStart(14),
        "mem".padStart(10),
        "result".padStart(8),
    ].join("  ");
    /*
    console.log("\n" + header);
    console.log("-".repeat(header.length));
    for (const s of samples) {
        /*
        console.log([
            s.label.padEnd(widthLabel),
            fmt(s.uplcSize).padStart(8),
            fmt(s.cpuSpent).padStart(14),
            fmt(s.memSpent).padStart(10),
            String(s.result).slice(0, 8).padStart(8),
        ].join("  "));
    }
    console.log("");
    //*/
}

describe("data lowering benchmarks (informational, not assertions)", () => {

    test("benchmark suite", async () => {
        const samples: Sample[] = [];

        // ── 1. case over a 3-ctor data struct (TirCaseExpr._dataStructToIR) ──
        {
            const { uplc, sizeBytes } = await compileExport(`
data struct Tri {
    A{ a: int }
    B{ b: int }
    C{ c: int }
}

export function pick( t: Tri ): int {
    return case t
        is A{ a } => a + 100
        is B{ b } => b + 200
        is C{ c } => c + 300
        ;
}
`, "pick");
            samples.push(evalAndReport("case 3-ctor (A)", uplc, sizeBytes, UPLCConst.data(new DataConstr(0, [new DataI(1n)]))));
            samples.push(evalAndReport("case 3-ctor (B)", uplc, sizeBytes, UPLCConst.data(new DataConstr(1, [new DataI(2n)]))));
            samples.push(evalAndReport("case 3-ctor (C)", uplc, sizeBytes, UPLCConst.data(new DataConstr(2, [new DataI(3n)]))));
        }

        // ── 2. case with mostly-unused bound fields ──
        {
            const { uplc, sizeBytes } = await compileExport(`
data struct M {
    X{ a: int, b: int, c: int, d: int }
}

export function justA( m: M ): int {
    return case m
        is X{ a, b, c, d } => a
        ;
}
`, "justA");
            samples.push(evalAndReport("case bind-4-use-1", uplc, sizeBytes, UPLCConst.data(new DataConstr(0, [
                new DataI(10n), new DataI(20n), new DataI(30n), new DataI(40n)
            ]))));
        }

        // ── 3. nested case (outer + inner exercise the new lowering twice) ──
        {
            const { uplc, sizeBytes } = await compileExport(`
data struct Inner { L{ x: int } R{ y: int } }
data struct Outer { Wrap{ i: Inner, k: int } }

export function score( o: Outer ): int {
    return case o
        is Wrap{ i, k } => (
            case i
                is L{ x } => x * k
                is R{ y } => 0 - (y * k)
                ;
        )
        ;
}
`, "score");
            samples.push(evalAndReport("nested case (L)", uplc, sizeBytes,
                UPLCConst.data(new DataConstr(0, [new DataConstr(0, [new DataI(5n)]), new DataI(3n)]))));
            samples.push(evalAndReport("nested case (R)", uplc, sizeBytes,
                UPLCConst.data(new DataConstr(0, [new DataConstr(1, [new DataI(5n)]), new DataI(3n)]))));
        }

        // ── 4. case with wildcard ──
        {
            const { uplc, sizeBytes } = await compileExport(`
data struct Color {
    Red{}
    Green{}
    Blue{}
    Other{}
}

export function rank( c: Color ): int {
    return case c
        is Red{}   => 1
        is Green{} => 2
        else       0
        ;
}
`, "rank");
            samples.push(evalAndReport("case zero-field+wild (Red)",   uplc, sizeBytes, UPLCConst.data(new DataConstr(0, []))));
            samples.push(evalAndReport("case zero-field+wild (Green)", uplc, sizeBytes, UPLCConst.data(new DataConstr(1, []))));
            samples.push(evalAndReport("case zero-field+wild (Blue)",  uplc, sizeBytes, UPLCConst.data(new DataConstr(2, []))));
            samples.push(evalAndReport("case zero-field+wild (Other)", uplc, sizeBytes, UPLCConst.data(new DataConstr(3, []))));
        }

        printTable(samples);
    });
});
