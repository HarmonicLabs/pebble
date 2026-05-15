import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Source } from "../../../ast/Source/Source";
import { DiagnosticMessage } from "../../../diagnostics/DiagnosticMessage";
import { defaultOptions, COMPILER_VERSION } from "../../../IR/toUPLC/CompilerOptions";
import { parseFile } from "../../../parser/parseFile";
import { createMemoryCompilerIoApi } from "../../io/CompilerIoApi";
import { AstCompiler } from "../AstCompiler";



describe("parseMain", () => {

    test("parseMain", async () => {

        const myDatumPath = "my_datum.pebble";
        const myDatumSrc = `
export struct MyDatum {}
`;


        const fileName = "test.pebble";
        const srcText = `
import { MyDatum } from "./${myDatumPath}";

contract MyContract {
    spend main(): void
    {
        const { tx } = ctx;
    
        let inputsLength = 0;
        let sumLove = 0;
        for( const { resolved: input } of tx.inputs )
        {
            sumLove += input.value.lovelaces();
            inputsLength += 1;
        }
    
        assert tx.outputs.length() === 1 else "only one output allowed";
        const output = tx.outputs[0];
    
        const InlineDatum{ datum } = output.datum;
    
        assert inputsLength >= 2;
        assert (datum as int) === sumLove / inputsLength;
    }
}

        `;

        const complier = new AstCompiler(
            {
                ...defaultOptions,
                compilerVersion: COMPILER_VERSION,
                entry: fileName,
                root: "/"
            },
            createMemoryCompilerIoApi({
                sources: new Map([
                    [fileName, fromUtf8(srcText)],
                    [myDatumPath, fromUtf8(myDatumSrc)],
                ]),
                useConsoleAsOutput: true,
            }),
        );
    
        const source = await complier.compileFile( fileName );
        const diagnostics = complier.diagnostics;

        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect( diagnostics.length ).toBe( 0 );
    });
    
});

`
contract MyContract {

    param owner: PubKeyHash;
    param txOutRef: TxOutRef;

    spend sendToOwner()
    {
        const { tx, purpose } = context;

        assert tx.outputs.length() == 1 else "only one output allowed";
        assert tx.outputs[0].address.credential.hash === this.owner;
    }
        
    spend sendToSomeone( someone: PubKeyHash ) {
    }

    mint oneShotMint( quantity: int )
    {
        const { tx } = context;
    }

    certify doStuff() {}

    withdraw withdrawFunds() {}

    propose newConstitution() {}

    vote alwaysNo() {}
}
`