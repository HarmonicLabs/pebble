import { defaultOptions, testOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, prettyUPLC } from "@harmoniclabs/uplc";

describe("parseMain", () => {
    test("RewardVotes", async () => {

        const fileName = "test.pebble";
        const srcText = `
contract RewardVotes {

    param govActionId: TxOutRef;
    param expiry: int;

    spend reward() {
        const {
            tx,
            optionalDatum: Some{ value: expectedVoterCreds as Credential }
        } = context;

        const expectedVoter: Voter = Voter.DRep{ credential: expectedVoterCreds };

        assert tx.votes.lookup( expectedVoter )!.lookup( this.govActionId );
    }

    spend recoverExpired() {
        const { tx } = context;

        const Finite{ n } = tx.validityInterval.from.boundary;

        assert n > this.expiry;

        // assert tx.validityInterval.from.boundary.finite() > this.expiry;
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

        // console.log( output.length, toHex( output ) );
        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
    });
    
test("invalid voter 1", async () => {

        const fileName = "test.pebble";
        const srcText = `
contract RewardVotes {

    param govActionId: TxOutRef;
    param expiry: int;

    spend reward() {
        const {
            tx,
            optionalDatum: Some{ value: expectedVoterCreds as Credential }
        } = context;

        const expectedVoter: Voter = Voter.Stuff{ credential: expectedVoterCreds };

        assert tx.votes.lookup( expectedVoter )!.lookup( this.govActionId );
    }
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        const complier = new Compiler( ioApi, testOptions );
    
        await expect(
            complier.compile({ entry: fileName, root: "/" })
        ).rejects.toThrow();
        const diagnostics = complier.diagnostics;

        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect( diagnostics.length ).toBe( 1 );

        // console.log( output.length, toHex( output ) );
        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
    });
    

    
test("invalid voter 2", async () => {

        const fileName = "test.pebble";
        const srcText = `
contract RewardVotes {

    param govActionId: TxOutRef;
    param expiry: int;

    spend reward() {
        const {
            tx,
            optionalDatum: Some{ value: expectedVoterCreds as Credential }
        } = context;

        using { Stuff } = Voter

        const expectedVoter: Voter = Stuff{ credential: expectedVoterCreds };

        assert tx.votes.lookup( expectedVoter )!.lookup( this.govActionId );
    }
}`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        const complier = new Compiler( ioApi, testOptions );
    
        await expect(
            complier.compile({ entry: fileName, root: "/" })
        ).rejects.toThrow();
        const diagnostics = complier.diagnostics;

        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect( diagnostics.length ).toBe( 1 );

        // console.log( output.length, toHex( output ) );
        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
    });
    
});

/*
//*/
