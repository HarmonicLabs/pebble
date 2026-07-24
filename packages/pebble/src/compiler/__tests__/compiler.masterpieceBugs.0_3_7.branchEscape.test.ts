import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB, DataList, Data } from "@harmoniclabs/plutus-data";

// masterpiece BUG 23: rewriting one method's body miscompiled a DIFFERENT
// method. Root cause: the single-reference-under-recursive placement path
// climbed to where the letted's free vars are defined WITHOUT stopping at
// `Case`-branch boundaries (the guard every other climb has): a
// redeemer-field extractor referenced once inside a method's loop escaped
// ABOVE the method dispatch and ran in EVERY arm — `unListData :: not a
// data list` when another method's redeemer held an int there. The
// escaped bindings could additionally NEST across drain-loop rounds and
// capture each other's references via their shared hash-derived binder
// symbols (`headList :: empty list`); with the escape fixed, that nesting
// no longer arises. (A per-site fresh-symbol scheme was tried as a second
// layer of defense and REVERTED: it regressed compilation of previously
// verified contracts — masterpiece BUG 25.)
//
// This test pins the fix with a minimal two-method contract: method `walk`
// uses its List redeemer field ONCE inside a loop; evaluating method `ping`
// (int redeemer) must not crash on `walk`'s escaped extractor.

const SRC = `
contract T {
    mint ping( n: int ) {
        const { tx, policy } = context;
        assert n == 7;
    }

    state A {
        s: int;

        spend walk( items: List<int> ) {
            const { tx } = context;
            let sum: int = 0;
            for( let i = 0; i < 3; i = i + 1 ) {
                sum = sum + items.head();
            }
            assert sum > 0;
        }
    }
}
`;

async function compileIt( src: string ): Promise<Uint8Array> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.compile({ entry: "main.pebble", root: "/" });
    const d = c.diagnostics.map( x => x.toString() ).filter( s => s.startsWith("ERROR") );
    if( d.length ) throw new Error( d[0] );
    return ioApi.outputs.get("out/out.flat")!;
}

const policy = fromHex( "bb".repeat( 28 ) );
function mintCtx( redeemer: Data ): DataConstr {
    const txFields: Data[] = Array.from( { length: 16 }, () => new DataI( 0 ) );
    return new DataConstr( 0, [
        new DataConstr( 0, txFields ),
        redeemer,
        new DataConstr( 0, [ new DataB( policy ) ] ),
    ]);
}

function evalWith( flat: Uint8Array, redeemer: Data ): string {
    const applied = new Application( parseUPLC( flat ).body, UPLCConst.data( mintCtx( redeemer ) ) );
    const r = Machine.evalSimple( applied );
    return r instanceof CEKError ? "ERROR: " + String( r.msg ?? "" ).slice( 0, 70 ) : "ACCEPT";
}

jest.setTimeout( 300_000 );

describe("masterpiece bug 23 — one method's loop extractor must not escape into other methods' arms", () => {

    let flat: Uint8Array;
    beforeAll( async () => { flat = await compileIt( SRC ); } );

    test("method with INT redeemer accepts (list-extractor from the other method must not run)", () => {
        // redeemer: ping( 7 ) — tag 0, fields [ I 7 ]
        // pre-fix: `unListData :: not a data list` from walk's escaped extractor
        expect( evalWith( flat, new DataConstr( 0, [ new DataI( 7 ) ] ) ) ).toBe( "ACCEPT" );
    });

    test("the loop method itself still works (spend path)", () => {
        // spend ctx: state A datum, redeemer walk([1,2,3])
        const datum = new DataConstr( 0, [ new DataI( 1 ) ] );
        const spendCtx = new DataConstr( 0, [
            new DataConstr( 0, Array.from( { length: 16 }, () => new DataI( 0 ) ) ),
            new DataConstr( 0, [ new DataList([ new DataI(1), new DataI(2), new DataI(3) ]) ] ),
            new DataConstr( 1, [
                new DataConstr( 0, [ new DataB( fromHex("aa".repeat(32)) ), new DataI( 0 ) ] ),
                new DataConstr( 0, [ datum ] ),
            ]),
        ]);
        const applied = new Application( parseUPLC( flat ).body, UPLCConst.data( spendCtx ) );
        const r = Machine.evalSimple( applied );
        const msg = r instanceof CEKError ? "ERROR: " + String( r.msg ?? "" ).slice( 0, 70 ) : "ACCEPT";
        expect( msg ).toBe( "ACCEPT" );
    });
});
