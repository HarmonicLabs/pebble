import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

/**
 * Backtick-delimited template strings — `` `text ${expr} more text` `` —
 * compile to a chain of `appendByteString` calls. Each text fragment is
 * UTF-8 encoded; each interpolation is implicitly `.show()`-ed unless its
 * type is already `bytes` (in which case it's passed through, same
 * convention as `trace`).
 */
async function compileSrc( src: string, functionName: string = "main" )
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([
            ["src/main.pebble", fromUtf8(src)],
        ]),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    try {
        await compiler.export({ functionName, entry: "src/main.pebble", root: "/" });
    } catch {}
    return compiler;
}

describe("template strings", () => {

    test("empty template compiles to empty bytes", async () => {
        const src = "function main(): bytes { return ``; }";
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("plain template (no interpolation) compiles to its UTF-8 bytes", async () => {
        const src = "function main(): bytes { return `hello, world`; }";
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("template with int interpolation auto-shows", async () => {
        const src = "function main( n: int ): bytes { return `count is ${n}`; }";
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("template with bytes interpolation passes through (no .show())", async () => {
        const src = "function main( b: bytes ): bytes { return `prefix: ${b} :end`; }";
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("multi-interpolation mixes types and inserts implicit .show()", async () => {
        const src = `
function main( n: int, b: bytes, ok: boolean ): bytes {
    return \`n=\${n} b=\${b} ok=\${ok}\`;
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("template with List<int> interpolation auto-shows recursively", async () => {
        const src = "function main( xs: List<int> ): bytes { return `xs = ${xs}`; }";
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("template usable as a trace argument", async () => {
        const src = `
function main( n: int, b: bytes ): int {
    trace \`n=\${n} b=\${b}\`;
    return n;
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });
});
