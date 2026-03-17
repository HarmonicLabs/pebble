import { defaultOptions, testOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, prettyUPLC } from "@harmoniclabs/uplc";

describe("parseMain", () => {
    test("parseMain", async () => {

        const fileName = "test.pebble";
        const srcText = `
function factorial( n: int ): int {
    if( n <= 1 ) {
        return 1;
    } else {
        return n * factorial( n - 1 );
    }
}
`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        // const complier = new Compiler( ioApi, defaultOptions );
        const complier = new Compiler( ioApi, testOptions );
    
        await complier.export({ functionName: "factorial", entry: fileName, root: "/" });
        const diagnostics = complier.diagnostics;

        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect( diagnostics.length ).toBe( 0 );

        const output = ioApi.outputs.get("out/out.flat")!;
        expect( output instanceof Uint8Array ).toBe( true );
        expect( output.length ).toBeLessThanOrEqual( 46 );

        // console.log( output.length, toHex( output ) );
        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
    });
    
/*
function iterFactorial( n: int ): int {
    if( n <= 1 ) return 1;

    let result = 2;
    for( let i = 3; i <= n; i++ ) {
        result = result * i;
    }

    return result;
}
*/
});