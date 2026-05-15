import { defaultOptions, testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, prettyUPLC } from "@harmoniclabs/uplc";

describe("parseMain", () => {
    test("pebble-cli init", async () => {

        const fileName = "test.pebble";
        const srcText = `
// if no methods are defined
// the contract is interpreted as always failing
contract MyContract {

    param owner: PubKeyHash;

    spend ownerAllowsIt() {
        const { tx } = context;

        assert tx.requiredSigners.includes( this.owner );
    }

    spend sendToOwner( amount: int ) {
        const { tx } = context;

        assert tx.outputs.length() === 1;

        const output = tx.outputs[0];

        assert output.address.payment.hash() == this.owner;
        assert output.value.lovelaces() >= amount;
    }

    // mint mintOrBurnTokens() {}

    // cert validateCertificateSubmission() {}

    // withdraw getStakingRewards() {}

    // vote voteOnProposal() {}

    // propose proposeGovernanceAction () {}
}`;

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