import { defaultOptions, testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, prettyUPLC } from "@harmoniclabs/uplc";

describe("parseMain", () => {
    test("multi prop access", async () => {

        const fileName = "test.pebble";
        const srcText = `
struct HelloWorldDatum {
    owner: bytes
}

contract HelloWorld
{
    spend getDatumField() {
        const { tx } = context;

        const { resolved: spendingInput } = tx.inputs[0];

        const InlineDatum{
            datum: { owner } as HelloWorldDatum
        } = spendingInput.datum;
        // const { owner } = datum as HelloWorldDatum;

        assert owner == "owner_bytes";
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

        // console.log( toHex( output ) );
        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
    });
    
});