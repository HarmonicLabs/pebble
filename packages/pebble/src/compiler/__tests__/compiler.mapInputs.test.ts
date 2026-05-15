import { defaultOptions, testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, prettyUPLC } from "@harmoniclabs/uplc";

describe("parseMain", () => {
    test("parseMain", async () => {

        const fileName = "test.pebble";
        const srcText = `
contract MapInputs {
    mint mapInputToOutDatums() {
        const { tx } = context;

        let restOuts = tx.outputs;
        for(
            let inputs = tx.inputs;
            !inputs.isEmpty();
            inputs = inputs.tail(),
            restOuts = restOuts.tail()
        ) {
            const { resolved: input } = inputs[0];
            const InlineDatum{ datum: nextAmt as int } = restOuts[0].datum;

            assert input.value.lovelaces() === nextAmt;
        }

        assert restOuts.isEmpty();
    }
}
        `;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        const complier = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    
        await complier.compile({ entry: fileName, root: "/" });
        const diagnostics = complier.diagnostics;

        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect( diagnostics.length ).toBe( 0 );

        const output = ioApi.outputs.get("out/out.flat")!;
        expect( output instanceof Uint8Array ).toBe( true );

        // console.log( output.length, toHex( output ) );
        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
    });
    
});