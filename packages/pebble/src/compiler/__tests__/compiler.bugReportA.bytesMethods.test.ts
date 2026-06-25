import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// BUG A — `bytes` builtin ops are namespace functions, not methods.
// `.length()` works as a method, but `.concat()` / `.indexAt()` / `.equals()` / ...
// did NOT resolve as methods, even though their `std.bytes.*` namespace forms exist.
// EXPECTED: they resolve as methods (consistent with `.length()`).
//
// The `test` blocks below both compile AND execute (each is evaluated once and
// passes only if every `assert` holds at runtime).
describe("bugReportA: bytes methods", () => {

    async function runTests( srcText: string ) {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([ [ "main.pebble", fromUtf8( srcText ) ] ]),
            useConsoleAsOutput: false,
        });
        const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        const results = await compiler.test({ entry: "main.pebble", root: "/" } as any );
        return { compiler, results };
    }

    test("bytes ops resolve as methods and evaluate correctly", async () => {
        const { compiler, results } = await runTests(`
test concat() {
    assert #aabb.concat( #ccdd ) == #aabbccdd else "concat";
}
test indexAt() {
    assert #00112233.indexAt( 2 ) == 0x22 else "indexAt";
}
test equals() {
    assert #aabb.equals( #aabb ) else "equals-eq";
    assert !#aabb.equals( #aacc ) else "equals-neq";
}
test slice() {
    assert #00112233.slice( 1, 2 ) == #1122 else "slice";
}
test comparisons() {
    assert #aa.lessThan( #ab ) else "lt";
    assert #ab.greaterThan( #aa ) else "gt";
    assert #aa.lessThanEquals( #aa ) else "lte";
    assert #aa.greaterThanEquals( #aa ) else "gte";
}
test length_still_works() {
    assert #aabbcc.length() == 3 else "length";
}
`);
        expect( compiler.diagnostics.map( d => d.toString() ) ).toEqual( [] );
        // every test ran and passed at runtime
        expect( results.length ).toBe( 6 );
        for( const r of results ) {
            expect({ name: r.name, passed: r.passed }).toEqual({ name: r.name, passed: true });
        }
    });
});
