import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// BUG 1 (severe): custom IRNatives fail to lower in some multi-function/multi-method
// contracts, throwing an internal error during UPLC conversion:
//   "Error: in getNRequiredForces; the function is specific for UPLCBuiltinTags; input was: -NN"
describe("bugReport1: native lowering", () => {
    test("custom IRNatives lower in multi-function contract", async () => {

        const fileName = "bug1_native_lowering.pebble";
        const srcText = `
struct CanvasDatum { width: int, height: int, projectOwner: PubKeyHash, price: int, pixels: bytes }
struct Action { Claim{ x: int, y: int, color: int } Recolor{ x: int, y: int, color: int } Recover{} }
const CANVAS: bytes = #43414e564153;

function doClaim( tx: Tx, sref: TxOutRef, beaconPolicy: PolicyId, ownershipPolicy: PolicyId, x: int, y: int, color: int ): boolean {
    const Some{ value: spent } = tx.inputs.find( i => i.ref.id == sref.id && i.ref.index == sref.index );
    const spentOut = spent.resolved;
    assert spentOut.value.amountOf( beaconPolicy, CANVAS ) == 1;
    const InlineDatum{ datum: { width, height, projectOwner, price, pixels } as CanvasDatum } = spentOut.datum;
    const idx = y * width + x;
    assert std.bytes.indexAt( pixels, idx ) == 0;
    const name = std.bytes.fromInt( idx );
    const expectedMint = spentOut.value.scale( 0 ).insert( ownershipPolicy, name, 1 );
    assert tx.mint.contains( expectedMint );
    return true;
}

function doRecolor( tx: Tx, sref: TxOutRef, beaconPolicy: PolicyId, ownershipPolicy: PolicyId, x: int, y: int, color: int ): boolean {
    const Some{ value: spent } = tx.inputs.find( i => i.ref.id == sref.id && i.ref.index == sref.index );
    const spentOut = spent.resolved;
    assert spentOut.value.amountOf( beaconPolicy, CANVAS ) == 1;
    const InlineDatum{ datum: { width, height, projectOwner, price, pixels } as CanvasDatum } = spentOut.datum;
    const idx = y * width + x;
    assert std.bytes.indexAt( pixels, idx ) != 0;
    const name = std.bytes.fromInt( idx );
    assert tx.inputs.some( i => i.resolved.value.amountOf( ownershipPolicy, name ) >= 1 );
    return true;
}

contract Bug1 {
    param beaconPolicy: PolicyId;
    param ownershipPolicy: PolicyId;
    spend run( r: data ) {
        const { tx, spendingRef } = context;
        const act = r as Action;
        assert case act
            is Claim{ x: cx, y: cy, color: cc }   => doClaim( tx, spendingRef, this.beaconPolicy, this.ownershipPolicy, cx, cy, cc )
            is Recolor{ x: rx, y: ry, color: rc } => doRecolor( tx, spendingRef, this.beaconPolicy, this.ownershipPolicy, rx, ry, rc )
            is Recover{}                          => ( true );
    }
}
`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );

        await compiler.compile({ entry: fileName, root: "/" });
        const diagnostics = compiler.diagnostics;

        expect( diagnostics.map( d => d.toString() ) ).toEqual( [] );
        expect( diagnostics.length ).toBe( 0 );

        const output = ioApi.outputs.get("out/out.flat")!;
        expect( output instanceof Uint8Array ).toBe( true );
    });
});
