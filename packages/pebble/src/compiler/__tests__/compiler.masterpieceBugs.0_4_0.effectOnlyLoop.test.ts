import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, showUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB, DataMap, DataList, DataPair, Data } from "@harmoniclabs/plutus-data";

// masterpiece BUG 26 (CRITICAL, security): a loop whose checks are its ONLY
// purpose was DELETED from the compiled script.
//
// Reported symptom: the masterpiece `LeafNode.edit` ownership guard — for
// every claimed rect, find the reference input holding that deed and require
// its holder's signature — passed even when NO such reference input existed,
// so anyone could overwrite anyone's pixels. `const Some{ value } = find(…)`
// looked like it was not failing on a `None`.
//
// Actual root cause: the loop's ONLY reassigned variable (`refRects`, walked
// with `.tail()`) is dead AFTER the loop, so the whole loop is evaluated only
// for its asserts' effect. The bare-loop lowering bound the loop's result as
// a LETTED constant, and letteds only materialize where they are referenced —
// with no reference, the binding, and with it the entire loop, never made it
// into the output. `isSafeToEagerlyEvaluate` cannot catch this downstream
// either: a loop is a fixpoint `(λrecBody. … recBody …) loopBodyFunc`, whose
// body it treats as an unapplied, never-runs argument (see the note there).
//
// Fix: only take the bare-lowering shortcut when the reassigned variable is
// actually READ after the loop. Otherwise keep the SoP path, where the loop
// call is an `IRCase` scrutinee and therefore always evaluated.
//
// These tests pin the whole CLASS (any effect-only loop), not just the
// reported `find` shape.

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

/** minimal mint script context; `tx` fields are dummies (lazily decoded) */
function mintCtx( redeemer: Data ): DataConstr {
    return new DataConstr( 0, [
        new DataConstr( 0, Array.from( { length: 16 }, () => new DataI( 0 ) ) ),
        redeemer,
        new DataConstr( 0, [ new DataB( policy ) ] ),
    ]);
}
function evalWith( flat: Uint8Array, redeemer: Data ): "ACCEPT" | "ERROR" {
    const applied = new Application( parseUPLC( flat ).body, UPLCConst.data( mintCtx( redeemer ) ) );
    return Machine.evalSimple( applied ) instanceof CEKError ? "ERROR" : "ACCEPT";
}
/** redeemer for a single-method contract taking one `List<int>` */
const intList = ( ns: number[] ) => new DataConstr( 0, [ new DataList( ns.map( n => new DataI( n ) ) ) ] );

jest.setTimeout( 300_000 );

