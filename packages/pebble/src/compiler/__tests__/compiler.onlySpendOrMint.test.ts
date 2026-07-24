import { defaultOptions, testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, prettyUPLC } from "@harmoniclabs/uplc";

async function compile( srcText: string ) {
    const fileName = "test.pebble";
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([
            [fileName, fromUtf8(srcText)],
        ]),
        useConsoleAsOutput: true,
    });
    const complier = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    try {
        await complier.compile({ entry: fileName, root: "/" });
    } catch {
        // diagnostics inspected below
    }
    return {
        diagnostics: complier.diagnostics,
        output: ioApi.outputs.get("out/out.flat"),
    };
}

describe("parseMain", () => {

    test("spend + mint methods in one contract compile", async () => {
        const { diagnostics, output } = await compile(`
contract OnlySpend {
    spend allowSpend() {}
    mint allowMint() {}
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    // since 0.3.7 method names must be unique across ALL purposes:
    // all direct methods share one merged redeemer union (one constructor
    // per method), so a cross-purpose duplicate is a constructor collision.
    test("same method name under two purposes is rejected", async () => {
        const { diagnostics, output } = await compile(`
contract OnlySpend {
    spend allow() {}
    mint allow() {}
}
        `);
        expect(
            diagnostics.some( d => d.toString().includes("30200") )
        ).toBe( true );
        expect( output ).toBe( undefined );
    });

});
