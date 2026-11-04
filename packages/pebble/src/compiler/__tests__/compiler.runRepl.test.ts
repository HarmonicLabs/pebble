import { testOptions, COMPILER_VERSION, CompilerOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { CEKConst } from "@harmoniclabs/plutus-machine";

/**
 * `Compiler.runRepl` wraps a source in a function and runs it (`ReplSession` writes the whole
 * program itself instead). Declarations alone used to fail with "ERROR 101: Contract is
 * missing" (the source was left unwrapped), and an assignment as the last statement became
 * `return x = 5;` ("ERROR 2810").
 */

jest.setTimeout( 60_000 );

async function runRepl( src: string )
{
    const compiler = new Compiler(
        createMemoryCompilerIoApi({ sources: new Map([[ "repl.pebble", fromUtf8( src ) ]]) }),
        { ...testOptions, compilerVersion: COMPILER_VERSION } as CompilerOptions
    );
    return await compiler.runRepl({ entry: "repl.pebble", root: "/" });
}

test("a source of declarations only runs (and returns nothing)", async () => {
    const { result } = await runRepl( "function f( x: int ): int { return x * 2; }\nstruct P { x: int }" );
    expect( result ).toBeInstanceOf( CEKConst );
});

test("an assignment as the last statement stays a statement", async () => {
    const { result } = await runRepl( "let x = 1;\nx = 5;\nfunction g(): int { return 1; }" );
    expect( result ).toBeInstanceOf( CEKConst );
});

test("an expression as the last statement is the value", async () => {
    const { result } = await runRepl( "function f( x: int ): int { return x * 2; }\nf( 21 )" );
    expect( ( result as CEKConst ).value ).toBe( 42n );
});
