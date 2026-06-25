import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// BUG 3 (severe): a sum-type struct cannot be used as a contract-method parameter,
// AND the compiler CRASHES instead of emitting a clean diagnostic.
// EXPECTED: compiles (or a clean error). ACTUAL: "'Action' is not defined" + "Error: pos out of range".
describe("bugReport3: sumtype as method param", () => {
    test("sum-type struct as contract-method parameter compiles", async () => {

        const fileName = "bug3_sumtype_param.pebble";
        const srcText = `
struct Action { Claim{ x: int } Recover{} }
contract Bug3 {
    spend run( a: Action ) {
        assert true;
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
