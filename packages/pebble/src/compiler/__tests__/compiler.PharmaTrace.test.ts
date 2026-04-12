import { defaultOptions, testOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, prettyUPLC } from "@harmoniclabs/uplc";

describe("PharmaTrace", () => {
    test("compiles PharmaTrace", async () => {

        const fileName = "test.pebble";
        const srcText = `
// TRACE Pharmaceutical Supply Chain Validator
// Pebble port of contracts/validators/pharma_trace.ak

struct ContractDatum {
    ChainOfCustody {
        manufacturer: PubKeyHash,
        current_holder: PubKeyHash,
        batch_id: bytes,
        step: int
    }
    MintCounter{
        n: int
    }
}

contract PharmaTrace {
    param manufacturer: PubKeyHash;
    param seed: TxOutRef;

    // Mint: manufacturer mints exactly 1 NFT per batch
    // tokenName (= batchId) passed as redeemer for on-chain verification
    mint mintBatch( counterInputIdx: int ) {
        const { tx, policy } = context;

        const counterInput = tx.inputs[ counterInputIdx ].resolved;
        
        // forward validation to the spending of the counter utxo
        // see incrementCounter method below
        assert counterInput.address.payment.hash() == policy;
        assert counterInput.value.amountOf( policy, # ) == 1;
    }

    mint initCounter() {
        const { tx, policy } = context;

        assert tx.inputs.some(({ ref }) => ref == this.seed);

        const mintedAssets = tx.mint[policy];
        assert mintedAssets.length() == 1;

        const { key: tokenName, value: qty } = mintedAssets.head();
        // empty bytes is an unique name
        assert tokenName == #;
        assert qty == 1;

        assert tx.outputs.length() == 1;
        const output = tx.outputs[0];

        assert output.address.payment.hash() == policy;
        const InlineDatum{ datum: MintCounter{ n } as ContractDatum } = output.datum
        assert n == 0;

        assert output.value.amountOf( policy, # ) == 1;
    }

    // allow assets under this policy to be burned at any time by anyone
    mint burn() {
        const { tx, policy } = context;

        // Verify that any token under our policy has negative quantity (i.e. is being burned)
        assert tx.mint[policy].every(({ value: qty }) => qty < 0);
    }

    // Spend: transfer custody to next holder
    spend transfer( inputIdx: int, outputIdx: int) {
        const {
            tx,
            optionalDatum: Some{
                value: ChainOfCustody{
                    manufacturer,
                    current_holder,
                    batch_id,
                    step
                } as ContractDatum
            }
            spendingRef
        } = context;

        const { ref: ownInputRef, resolved: ownInput } = tx.inputs[ inputIdx ];
        assert spendingRef == ownInputRef;

        const ownHash = ownInput.address.payment.hash();

        // Current holder must sign
        assert tx.requiredSigners.includes( current_holder );

        // we require the output to be the first
        const output = tx.outputs[outputIdx];
        const InlineDatum{ datum: ChainOfCustody{
            manufacturer: nextManufacturer,
            current_holder: nextHolder,
            batch_id: nextBatchId,
            step: nextStep
        } as ContractDatum } = output.datum;

        assert nextManufacturer == manufacturer;
        assert nextHolder.length() == 28; // must be a valid pubkey hash
        assert nextBatchId == batch_id; // same batch
        assert nextStep == step + 1; // step must be incremented by 1

        // stays in contract
        assert output.address.payment.hash() == ownHash;

        // preserve nft
        assert output.value.amountOf( ownHash, batch_id ) == 1;
    }

    // Spend: deliver — NFT leaves script address to holder's wallet
    // No continuing output check needed
    spend deliver() {
        const {
            tx,
            optionalDatum: Some{
                value: ChainOfCustody{ current_holder } as ContractDatum
            }
        } = context;

        assert tx.requiredSigners.includes(current_holder);
    }

    // mints new batch
    spend incrementCounter( ownInputIdx: int ) {
        const {
            tx,
            optionalDatum: Some{
                value: MintCounter{ n: prevCounter } as ContractDatum
            },
            spendingRef
        } = context;

        assert tx.requiredSigners.includes( this.manufacturer );

        const { ref: ownInputRef, resolved: ownInput } = tx.inputs[ ownInputIdx ];
        assert spendingRef == ownInputRef;

        const ownHash = ownInput.address.payment.hash();

        assert ownInput.value.amountOf( ownHash, # ) == 1;

        let nextCounter = prevCounter;
        let outputs = tx.outputs.tail(); // skip first output, which is reserved for the next counter utxo
        // tx.mint[ownHash] fails if not present
        for( const { key: tokenName, value: qty } of tx.mint[ownHash] ) {
            nextCounter += 1;
            const batch_name = nextCounter as bytes;
            
            assert tokenName == batch_name;
            assert qty == 1;

            const out = outputs.head();
            assert out.address.payment.hash() == ownHash;
            assert out.value.amountOf( ownHash, tokenName ) == 1;

            // also validate datum
            const InlineDatum{ datum: ChainOfCustody{
                manufacturer,
                current_holder,
                batch_id,
                step
            } as ContractDatum } = out.datum

            assert manufacturer == this.manufacturer;
            assert current_holder == this.manufacturer;
            assert batch_id == batch_name;
            assert step == 0;

            // go to next output
            outputs = outputs.tail();
        }

        const nextCounterUtxo = tx.outputs[0];
        assert nextCounterUtxo.address.payment.hash() == ownHash;
        assert nextCounterUtxo.value.amountOf( ownHash, # ) == 1;
        const InlineDatum{ datum: MintCounter{ n: next } as ContractDatum } = nextCounterUtxo.datum;
        assert next == nextCounter;
    }
}
        `;

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
    
});