describe("masterpiece bug 26 — a loop that exists only for its checks must not be deleted", () => {

    // ---- the general class ------------------------------------------------

    test("for-loop kept only for its asserts still runs (and runs EVERY iteration)", async () => {
        const flat = await compileIt(`
contract T {
    mint go( xs: List<int> ) {
        const { tx, policy } = context;
        let rest = xs;
        for( let n = 0; n < 3; n++ ) {
            assert rest.head() != 99;
            rest = rest.tail();
        }
    }
}`);
        // pre-fix this contract compiled to a ~36-byte "always accept" script
        expect( evalWith( flat, intList([ 1, 2, 3 ]) ) ).toBe( "ACCEPT" );
        // a violation in ANY position must be caught: proves all 3 iterations run
        expect( evalWith( flat, intList([ 99, 2, 3 ]) ) ).toBe( "ERROR" );
        expect( evalWith( flat, intList([ 1, 99, 3 ]) ) ).toBe( "ERROR" );
        expect( evalWith( flat, intList([ 1, 2, 99 ]) ) ).toBe( "ERROR" );
        // and the loop must not over-run: 3 `.tail()`s on a 3-element list is
        // exactly enough, a 4th iteration would fail on the empty list
        expect( evalWith( flat, intList([ 1, 2, 3, 99 ]) ) ).toBe( "ACCEPT" );
    });

    test("while-loop kept only for its asserts still runs", async () => {
        const flat = await compileIt(`
contract T {
    mint go( xs: List<int> ) {
        const { tx, policy } = context;
        let rest = xs;
        while( !rest.isEmpty() ) {
            assert rest.head() != 99;
            rest = rest.tail();
        }
    }
}`);
        expect( evalWith( flat, intList([ 1, 2, 3 ]) ) ).toBe( "ACCEPT" );
        expect( evalWith( flat, intList([ 1, 99 ]) ) ).toBe( "ERROR" );
        expect( evalWith( flat, intList([ 99 ]) ) ).toBe( "ERROR" );
    });

    test("for-of loop kept only for its asserts still runs", async () => {
        const flat = await compileIt(`
contract T {
    mint go( xs: List<int> ) {
        const { tx, policy } = context;
        for( const x of xs ) {
            assert x != 99;
        }
    }
}`);
        expect( evalWith( flat, intList([ 1, 2, 3 ]) ) ).toBe( "ACCEPT" );
        expect( evalWith( flat, intList([ 1, 2, 99 ]) ) ).toBe( "ERROR" );
    });

    test("two sequential effect-only loops: BOTH survive", async () => {
        const flat = await compileIt(`
contract T {
    mint go( xs: List<int> ) {
        const { tx, policy } = context;
        let a = xs;
        for( let n = 0; n < 2; n++ ) {
            assert a.head() != 98;
            a = a.tail();
        }
        let b = xs;
        for( let n = 0; n < 2; n++ ) {
            assert b.head() != 99;
            b = b.tail();
        }
    }
}`);
        expect( evalWith( flat, intList([ 1, 2 ]) ) ).toBe( "ACCEPT" );
        expect( evalWith( flat, intList([ 98, 2 ]) ) ).toBe( "ERROR" ); // first loop
        expect( evalWith( flat, intList([ 1, 99 ]) ) ).toBe( "ERROR" ); // second loop
    });

    test("effect-only loop nested inside an effect-only loop: both survive", async () => {
        const flat = await compileIt(`
contract T {
    mint go( xs: List<int> ) {
        const { tx, policy } = context;
        let outer = xs;
        for( let i = 0; i < 2; i++ ) {
            let inner = xs;
            for( let j = 0; j < 2; j++ ) {
                assert inner.head() != 99;
                inner = inner.tail();
            }
            assert outer.head() != 98;
            outer = outer.tail();
        }
    }
}`);
        expect( evalWith( flat, intList([ 1, 2 ]) ) ).toBe( "ACCEPT" );
        expect( evalWith( flat, intList([ 1, 99 ]) ) ).toBe( "ERROR" ); // inner
        expect( evalWith( flat, intList([ 98, 2 ]) ) ).toBe( "ERROR" ); // outer
    });

    test("the loop-result optimization still works when the variable IS read after", async () => {
        const flat = await compileIt(`
contract T {
    mint go( xs: List<int> ) {
        const { tx, policy } = context;
        let rest = xs;
        for( let n = 0; n < 2; n++ ) {
            assert rest.head() != 99;
            rest = rest.tail();
        }
        assert rest.head() == 7;
    }
}`);
        expect( evalWith( flat, intList([ 1, 2, 7 ]) ) ).toBe( "ACCEPT" );
        expect( evalWith( flat, intList([ 1, 2, 8 ]) ) ).toBe( "ERROR" ); // post-loop check
        expect( evalWith( flat, intList([ 1, 99, 7 ]) ) ).toBe( "ERROR" ); // in-loop check
    });

    // Structural invariant, independent of any evaluation: the constant the
    // in-loop assert compares against must still appear in the compiled
    // script. If a future pass deletes the loop again this fails loudly even
    // if some evaluation harness change hid the behavioural symptom.
    // (Asserts lower to a single-branch `case`, so there is no literal
    // `(error)` node to look for — an unmet assert fails with
    // "constructor tag 1 out of range".)
    test("structural: the in-loop check survives into the compiled script", async () => {
        const flat = await compileIt(`
contract T {
    mint go( xs: List<int> ) {
        const { tx, policy } = context;
        let rest = xs;
        for( let n = 0; n < 2; n++ ) {
            assert rest.head() != 91827;
            rest = rest.tail();
        }
    }
}`);
        expect( showUPLC( parseUPLC( flat ).body ) ).toContain( "91827" );
    });

    // ---- the reported symptom: refutable destructure of a `find` miss -----

    const box = ( v: number ) => new DataConstr( 0, [ new DataI( v ) ] );

    test("`const Some{…} = xs.find(…)` traps on a miss", async () => {
        const flat = await compileIt(`
struct Box { v: int }
contract T {
    mint go( xs: List<Box> ) {
        const { tx, policy } = context;
        const Some{ value: b } = xs.find( x => x.v == 42 );
        assert b.v == 42;
    }
}`);
        expect( evalWith( flat, new DataConstr( 0, [ new DataList([ box(1), box(42) ]) ] ) ) ).toBe( "ACCEPT" );
        expect( evalWith( flat, new DataConstr( 0, [ new DataList([ box(1), box(2) ]) ] ) ) ).toBe( "ERROR" );
        expect( evalWith( flat, new DataConstr( 0, [ new DataList([]) ] ) ) ).toBe( "ERROR" );
    });

    test("in-loop `const Some{…} = xs.find(…)` traps on a miss", async () => {
        const flat = await compileIt(`
struct Box { v: int }
contract T {
    mint go( xs: List<Box> ) {
        const { tx, policy } = context;
        let rest = xs;
        for( let n = 0; n < 2; n++ ) {
            // copied into a const: lambdas may only capture consts
            const probe = rest.head().v;
            const Some{ value: b } = xs.find( x => x.v == probe );
            assert b.v > 0;
            rest = rest.tail();
        }
    }
}`);
        // every probed value is present, so every `find` hits
        expect( evalWith( flat, new DataConstr( 0, [ new DataList([ box(1), box(2) ]) ] ) ) ).toBe( "ACCEPT" );
        // a non-positive value makes the in-loop assert fail (loop must run)
        expect( evalWith( flat, new DataConstr( 0, [ new DataList([ box(1), box(0) ]) ] ) ) ).toBe( "ERROR" );
    });

    // ---- the exact reported contract shape (ownership guard) --------------

    const holderPkh = fromHex( "11".repeat( 28 ) );
    const someRef = new DataConstr( 0, [ new DataB( fromHex("aa".repeat(32)) ), new DataI( 0 ) ] );
    const holderAddr = new DataConstr( 0, [
        new DataConstr( 0, [ new DataB( holderPkh ) ] ), // PubKey credential
        new DataConstr( 1, [] ),                         // no stake
    ]);
    const deedValue = ( name: Uint8Array ) => new DataMap([
        new DataPair( new DataB( new Uint8Array(0) ),
            new DataMap([ new DataPair( new DataB( new Uint8Array(0) ), new DataI( 2_000_000 ) ) ]) ),
        new DataPair( new DataB( policy ),
            new DataMap([ new DataPair( new DataB( name ), new DataI( 1 ) ) ]) ),
    ]);
    const deedIn = ( name: Uint8Array ) => new DataConstr( 0, [ someRef,
        new DataConstr( 0, [ holderAddr, deedValue( name ),
            new DataConstr( 0, [] ), new DataConstr( 1, [] ) ] ) ]);

    function evalGuard( flat: Uint8Array, names: Uint8Array[], refInputs: Data[], signers: Uint8Array[] = [ holderPkh ] ) {
        const tx = new DataConstr( 0, [
            new DataList([]),                       // inputs
            new DataList( refInputs ),              // refInputs
            new DataList([]),                       // outputs
            new DataI( 0 ), new DataMap([]), new DataList([]), new DataMap([]),
            new DataI( 0 ),
            new DataList( signers.map( s => new DataB( s ) ) ), // requiredSigners
            new DataMap([]), new DataMap([]),
            new DataB( fromHex("dd".repeat(32)) ),
            new DataMap([]), new DataList([]),
            new DataConstr( 1, [] ), new DataConstr( 1, [] ),
        ]);
        const ctx = new DataConstr( 0, [
            tx,
            new DataConstr( 0, [ new DataList( names.map( n => new DataB( n ) ) ) ] ),
            new DataConstr( 0, [ new DataB( policy ) ] ),
        ]);
        const applied = new Application( parseUPLC( flat ).body, UPLCConst.data( ctx ) );
        return Machine.evalSimple( applied ) instanceof CEKError ? "ERROR" : "ACCEPT";
    }

    // `masterpiece.pebble` LeafNode.edit, reduced: the dynamic bound
    // (`names.length()`) and the `.tail()` walk are both needed to reproduce
    // the exact lowering that was deleted.
    const OWNERSHIP_GUARD = `
contract T {
    mint go( names: List<bytes> ) {
        const { tx, policy } = context;
        const nNames = names.length();
        let rest = names;
        for( let n = 0; n < nNames; n++ ) {
            const nm = rest.head();
            const Some{ value: refIn } = tx.refInputs.find( i =>
                i.resolved.value.amountOf( policy, nm ) == 1 );
            const PubKey{ hash: holder } = refIn.resolved.address.payment;
            assert tx.requiredSigners.includes( holder );
            rest = rest.tail();
        }
    }
}`;

    test("ownership guard: referenced deed + holder signature accepts", async () => {
        const flat = await compileIt( OWNERSHIP_GUARD );
        const nm = fromUtf8("AA");
        expect( evalGuard( flat, [ nm ], [ deedIn( nm ) ] ) ).toBe( "ACCEPT" );
    });

    test("ownership guard: NO matching reference input traps (the reported bypass)", async () => {
        const flat = await compileIt( OWNERSHIP_GUARD );
        const asked = fromUtf8("BB"), held = fromUtf8("AA");
        // pre-fix: ACCEPT — you could edit pixels of a deed you did not own
        expect( evalGuard( flat, [ asked ], [ deedIn( held ) ] ) ).toBe( "ERROR" );
        expect( evalGuard( flat, [ asked ], [] ) ).toBe( "ERROR" );
    });

    test("ownership guard: deed referenced but holder did NOT sign traps", async () => {
        const flat = await compileIt( OWNERSHIP_GUARD );
        const nm = fromUtf8("AA");
        expect( evalGuard( flat, [ nm ], [ deedIn( nm ) ], [] ) ).toBe( "ERROR" );
        expect( evalGuard( flat, [ nm ], [ deedIn( nm ) ], [ fromHex("22".repeat(28)) ] ) ).toBe( "ERROR" );
    });

    test("ownership guard: EVERY requested name is checked, not just the first", async () => {
        const flat = await compileIt( OWNERSHIP_GUARD );
        const held = fromUtf8("AA"), notHeld = fromUtf8("BB");
        // first name is fine, second has no deed -> must still trap
        expect( evalGuard( flat, [ held, notHeld ], [ deedIn( held ) ] ) ).toBe( "ERROR" );
    });
});
