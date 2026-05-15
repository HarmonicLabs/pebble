import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { testOptions, COMPILER_VERSION } from "../../IR";
import { Compiler } from "../Compiler";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";

// Most narrowing-correctness scenarios are exercised in dedicated test files
// (compiler.isExpr.*.test.ts). This file covers parser/typechecker-level
// behavior that doesn't need to invoke the runtime.

describe("`is` operator basic", () => {

    test("error: `is` with unknown constructor name", async () => {
        const fileName = "test.pebble";
        const srcText = `
struct MultiConstr {
    First{ n: int }
    Second{ name: bytes }
}

function isThird( m: MultiConstr ): boolean {
    return m is Third;
}
`;
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([[fileName, fromUtf8(srcText)]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await compiler.check({ entry: fileName, root: "/" });
        expect(compiler.diagnostics.length).toBeGreaterThan(0);
        expect(
            compiler.diagnostics.some(d =>
                d.toString().toLowerCase().includes("third")
            )
        ).toBe(true);
    });

    test("error: field access on un-narrowed multi-constructor variable", async () => {
        const fileName = "test.pebble";
        const srcText = `
struct MultiConstr {
    First{ n: int }
    Second{ name: bytes }
}

function getN( m: MultiConstr ): int {
    return m.n;
}
`;
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([[fileName, fromUtf8(srcText)]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await compiler.check({ entry: fileName, root: "/" });
        expect(compiler.diagnostics.length).toBeGreaterThan(0);
    });

    test("type-checks: assert narrows allowing field access", async () => {
        const fileName = "test.pebble";
        const srcText = `
struct MultiConstr {
    First{ n: int }
    Second{ name: bytes }
}

function getN( m: MultiConstr ): int {
    assert m is First;
    return m.n;
}
`;
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([[fileName, fromUtf8(srcText)]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await compiler.check({ entry: fileName, root: "/" });
        expect(compiler.diagnostics.length).toBe(0);
    });

    test("type-checks: if/else narrows in both branches", async () => {
        const fileName = "test.pebble";
        const srcText = `
struct MultiConstr {
    First{ n: int }
    Second{ name: bytes }
}

function pick( m: MultiConstr ): bytes {
    if( m is First ) {
        return #;
    } else {
        return m.name;
    }
}
`;
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([[fileName, fromUtf8(srcText)]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await compiler.check({ entry: fileName, root: "/" });
        expect(compiler.diagnostics.length).toBe(0);
    });

    test("type-checks: ternary narrows in both branches", async () => {
        const fileName = "test.pebble";
        const srcText = `
struct MultiConstr {
    First{ n: int }
    Second{ k: int }
}

function pick( m: MultiConstr ): int {
    return m is First ? m.n : m.k;
}
`;
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([[fileName, fromUtf8(srcText)]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await compiler.check({ entry: fileName, root: "/" });
        expect(compiler.diagnostics.length).toBe(0);
    });

    test("type-checks: negation narrows", async () => {
        const fileName = "test.pebble";
        const srcText = `
struct MultiConstr {
    First{ n: int }
    Second{ k: int }
}

function getK( m: MultiConstr ): int {
    assert !(m is First);
    return m.k;
}
`;
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([[fileName, fromUtf8(srcText)]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await compiler.check({ entry: fileName, root: "/" });
        expect(compiler.diagnostics.length).toBe(0);
    });

    test("type-checks: && chain narrows multiple variables", async () => {
        const fileName = "test.pebble";
        const srcText = `
struct MultiConstr {
    First{ n: int }
    Second{ name: bytes }
}

function combine( a: MultiConstr, b: MultiConstr ): int {
    assert a is First && b is First;
    return a.n + b.n;
}
`;
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([[fileName, fromUtf8(srcText)]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await compiler.check({ entry: fileName, root: "/" });
        expect(compiler.diagnostics.length).toBe(0);
    });
});
