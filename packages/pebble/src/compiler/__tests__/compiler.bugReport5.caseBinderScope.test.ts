import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// BUG 5 (moderate): `case` pattern binders leak into the enclosing block scope
// instead of being scoped to their own arm, so two MUTUALLY-EXCLUSIVE arms that
// reuse a binder name are wrongly rejected as duplicates.
// EXPECTED: compiles. ACTUAL: "Duplicate identifier 'hash'".
describe("bugReport5: case binder scope", () => {
    test("case arms may reuse a binder name", async () => {

        const fileName = "bug5_case_binder_scope.pebble";
        const srcText = `
function credHash( c: Credential ): bytes {
    return case c
        is PubKey{ hash } => hash
        is Script{ hash } => hash;
}
contract Bug5 {
    spend run( r: data ) { assert std.bytes.length( credHash( c0() ) ) >= 0; }
}
function c0(): Credential { return Credential.PubKey{ hash: #00 }; }
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
