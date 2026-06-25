import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// BUG B — using the same unrolled hash fold in two top-level scopes hung the
// compiler. The fold compiles fine once; the SECOND per-test compilation hit an
// infinite loop in `_makeAllNegativeNativesHoisted`: a `tailList` builtin that
// is the direct value of an `IRLetted` (a shape only present on the second
// compilation, via a shared hoisted subtree) could never be wrapped in an
// `IRHoisted` — `IRLetted.set value` unwraps any hoisted assigned to it — so the
// pass re-wrapped the same native forever.
//
// EXPECTED: both folds compile in well under a second, and both tests pass.
//
// This is an execution test: `compiler.test()` compiles AND evaluates each
// `test` body; a non-terminating compile (the bug) never returns, and a wrong
// result would fail the `assert`.
describe("bugReportB: fold compile hang across scopes", () => {

    const SRC = `
function leafRoot(p: bytes): bytes { return std.crypto.blake2b_256(p); }
function nodeRoot(l: bytes, r: bytes): bytes { return std.crypto.blake2b_256(std.bytes.concat(l, r)); }
function step(acc: bytes, sib: bytes, right: boolean): bytes {
    let l = right ? sib : acc;
    let r = right ? acc : sib;
    return nodeRoot(l, r);
}
function fold(leaf: bytes, path: int, s: List<bytes>): bytes {
    let a0 = step(leaf, s[0], path % 2 == 1);
    let a1 = step(a0,   s[1], (path / 2) % 2 == 1);
    let a2 = step(a1,   s[2], (path / 4) % 2 == 1);
    let a3 = step(a2,   s[3], (path / 8) % 2 == 1);
    let a4 = step(a3,   s[4], (path / 16) % 2 == 1);
    let a5 = step(a4,   s[5], (path / 32) % 2 == 1);
    return a5;
}
function sib(): bytes { return #686ede9288c391e7e05026e56f2f91bfd879987a040ea98445dabc76f55b8e5f; }

test foldA() {
    let s = [sib(), sib(), sib(), sib(), sib(), sib()];
    assert fold(leafRoot(std.builtins.replicateByte(4096, 0)), 0, s).length() == 32;
}
test foldB() {
    let s = [sib(), sib(), sib(), sib(), sib(), sib()];
    assert fold(leafRoot(std.builtins.replicateByte(4096, 0)), 0, s).length() == 32;
}
`;

    test("the same fold used in two tests compiles and both pass", async () => {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([ [ "main.pebble", fromUtf8( SRC ) ] ]),
            useConsoleAsOutput: false,
        });
        const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );

        const results = await compiler.test({ entry: "main.pebble", root: "/" } as any );

        expect( compiler.diagnostics.map( d => d.toString() ) ).toEqual( [] );
        expect( results.length ).toBe( 2 );
        for( const r of results ) {
            expect({ name: r.name, passed: r.passed }).toEqual({ name: r.name, passed: true });
        }
    // generous ceiling: the bug never terminates; the fix runs in ~0.3s
    }, 30000);
});
