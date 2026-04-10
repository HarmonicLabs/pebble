import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { testOptions } from "../../IR";
import { Compiler } from "../Compiler";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";

describe("extended int", () => {

    test("finite", async () => {
        const fileName = "test.pebble";
        const srcText = `
trace ExtendedInteger.Finite{ n: 5 }.finite();
`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        const complier = new Compiler( ioApi, testOptions );
    
        const result = await complier.run({ entry: fileName, root: "/" });
        const diagnostics = complier.diagnostics;
        
        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect( diagnostics.length ).toBe( 0 );
        expect( result.logs.length ).toBe( 1 );
        expect( result.logs[0] ).toBe( "5" );
    })

})