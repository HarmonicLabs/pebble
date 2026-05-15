import { Source } from "../../../ast/Source/Source";
import { DiagnosticMessage } from "../../../diagnostics/DiagnosticMessage";
import { defaultOptions, COMPILER_VERSION } from "../../../IR/toUPLC/CompilerOptions";
import { parseFile } from "../../../parser/parseFile";
import { createMemoryCompilerIoApi } from "../../io/CompilerIoApi";
import { AstCompiler } from "../AstCompiler";



describe("parseMain", () => {
    test.todo("parseMain");
    test.skip("parseMain", async () => {

        const myDatumPath = "my_datum.pebble";
        const myDatumSrc = `
export struct MyDatum {}

struct SimpleDatum {
    name: string,
    age: int
}

struct ExplicitSimple {
    ExplicitSimple { /* ...fields  */ }
}

struct Animal {
    Dog { /* ...fields  */ }
    Cat { /* ...fields  */ }
    Fish { /* ...fields  */ }
}`;
    
        const fileName = "test.pebble";
        const srcText = `
import { MyDatum } from "./${myDatumPath}";

contract MyContract {
    
    param ownerPkh: bytes;
    
    constructor(
        ownerPkh: bytes
    ) {
        this.ownerPkh = ownerPkh;
    }

    spend sendToOwner()
    {
        const { tx, puropse, redeemer } = context;

        assert tx.outputs.length() === 1;
        
        const output = tx.outputs[0];
        assert output.address.credential.hash() === this.ownerPkh;
    }

    spend accumulate()
    {
        assert tx.outputs.length() === 1;
        
        const output = tx.outputs[0];
        assert output.address.credential.hash() === this.ownHash;
    }

    mint creteToken()
    {
    }

    mint burnToken()
    {
    }

    certify certify() {}

    withdraw withdraw() {}

    propose propose() {}

    vote vote() {}
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
                    [fileName, srcText],
                    [myDatumPath, myDatumSrc],
                ]),
                useConsoleAsOutput: true,
            }),
        );
    
        const source = await complier.compileFile( fileName );
        const diagnostics = complier.diagnostics;

        // console.log( diagnostics.map( d => d.toString() ) );
        expect( diagnostics.length ).toBe( 0 );
    });
    
});