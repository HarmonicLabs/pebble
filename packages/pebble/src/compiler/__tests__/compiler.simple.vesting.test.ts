import { defaultOptions, testOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { Application, constT, constTypeEq, parseUPLC, UPLCConst } from "@harmoniclabs/uplc";
import { dataFromCbor } from "@harmoniclabs/plutus-data";
import { CEKConst, CEKError, Machine } from "@harmoniclabs/plutus-machine";

describe("parseMain", () => {
    test("parseMain", async () => {

        const fileName = "test.pebble";
        const srcText = `
struct VestingDatum {
    beneficiary: PubKeyHash,
    deadline: int
}

contract Vesting
{
    spend unlock()
    {
        const {
            tx,
            optionalDatum: Some{
                value: {
                    beneficiary,
                    deadline
                } as VestingDatum
            }
        } = context;
        
        assert tx.requiredSigners.includes( beneficiary );
        
        const Finite{ n } = tx.validityInterval.from.boundary;
        assert n >= deadline;
    }
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        const complier = new Compiler( ioApi, testOptions );
    
        await complier.compile({ entry: fileName, root: "/" });
        const diagnostics = complier.diagnostics;

        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect( diagnostics.length ).toBe( 0 );

        const output = ioApi.outputs.get("out/out.flat")!;
        expect( output instanceof Uint8Array ).toBe( true );

        const program = parseUPLC( output );

        const ctxData = UPLCConst.data(
            dataFromCbor(
                "d8799fd8799f9fd8799fd8799f5820626d24357abe858e1d4ee1aac6b272e940af9fdbda578284beeed50a41bbcc3500ffd8799fd8799fd87a9f581cec5f0e35431104f08cad88194f0943f9177b10c603952f6e2b42cbc7ffd87a80ffbf40bf401a004c4b40ffffd87b9fd8799f581ca8b4743bedbe56f4c2d1fc264c605b8c1205b1c3830fa2d68a3a33ea1b000001828a342750ffffd87a80ffffff809fd8799fd8799fd8799fd8799f581ca8b4743bedbe56f4c2d1fc264c605b8c1205b1c3830fa2d68a3a33eaffd87a80ffbf40bf401a004957cbffffd87980d87a80ffffff1a0002f375a080a0d8799fd8799fd87a9f1b000001828a344e60ffd87980ffd8799fd87b80d87980ffff9f581ca8b4743bedbe56f4c2d1fc264c605b8c1205b1c3830fa2d68a3a33eaffbfd87a9fd8799f5820626d24357abe858e1d4ee1aac6b272e940af9fdbda578284beeed50a41bbcc3500ffffd8799f00ffffa05820eece9d86789fd3abc10f43548d696dba416a91ec61a4884863c0d9632e519d22ffd8799f00ffd87a9fd8799f5820626d24357abe858e1d4ee1aac6b272e940af9fdbda578284beeed50a41bbcc3500ffd8799fd8799f581ca8b4743bedbe56f4c2d1fc264c605b8c1205b1c3830fa2d68a3a33ea1b000001828a342750ffffffff"
            )
        );
        const result = Machine.evalSimple(
            new Application(
                program.body,
                ctxData
            )
        );
        expect( result instanceof CEKError ).toBe( false );
        expect( result instanceof CEKConst ).toBe( true );
        if(!( result instanceof CEKConst ) ) throw new Error("test exits before; this is just for tsc");         
        expect( constTypeEq( result.type, constT.unit ) ).toBe( true );

        // console.log( output.length, toHex( output ) );
        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
    });
    
});