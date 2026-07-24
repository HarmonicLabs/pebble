import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB, Data } from "@harmoniclabs/plutus-data";

// masterpiece BUG 20: `State.md` documents that a bare contract-level
// `spend` runs when the datum "doesn't match any declared state's
// constructor, OR with no datum at all" — but only the no-datum case
// worked. The state dispatch lowered to a bare `case` over the state
// constructors, so an unknown constructor tag crashed with
// "constructor tag N out of range" and a non-constructor datum crashed
// inside `unConstrData`, in both cases BEFORE the fallback could run.
// The dispatch is now guarded (chooseData + tag range check) and routes
// both ill-formed shapes to the bare `spend`.

const SRC = `
contract T3 {
    state A {
        v: int;

        spend a1() {
            const { tx, state: { v } } = context;
            assert v == 1;
        }
        spend a2() { const { tx } = context; assert 1 == 2; }
    }
    state B {
        w: int;

        spend b1() { const { tx } = context; assert 1 == 2; }
        spend b2() { const { tx } = context; assert 1 == 2; }
    }

    spend recover() {
        const { tx } = context;
        assert 1 == 1;
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

// spend ctx: DataConstr(0, [ tx, redeemer, Spend{ ref, optionalDatum } ])
function spendCtx( optionalDatum: Data, redeemer: Data ): DataConstr {
    const txFields: Data[] = Array.from( { length: 16 }, () => new DataI( 0 ) );
    const ref = new DataConstr( 0, [ new DataB( fromHex("aa".repeat(32)) ), new DataI( 0 ) ] );
    return new DataConstr( 0, [
        new DataConstr( 0, txFields ),
        redeemer,
        new DataConstr( 1, [ ref, optionalDatum ] ),
    ]);
}

const someDatum = ( d: Data ) => new DataConstr( 0, [ d ] );
const noDatum = new DataConstr( 1, [] );
const rdm = new DataConstr( 0, [] ); // first method of each union, no args

function evalWith( flat: Uint8Array, optionalDatum: Data ): string {
    const applied = new Application(
        parseUPLC( flat ).body,
        UPLCConst.data( spendCtx( optionalDatum, rdm ) )
    );
    const r = Machine.evalSimple( applied );
    return r instanceof CEKError ? "ERROR: " + String( r.msg ?? "" ).slice( 0, 70 ) : "ACCEPT";
}

jest.setTimeout( 300_000 );

describe("masterpiece bug 20 — bare fallback `spend` reachable for ill-formed datums", () => {

    let flat: Uint8Array;
    beforeAll( async () => { flat = await compileIt( SRC ); } );

    test("valid state datum still dispatches to the state method", () => {
        // state A (tag 0), v = 1, method a1 accepts
        expect( evalWith( flat, someDatum( new DataConstr( 0, [ new DataI( 1 ) ] ) ) ) ).toBe( "ACCEPT" );
    });

    test("valid state datum with failing method still fails", () => {
        // state B (tag 1), method b1 asserts false
        expect( evalWith( flat, someDatum( new DataConstr( 1, [ new DataI( 9 ) ] ) ) ) ).toContain( "ERROR" );
    });

    test("unknown constructor tag routes to the bare spend fallback", () => {
        // pre-fix: "case: constructor tag 5 out of range (2 branches)"
        expect( evalWith( flat, someDatum( new DataConstr( 5, [ new DataI( 1 ) ] ) ) ) ).toBe( "ACCEPT" );
    });

    test("non-constructor datum routes to the bare spend fallback", () => {
        // pre-fix: "unConstrData :: not a data constructor"
        expect( evalWith( flat, someDatum( new DataI( 42 ) ) ) ).toBe( "ACCEPT" );
    });

    test("no datum routes to the bare spend fallback (already worked)", () => {
        expect( evalWith( flat, noDatum ) ).toBe( "ACCEPT" );
    });
});
