import { defaultOptions, testOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { AstCompiler } from "../AstCompiler/AstCompiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

describe("imported functions are usable as values", () => {

    /**
     * regression 1: imported functions were only added to scope.functions
     * but not to scope.variables, so `resolveValue()` could not find them
     * and reported "'X' is not defined" (error 256)
     *
     * regression 2: only the main function was expressified before IR conversion,
     * so imported functions inside TirHoistedExpr threw
     * "function must be expressified before being converted to IR"
     */

    test("import recursive function and call it", async () => {

        const fibSrc = `
export function fib( n: int ): int {
    if( n <= 1 ) return n;
    return fib( n - 1 ) + fib( n - 2 );
}`;

        const mainSrc = `
import { fib } from "./fib";

function useFib( n: int ): int {
    return fib( n );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(mainSrc)],
                ["src/fib.pebble", fromUtf8(fibSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "useFib", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });

    test("import function and use it in arithmetic expression", async () => {

        const doubleSrc = `
export function double( n: int ): int {
    return n * 2;
}`;

        const mainSrc = `
import { double } from "./double";

function tripleViaDouble( n: int ): int {
    return double( n ) + n;
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(mainSrc)],
                ["src/double.pebble", fromUtf8(doubleSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "tripleViaDouble", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });

    test("import multiple functions from the same module", async () => {

        const mathSrc = `
export function add( a: int, b: int ): int {
    return a + b;
}

export function mul( a: int, b: int ): int {
    return a * b;
}`;

        const mainSrc = `
import { add, mul } from "./math";

function combined( a: int, b: int ): int {
    return add( a, b ) + mul( a, b );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(mainSrc)],
                ["src/math.pebble", fromUtf8(mathSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "combined", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });

    test("import functions from multiple modules", async () => {

        const incSrc = `
export function inc( n: int ): int {
    return n + 1;
}`;

        const decSrc = `
export function dec( n: int ): int {
    return n - 1;
}`;

        const mainSrc = `
import { inc } from "./inc";
import { dec } from "./dec";

function identity( n: int ): int {
    return dec( inc( n ) );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(mainSrc)],
                ["src/inc.pebble", fromUtf8(incSrc)],
                ["src/dec.pebble", fromUtf8(decSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "identity", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });

    test("imported function called multiple times", async () => {

        const helperSrc = `
export function square( n: int ): int {
    return n * n;
}`;

        const mainSrc = `
import { square } from "./helper";

function useSquare( n: int ): int {
    return square( n ) + square( n + 1 );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(mainSrc)],
                ["src/helper.pebble", fromUtf8(helperSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "useSquare", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });

    test("transitive import: A imports from B, B imports from C", async () => {

        const baseSrc = `
export function base( n: int ): int {
    return n + 1;
}`;

        const middleSrc = `
import { base } from "./base";

export function middle( n: int ): int {
    return base( base( n ) );
}`;

        const mainSrc = `
import { middle } from "./middle";

function top( n: int ): int {
    return middle( n );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(mainSrc)],
                ["src/middle.pebble", fromUtf8(middleSrc)],
                ["src/base.pebble", fromUtf8(baseSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "top", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });

    test("imported function used alongside imported type (check)", async () => {

        const dataSrc = `
export data struct MyData {
    value: int;
}`;

        const utilSrc = `
export function addOne( n: int ): int {
    return n + 1;
}`;

        const mainSrc = `
import { MyData } from "./data";
import { addOne } from "./util";

function process( d: MyData ): int {
    return addOne( d.value );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(mainSrc)],
                ["src/data.pebble", fromUtf8(dataSrc)],
                ["src/util.pebble", fromUtf8(utilSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const astCompiler = new AstCompiler(
            { ...defaultOptions, entry: "src/main.pebble", root: "/" },
            ioApi
        );
        const result = await astCompiler.check();

        expect(result.diagnostics.length).toBe(0);
    });
});
