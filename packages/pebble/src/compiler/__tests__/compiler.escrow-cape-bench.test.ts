import { defaultOptions, testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, prettyUPLC } from "@harmoniclabs/uplc";

describe("parseMain", () => {
    test("parseMain", async () => {

        const fileName = "test.pebble";
        const srcText = `
const payAmount = 75_000_000;

const buyer  = #aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;
const seller = #bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;

const deadline = 1_800_000; // 30 minutes after deposit (1800 seconds)

// data struct EscrowState {
//     Deposited{}
//     Accepted{}
//     Refunded{}
// }

data struct EscrowDatum {
    state: int,
    depositTime: int,
}

contract EscrowCapeBench {
    spend deposit() {
        const { tx, spendingRef } = context;

        const spendingInput = tx.inputs.find( i => i.ref == spendingRef )!.resolved;
        const ownHash = spendingInput.address.payment.hash();

        // const ownOuts = tx.outputs.filter( o => o.address.payment.hash() == ownHash );
        // fstOut = ownOuts.head();
        const fstOut = tx.outputs.head();

        const InlineDatum{ datum: {
            state,
            depositTime
        } as EscrowDatum } = fstOut.datum;

        assert state == 0; // Deposited

        assert tx.requiredSigners.includes( buyer );
        assert fstOut.address.payment.hash() == ownHash;
        assert fstOut.value.lovelaces() == payAmount;

        const Finite{ n: currentTime } = tx.validityInterval.from.boundary;
        assert depositTime == currentTime;
    }

    spend accept() {
        const { tx, spendingRef } = context;

        const spendingInput = tx.inputs.find( i => i.ref == spendingRef )!.resolved;
        const ownHash = spendingInput.address.payment.hash();

        const InlineDatum{ datum: {
            state,
        } as EscrowDatum } = spendingInput.datum;

        const sellerOut = tx.outputs.head();

        assert state == 0; // Deposited
        assert tx.requiredSigners.includes( seller );

        assert sellerOut.address.payment.hash() == seller;
        assert sellerOut.value.lovelaces() >= payAmount;
    }
    
    spend refund() {
        const { tx, spendingRef } = context;

        const spendingInput = tx.inputs.find( i => i.ref == spendingRef )!.resolved;
        const ownHash = spendingInput.address.payment.hash();

        const InlineDatum{ datum: {
            state,
            depositTime
        } as EscrowDatum } = spendingInput.datum;

        const buyerOut = tx.outputs.head();

        const Finite{ n: currentTime } = tx.validityInterval.from.boundary;
        assert currentTime >= depositTime + deadline;

        assert state == 0; // Deposited

        assert tx.requiredSigners.includes( buyer );

        assert buyerOut.address.payment.hash() == buyer;
        assert buyerOut.value.lovelaces() >= payAmount;
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

        // console.log( output.length, toHex( output ) );
        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
    });
    
});