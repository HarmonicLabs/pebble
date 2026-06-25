import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// BUG 2 (severe): the `match` STATEMENT keyword is never consumed by the parser,
// so `match` is parsed as an identifier/expression and every case is a syntax error.
describe("bugReport2: match statement", () => {
    test("match statement compiles", async () => {

        const fileName = "bug2_match_statement.pebble";
        const srcText = `
struct Two { A{} B{} }
contract Bug2 {
    spend run( r: data ) {
        const t = r as Two;
        match t {
            when A{} : { assert true; }
            when B{} : { assert true; }
        }
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
