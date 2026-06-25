import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// BUG 4 (moderate): two internal Optional representations are mutually unassignable
// but print identically, so the diagnostic is confusing.
// EXPECTED: assignable. ACTUAL: "Type 'Optional<data>' is not assignable to type 'Optional<data>'".
describe("bugReport4: optional flavors", () => {
    test("context.optionalDatum is assignable to Optional<data> param", async () => {

        const fileName = "bug4_optional_flavors.pebble";
        const srcText = `
function useDatum( od: Optional<data> ): boolean { return true; }
contract Bug4 {
    spend run( r: data ) {
        const { tx, spendingRef, optionalDatum } = context;
        assert useDatum( optionalDatum );
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
