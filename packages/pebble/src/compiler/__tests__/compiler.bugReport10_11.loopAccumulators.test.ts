import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// BUGS 10 & 11 — silent loop miscompilations (wrong result, no diagnostic).
//
// Root cause (shared): the set of outer variables threaded through a loop is
// `reassigned ∩ stmt.deps()`, computed with `keepSortedStrArrInplace`, which
// requires BOTH inputs sorted. `stmt.deps()` is NOT sorted, so reassigned
// accumulators were spuriously dropped from the threaded state and frozen at
// their initial value.
//   - Bug 10: a loop reassigning two accumulators threaded only one.
//   - Bug 11: a loop whose single accumulator update binds the helper-call args
//     to inner `let`s froze the accumulator (dropped from the threaded set).
//
// Both are execution tests (the loop is actually evaluated).
describe("bugReport10/11: loop accumulator threading", () => {

    async function trace1( srcText: string ) {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([ [ "main.pebble", fromUtf8( srcText ) ] ]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        const result = await compiler.run({ entry: "main.pebble", root: "/" });
        return { logs: result.logs, diagnostics: compiler.diagnostics.map( d => d.toString() ) };
    }

    async function runTests( srcText: string ) {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([ [ "main.pebble", fromUtf8( srcText ) ] ]),
            useConsoleAsOutput: false,
        });
        const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        const results = await compiler.test({ entry: "main.pebble", root: "/" } as any );
        return { results, diagnostics: compiler.diagnostics.map( d => d.toString() ) };
    }

    test("Bug 10: a loop reassigning two accumulators threads both", async () => {
        const { logs, diagnostics } = await trace1(`
function twoVars( n: int ): int {
    let a = 0;
    let b = 0;
    for( let i = 0; i < n; i = i + 1 ) {
        a = a + 1;
        b = b + 2;
    }
    return a * 1000 + b;
}
trace twoVars( 3 );
`);
        expect( diagnostics ).toEqual( [] );
        // a -> 3, b -> 6  => 3*1000 + 6
        expect( logs ).toEqual( [ "3006" ] );
    });

    test("Bug 10: three accumulators all thread", async () => {
        const { logs, diagnostics } = await trace1(`
function threeVars( n: int ): int {
    let a = 0;
    let b = 0;
    let c = 0;
    for( let i = 0; i < n; i = i + 1 ) {
        a = a + 1;
        b = b + 10;
        c = c + 100;
    }
    return a + b + c;
}
trace threeVars( 4 );
`);
        expect( diagnostics ).toEqual( [] );
        // 4 + 40 + 400
        expect( logs ).toEqual( [ "444" ] );
    });

    test("Bug 11: accumulator threads even when helper-call args are inner `let`s", async () => {
        const { results, diagnostics } = await runTests(`
function mNode( left: bytes, right: bytes ): bytes {
    return std.crypto.blake2b_256( std.bytes.concat( std.bytes.concat( #01, left ), right ) );
}

// args inlined directly into the call
function fInline( leafHash: bytes, dirs: List<int>, path: List<bytes> ): bytes {
    let acc = leafHash;
    for( let i = 0; i < path.length(); i = i + 1 ) {
        acc = mNode( (dirs[i] == 1) ? path[i] : acc, (dirs[i] == 1) ? acc : path[i] );
    }
    return acc;
}

// identical, but args bound to inner lets that read acc (the freezing case)
function fInnerLet( leafHash: bytes, dirs: List<int>, path: List<bytes> ): bytes {
    let acc = leafHash;
    for( let i = 0; i < path.length(); i = i + 1 ) {
        let l = (dirs[i] == 1) ? path[i] : acc;
        let r = (dirs[i] == 1) ? acc : path[i];
        acc = mNode( l, r );
    }
    return acc;
}

test innerLetThreadsLikeInline() {
    let dirs = [ 0, 0 ];
    let path = [ #a1, #b2 ];
    // both forms must agree...
    assert fInline( #cc, dirs, path ).equals( fInnerLet( #cc, dirs, path ) ) else "inline != inner-let";
    // ...and acc must actually have changed (not frozen at the leaf)
    assert !fInnerLet( #cc, dirs, path ).equals( #cc ) else "acc frozen at leaf";
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( results.length ).toBe( 1 );
        expect({ name: results[0].name, passed: results[0].passed })
            .toEqual({ name: "innerLetThreadsLikeInline", passed: true });
    });
});
