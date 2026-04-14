import { defaultOptions, testOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromHex, fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { Application, constT, parseUPLC, prettyUPLC, UPLCConst } from "@harmoniclabs/uplc";
import { CEKConst, DataB, DataConstr, DataI, DataMap, Hash28, Machine, Value } from "@harmoniclabs/buildooor";

describe("byteify", () => {

    test("single entry ok", async () => {





        const fileName = "test.pebble";
        const srcText = `
function byteify( n: int ): bytes {
    return n as bytes;
}
`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        // const complier = new Compiler( ioApi, defaultOptions );
        const complier = new Compiler(ioApi, testOptions);

        await complier.export({ functionName: "byteify", entry: fileName, root: "/" });
        const diagnostics = complier.diagnostics;

        const outputBytes = ioApi.outputs.get("out/out.flat")!;
        const uplc = parseUPLC(outputBytes).body;

        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect(diagnostics.length).toEqual(0);

        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
        expect(outputBytes instanceof Uint8Array).toEqual(true);

        // console.log( output.length, toHex( output ) );

        const applied_1 = new Application(
            uplc,
            UPLCConst.int( 0 )
        );
        const result_1 = Machine.eval(applied_1);
        expect(result_1.result instanceof CEKConst).toEqual(true);
        expect(( result_1.result as CEKConst).value ).toEqual( fromHex("") );

        const applied_2 = new Application(
            uplc,
            UPLCConst.int( 1 ) 
        );
        const result_2 = Machine.eval(applied_2);
        expect(result_2.result instanceof CEKConst).toEqual(true);
        expect(( result_2.result as CEKConst).value ).toEqual( fromHex("01") );

        const applied_3 = new Application(
            uplc,
            UPLCConst.int( 255 )
        );
        const result_3 = Machine.eval(applied_3);
        expect(result_3.result instanceof CEKConst).toEqual(true);
        expect(( result_3.result as CEKConst).value ).toEqual( fromHex("ff") );

        const result_4 = Machine.eval(
            new Application(
                uplc,
                UPLCConst.int( 256 )
            )
        );
        expect(result_4.result instanceof CEKConst).toEqual(true);
        expect(( result_4.result as CEKConst).value ).toEqual( fromHex("0100") );

        const result_5 = Machine.eval(
            new Application(
                uplc,
                UPLCConst.int( 1024 )
            )
        );
        expect(result_5.result instanceof CEKConst).toEqual(true);
        expect(( result_5.result as CEKConst).value ).toEqual( fromHex("0400") );

        const result_6 = Machine.eval(
            new Application(
                uplc,
                UPLCConst.int( 65535 )
            )
        );
        expect(result_6.result instanceof CEKConst).toEqual(true);
        expect(( result_6.result as CEKConst).value ).toEqual( fromHex("ffff") );

        const result_7 = Machine.eval(
            new Application(
                uplc,
                UPLCConst.int( 65536 )
            )
        );
        expect(result_7.result instanceof CEKConst).toEqual(true);
        expect(( result_7.result as CEKConst).value ).toEqual( fromHex("010000") );
    })

});