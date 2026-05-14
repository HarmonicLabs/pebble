import { defaultOptions, testOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { AstCompiler } from "../AstCompiler/AstCompiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

describe("namespaces", () => {

    test("namespace member accessed inline via dotted path", async () => {
        const src = `
namespace M {
    function add( a: int, b: int ): int { return a + b; }
}

function useAdd( a: int, b: int ): int {
    return M.add( a, b );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "useAdd", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics).toEqual([]);
    });

    test("using { ... } destructures namespace members", async () => {
        const src = `
namespace M {
    function add( a: int, b: int ): int { return a + b; }
}

function useAdd( a: int, b: int ): int {
    using { add } = M;
    return add( a, b );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "useAdd", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics).toEqual([]);
    });

    test("using <alias> = <ns> binds the namespace under a new name", async () => {
        const src = `
namespace M {
    function add( a: int, b: int ): int { return a + b; }
}

function useAdd( a: int, b: int ): int {
    using m = M;
    return m.add( a, b );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "useAdd", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics).toEqual([]);
    });

    test("nested namespaces work and are reachable via dotted path", async () => {
        const src = `
namespace Outer {
    namespace Inner {
        function id( x: int ): int { return x; }
    }
}

function useInner( x: int ): int {
    return Outer.Inner.id( x );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "useInner", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics).toEqual([]);
    });

    test("private members are not visible outside the namespace", async () => {
        const src = `
namespace M {
    private function secret( a: int ): int { return a; }
    function pub( a: int ): int { return secret( a ); }
}

function callPub( a: int ): int {
    return M.pub( a );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: true,
        });

        // private member used inside the namespace is fine; exported `pub` is reachable
        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "callPub", entry: "src/main.pebble", root: "/" });
        expect(compiler.diagnostics).toEqual([]);
    });

    test("accessing a private namespace member from outside is an error", async () => {
        const src = `
namespace M {
    private function secret( a: int ): int { return a; }
}

function callSecret( a: int ): int {
    return M.secret( a );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: true,
        });

        const astCompiler = new AstCompiler(
            { ...defaultOptions, entry: "src/main.pebble", root: "/" },
            ioApi
        );
        const result = await astCompiler.check();

        // expect a diagnostic referring to the missing member
        expect(result.diagnostics.length).toBeGreaterThan(0);
        expect(result.diagnostics.some(d => d.code === 30001)).toBe(true);
    });

    test("exported namespace is importable by name", async () => {
        const libSrc = `
export namespace M {
    function inc( n: int ): int { return n + 1; }
}`;

        const mainSrc = `
import { M } from "./lib";

function useInc( n: int ): int {
    return M.inc( n );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(mainSrc)],
                ["src/lib.pebble", fromUtf8(libSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "useInc", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics).toEqual([]);
    });

    test("`import * as` introduces a namespace over the file's exports", async () => {
        const libSrc = `
export function add( a: int, b: int ): int { return a + b; }
export function sub( a: int, b: int ): int { return a - b; }`;

        const mainSrc = `
import * as Lib from "./lib";

function combined( a: int, b: int ): int {
    return Lib.add( a, b ) + Lib.sub( a, b );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(mainSrc)],
                ["src/lib.pebble", fromUtf8(libSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "combined", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics).toEqual([]);
    });

    test("`import * as` namespace can be destructured by `using`", async () => {
        const libSrc = `
export function add( a: int, b: int ): int { return a + b; }`;

        const mainSrc = `
import * as Lib from "./lib";

function useAdd( a: int, b: int ): int {
    using { add } = Lib;
    return add( a, b );
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(mainSrc)],
                ["src/lib.pebble", fromUtf8(libSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);
        await compiler.export({ functionName: "useAdd", entry: "src/main.pebble", root: "/" });

        expect(compiler.diagnostics).toEqual([]);
    });
});
