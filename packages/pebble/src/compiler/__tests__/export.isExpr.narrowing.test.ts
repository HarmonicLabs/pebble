import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst } from "@harmoniclabs/uplc";
import { CEKConst, DataConstr, DataI, Machine } from "@harmoniclabs/buildooor";

// Per-construct narrowing tests against EXPORTED UPLC: each test compiles a
// pebble source, exports a function, and evaluates the resulting UPLC against
// concrete `Constr`-encoded inputs.
//
// Each test runs in an isolated module registry (`jest.isolateModulesAsync`)
// to sidestep a pre-existing nondeterminism in pebble's IR caching layer that
// surfaces across consecutive `compiler.export()` calls in the same Jest file.

async function exportFunction(srcText: string, functionName: string): Promise<UPLCConst | any> {
    let uplc: any;
    let diagnosticsLength = 0;
    await jest.isolateModulesAsync(async () => {
        const { Compiler } = require("../Compiler");
        const { createMemoryCompilerIoApi } = require("../io/CompilerIoApi");
        const { testOptions } = require("../../IR");

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([["test.pebble", fromUtf8(srcText)]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler(ioApi, testOptions);

        await compiler.export({ functionName, entry: "test.pebble", root: "/" });
        diagnosticsLength = compiler.diagnostics.length;

        const outputBytes = ioApi.outputs.get("out/out.flat") as Uint8Array;
        if (!outputBytes) throw new Error("export produced no output bytes");
        uplc = parseUPLC(outputBytes).body;
    });
    if (diagnosticsLength !== 0) throw new Error(`compilation produced ${diagnosticsLength} diagnostics`);
    return uplc;
}

function applyAndExpectInt(uplc: any, arg: UPLCConst, expected: bigint): void {
    const result = Machine.eval(new Application(uplc, arg));
    expect(result.result instanceof CEKConst).toBe(true);
    expect((result.result as CEKConst).value).toBe(expected);
}

const STRUCT_DECL = `
struct M {
    First{ n: int }
    Second{ k: int }
}
`;

const firstArg = (n: bigint) =>
    UPLCConst.data(new DataConstr(0, [new DataI(n)]));
const secondArg = (k: bigint) =>
    UPLCConst.data(new DataConstr(1, [new DataI(k)]));

describe("`is`-narrowing in exported UPLC", () => {

    test("assert: narrowed field access compiles & runs", async () => {
        const uplc = await exportFunction(STRUCT_DECL + `
function getN( m: M ): int {
    assert m is First;
    return m.n;
}
`, "getN");

        applyAndExpectInt(uplc, firstArg(7n), 7n);
        applyAndExpectInt(uplc, firstArg(42n), 42n);

        // wrong constructor must trigger the assert (UPLC error)
        const failResult = Machine.eval(new Application(uplc, secondArg(99n)));
        expect(failResult.result instanceof CEKConst).toBe(false);
    });

    test("if/else: both branches narrow & evaluate correctly", async () => {
        const uplc = await exportFunction(STRUCT_DECL + `
function pick( m: M ): int {
    if( m is First ) {
        return m.n;
    } else {
        return m.k;
    }
}
`, "pick");

        applyAndExpectInt(uplc, firstArg(7n), 7n);
        applyAndExpectInt(uplc, secondArg(13n), 13n);
        applyAndExpectInt(uplc, firstArg(0n), 0n);
        applyAndExpectInt(uplc, secondArg(-1n), -1n);
    });

    test("match: arm bodies see the narrowed matched variable", async () => {
        const uplc = await exportFunction(STRUCT_DECL + `
function pick( m: M ): int {
    match( m ) {
        when First{ n: _ }: { return m.n; }
        when Second{ k: _ }: { return m.k; }
    }
    return 0;
}
`, "pick");

        applyAndExpectInt(uplc, firstArg(11n), 11n);
        applyAndExpectInt(uplc, secondArg(22n), 22n);
    });

    test("case expression: arm bodies see the narrowed matched variable", async () => {
        const uplc = await exportFunction(STRUCT_DECL + `
function pick( m: M ): int {
    return case m
        is First{ n }  => m.n
        is Second{ k } => m.k
        ;
}
`, "pick");

        applyAndExpectInt(uplc, firstArg(19n), 19n);
        applyAndExpectInt(uplc, secondArg(23n), 23n);
    });

    test("ternary: both branches narrow & evaluate correctly", async () => {
        const uplc = await exportFunction(STRUCT_DECL + `
function pick( m: M ): int {
    return m is First ? m.n : m.k;
}
`, "pick");

        applyAndExpectInt(uplc, firstArg(31n), 31n);
        applyAndExpectInt(uplc, secondArg(37n), 37n);
        applyAndExpectInt(uplc, firstArg(100n), 100n);
        applyAndExpectInt(uplc, secondArg(-1n), -1n);
    });
});
