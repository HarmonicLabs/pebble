import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// Narrowing-by-construct tests.
//
// Pebble's IR pipeline currently has cross-test state contamination (a separate
// pre-existing issue surfaced by `is`-narrowing patterns), so each test loads a
// fresh module registry via `jest.isolateModulesAsync` and runs its compilation
// in that isolated registry. Without this, separate `compiler.run()` calls
// within the same file produce nondeterministic UPLC.

async function runIsolated(srcText: string): Promise<{ logs: string[]; diagnosticsLength: number }> {
    let result: any;
    let diagnosticsLength = 0;
    await jest.isolateModulesAsync(async () => {
        const { Compiler } = require("../Compiler");
        const { createMemoryCompilerIoApi } = require("../io/CompilerIoApi");
        const { testOptions, COMPILER_VERSION } = require("../../IR");
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([["test.pebble", fromUtf8(srcText)]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
        result = await compiler.run({ entry: "test.pebble", root: "/" });
        diagnosticsLength = compiler.diagnostics.length;
    });
    return { logs: result.logs, diagnosticsLength };
}

describe("`is`-narrowing per construct", () => {

    test("assert narrows the variable in the rest of the scope", async () => {
        const { logs, diagnosticsLength } = await runIsolated(`
struct M {
    First{ n: int }
    Second{ k: int }
}

function getN( m: M ): int {
    assert m is First;
    return m.n;
}

function getK( m: M ): int {
    assert m is Second;
    return m.k;
}

trace getN( M.First{ n: 42 } );
trace getK( M.Second{ k: 99 } );
`);
        expect(diagnosticsLength).toBe(0);
        expect(logs).toEqual(["42", "99"]);
    });

    test("if narrows in the then-branch and the else-branch", async () => {
        const { logs, diagnosticsLength } = await runIsolated(`
struct M {
    First{ n: int }
    Second{ k: int }
}

function pick( m: M ): int {
    if( m is First ) {
        return m.n;
    } else {
        return m.k;
    }
}

trace pick( M.First{ n: 7 } );
trace pick( M.Second{ k: 13 } );
`);
        expect(diagnosticsLength).toBe(0);
        expect(logs).toEqual(["7", "13"]);
    });

    test("match arm narrows the matched variable inside each arm body", async () => {
        const { logs, diagnosticsLength } = await runIsolated(`
struct M {
    First{ n: int }
    Second{ k: int }
}

function pick( m: M ): int {
    match( m ) {
        when First{ n: _ }: { return m.n; }
        when Second{ k: _ }: { return m.k; }
    }
    return 0;
}

trace pick( M.First{ n: 11 } );
trace pick( M.Second{ k: 22 } );
`);
        expect(diagnosticsLength).toBe(0);
        expect(logs).toEqual(["11", "22"]);
    });

    test("case expression narrows the matched variable inside each branch", async () => {
        const { logs, diagnosticsLength } = await runIsolated(`
struct M {
    First{ n: int }
    Second{ k: int }
}

function pick( m: M ): int {
    return case m
        is First{ n }  => m.n
        is Second{ k } => m.k
        ;
}

trace pick( M.First{ n: 19 } );
trace pick( M.Second{ k: 23 } );
`);
        expect(diagnosticsLength).toBe(0);
        expect(logs).toEqual(["19", "23"]);
    });

    test("ternary narrows the variable in both branches", async () => {
        const { logs, diagnosticsLength } = await runIsolated(`
struct M {
    First{ n: int }
    Second{ k: int }
}

function pick( m: M ): int {
    return m is First ? m.n : m.k;
}

trace pick( M.First{ n: 31 } );
trace pick( M.Second{ k: 37 } );
`);
        expect(diagnosticsLength).toBe(0);
        expect(logs).toEqual(["31", "37"]);
    });
});
