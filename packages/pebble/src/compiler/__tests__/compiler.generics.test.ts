import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

async function compileSrc( src: string )
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([
            ["src/main.pebble", fromUtf8(src)],
        ]),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await compiler.export({ functionName: "main", entry: "src/main.pebble", root: "/" });
    return compiler;
}

describe("generic functions", () => {

    test("identity function instantiated with explicit type argument", async () => {
        const src = `
function id<T>( x: T ): T { return x; }

function main( n: int ): int {
    return id<int>( n );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("identity function instantiated by inference", async () => {
        const src = `
function id<T>( x: T ): T { return x; }

function main( n: int ): int {
    return id( n );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("two distinct instantiations are both compiled", async () => {
        const src = `
function id<T>( x: T ): T { return x; }

function main( n: int, b: bytes ): int {
    let a: int = id<int>( n );
    let bs: bytes = id<bytes>( b );
    return a;
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("wrong number of explicit type arguments is rejected", async () => {
        const src = `
function id<T>( x: T ): T { return x; }

function main( n: int ): int {
    return id<int, bytes>( n );
}`;
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/main.pebble", fromUtf8(src)],
            ]),
            useConsoleAsOutput: false,
        });
        const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
        let threw = false;
        try {
            await compiler.export({ functionName: "main", entry: "src/main.pebble", root: "/" });
        } catch {
            threw = true;
        }
        // The compilation must NOT succeed silently — either an export-time
        // throw or a non-empty captured stdout (diagnostics get drained into
        // the IO stream).
        const stdoutLength = (ioApi.stdout as any).buffer?.length ?? 0;
        expect( threw || stdoutLength > 0 ).toBe( true );
    });
});
