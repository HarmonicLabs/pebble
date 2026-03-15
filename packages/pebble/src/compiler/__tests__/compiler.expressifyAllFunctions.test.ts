import { testOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

describe("all program functions are expressified before IR conversion", () => {

    /**
     * regression: only the main/exported function was expressified
     * in `compileTypedProgram`, so any other function referenced via
     * `TirHoistedExpr` threw "function must be expressified before
     * being converted to IR" during `toIR()`.
     *
     * these tests use same-file helper functions (no imports)
     * to isolate the expressification bug from import resolution.
     */

    test("exported function calls a same-file helper", async () => {

        const src = `
function helper( n: int ): int {
    return n + 1;
}

function main( n: int ): int {
    return helper( n );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["test.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "main", entry: "test.pebble", root: "/" });

        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });

    test("helper function with if/else body", async () => {

        const src = `
function abs( n: int ): int {
    if( n < 0 ) {
        return 0 - n;
    } else {
        return n;
    }
}

function useAbs( n: int ): int {
    return abs( n ) + abs( 0 - n );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["test.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "useAbs", entry: "test.pebble", root: "/" });

        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });

    test("recursive helper called from exported function", async () => {

        const src = `
function fib( n: int ): int {
    if( n <= 1 ) return n;
    return fib( n - 1 ) + fib( n - 2 );
}

function callFib( n: int ): int {
    return fib( n );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["test.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "callFib", entry: "test.pebble", root: "/" });

        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });

    test("chain of helper functions: A calls B, B calls C", async () => {

        const src = `
function addOne( n: int ): int {
    return n + 1;
}

function addTwo( n: int ): int {
    return addOne( addOne( n ) );
}

function addFour( n: int ): int {
    return addTwo( addTwo( n ) );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["test.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "addFour", entry: "test.pebble", root: "/" });

        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });

    test("multiple helpers called from the same exported function", async () => {

        const src = `
function double( n: int ): int {
    return n * 2;
}

function square( n: int ): int {
    return n * n;
}

function combine( n: int ): int {
    return double( n ) + square( n );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["test.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "combine", entry: "test.pebble", root: "/" });

        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });

    test("helper with multi-statement body (variable + return)", async () => {

        const src = `
function sumOfProducts( a: int, b: int, c: int, d: int ): int {
    const ab = a * b;
    const cd = c * d;
    return ab + cd;
}

function useSop( n: int ): int {
    return sumOfProducts( n, n + 1, n + 2, n + 3 );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["test.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "useSop", entry: "test.pebble", root: "/" });

        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });
});
