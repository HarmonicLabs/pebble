import { defaultOptions, testOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { constT, constTypeEq } from "@harmoniclabs/uplc";
import { dataFromCbor } from "@harmoniclabs/plutus-data";
import { CEKConst, CEKError, Machine } from "@harmoniclabs/plutus-machine";

describe("compiler.run", () => {
    test("trace sum 1 to 10", async () => {

        const fileName = "test.pebble";
        const srcText = `
const n = 10;

let result = 0;
for( let i = 0; i <= n; i++ ) {
    result += i;
}

trace result;
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

        // cconsole.log( result );

        expect( diagnostics.length ).toBe( 0 );

        const output = ioApi.outputs.get("out/out.flat")!;
        expect( output instanceof Uint8Array ).toBe( true );

        expect( result.result instanceof CEKError ).toBe( false );
        expect( result.result instanceof CEKConst ).toBe( true );
        if(!( result.result instanceof CEKConst ) ) throw new Error("test exits before; this is just for tsc");
        expect( constTypeEq( result.result.type, constT.unit ) ).toBe( true );

        expect( result.logs.length ).toEqual( 1 );
        expect( result.logs[0] ).toEqual( "55" );

        // console.log( output.length, toHex( output ) );
    });
    
});