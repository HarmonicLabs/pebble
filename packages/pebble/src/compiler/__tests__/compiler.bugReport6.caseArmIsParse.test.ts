import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// BUG 6 (minor, parse): a `case`-arm body expression followed by `is` mis-parses
// (the next arm's `is` is swallowed into the previous arm body).
// EXPECTED: compiles. ACTUAL: "Statement expected" / type errors.
describe("bugReport6: case arm body followed by is", () => {
    test("unparenthesized case-arm body before next `is` parses", async () => {

        const fileName = "bug6_case_arm_is_parse.pebble";
        const srcText = `
struct Two { A{ n: int } B{} }
function f( t: Two ): boolean {
    return case t
        is A{ n } => n > 0
        is B{} => true;
}
contract Bug6 {
    spend run( r: data ) { assert f( Two.B{} ); }
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
