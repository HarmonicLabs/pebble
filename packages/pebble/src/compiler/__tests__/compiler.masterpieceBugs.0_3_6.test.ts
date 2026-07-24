import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKConst, CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataList, DataB, DataI, Data } from "@harmoniclabs/plutus-data";

// Bug reports from `the-cardano-masterpiece` (PEBBLE_BUGS.md, against 0.3.6).
//
// BUG 12 — miscompiled UPLC at runtime: executing one mint method fails with
// `force tailList []` / `force headList []` in ANOTHER method's field
// extractors — the letted extraction for a 3-field redeemer floats above the
// dispatch and is evaluated eagerly against a 1-field redeemer payload.
// Repro shape mirrors the `ownership.pebble` o4 probe: `init` (1 redeemer
// field, trivial body), `free`, full `split` (3 struct fields + shared
// helpers), plus a state with a heavy spend method for the sharing level.

const RECT = `
export const CANVAS_SIZE = 1024;

export struct Coordinates {
    x0: int,
    y0: int,
    x1: int,
    y1: int
}

export function isValidRect( r: Coordinates ): boolean {
    return 0 <= r.x0 && r.x0 < r.x1 && r.x1 <= CANVAS_SIZE
        && 0 <= r.y0 && r.y0 < r.y1 && r.y1 <= CANVAS_SIZE;
}

export function rectContains( outer: Coordinates, inner: Coordinates ): boolean {
    return outer.x0 <= inner.x0 && inner.x1 <= outer.x1
        && outer.y0 <= inner.y0 && inner.y1 <= outer.y1;
}

export function rectArea( r: Coordinates ): int {
    return (r.x1 - r.x0) * (r.y1 - r.y0);
}

export function isGuillotineCut( p: Coordinates, a: Coordinates, b: Coordinates ): boolean {
    const verticalCut =
        a.x0 == p.x0 && a.x1 == b.x0 && b.x1 == p.x1
        && a.y0 == p.y0 && a.y1 == p.y1
        && b.y0 == p.y0 && b.y1 == p.y1
        && a.x0 < a.x1 && b.x0 < b.x1;
    const horizontalCut =
        a.y0 == p.y0 && a.y1 == b.y0 && b.y1 == p.y1
        && a.x0 == p.x0 && a.x1 == p.x1
        && b.x0 == p.x0 && b.x1 == p.x1
        && a.y0 < a.y1 && b.y0 < b.y1;
    return verticalCut || horizontalCut;
}

const NAME_PREFIX = #6d617374657270696563652d;

function decDigit( d: int ): bytes {
    return std.builtins.replicateByte( 1, 48 + d );
}

function decNum( v: int ): bytes {
    const last = decDigit( v % 10 );
    return v < 10 ? last
        : v < 100 ? std.bytes.concat( decDigit( v / 10 ), last )
        : v < 1000 ? std.bytes.concat(
            std.bytes.concat( decDigit( v / 100 ), decDigit( (v / 10) % 10 ) ), last )
        : std.bytes.concat(
            std.bytes.concat( decDigit( v / 1000 ), decDigit( (v / 100) % 10 ) ),
            std.bytes.concat( decDigit( (v / 10) % 10 ), last ) );
}

export function rectName( r: Coordinates ): bytes {
    return std.bytes.concat(
        std.bytes.concat(
            NAME_PREFIX,
            std.bytes.concat( decNum( r.x0 ), std.bytes.concat( #2d, decNum( r.y0 ) ) ) ),
        std.bytes.concat(
            std.bytes.concat( #2d, decNum( r.x1 ) ),
            std.bytes.concat( #2d, decNum( r.y1 ) ) )
    );
}
`;

const OWNERSHIP = `
import {
    CANVAS_SIZE,
    Coordinates,
    isValidRect,
    rectContains,
    rectArea,
    isGuillotineCut,
    rectName
} from "./rect.pebble";

const LOVELACE_PER_PIXEL = 5_000_000;
const FREE_TOKEN_NAME = #;

function valueEq( a: Value, b: Value ): boolean {
    return a.contains( b ) && b.contains( a );
}

function isFreeNodeOut(
    o: TxOut, ownAddr: Address, ownPolicy: bytes, expected: Coordinates
): boolean {
    const InlineDatum{ datum: dData } = o.datum;
    const d = dData as Coordinates;
    return o.address == ownAddr
        && o.value.amountOf( ownPolicy, FREE_TOKEN_NAME ) == 1
        && d.x0 == expected.x0 && d.y0 == expected.y0
        && d.x1 == expected.x1 && d.y1 == expected.y1;
}

contract Ownership {

    param protocolOwner: Address;

    // trivial body ON PURPOSE: a correct compilation of this method ACCEPTS
    // regardless of the transaction; a miscompilation that eagerly runs
    // another method's redeemer field extractors crashes on this method's
    // 1-field redeemer payload
    mint init(
        genesisUtxoIdx: int
    ) {
        const { tx, policy } = context;
        assert true;
    }

    mint free() {
        const { tx, policy } = context;

        const ownAddr = Address.Address{
            payment: Credential.Script{ hash: policy },
            stake: undefined
        };

        assert tx.inputs.some( i =>
            i.resolved.address == ownAddr
            && i.resolved.value.amountOf( policy, FREE_TOKEN_NAME ) == 1
        );
    }

    mint split(
        parent: Coordinates,
        a: Coordinates,
        b: Coordinates
    ) {
        const { tx, policy } = context;

        assert isGuillotineCut( parent, a, b );

        assert valueEq(
            tx.mint,
            tx.mint.scale( 0 )
                .insert( policy, rectName( parent ), -1 )
                .insert( policy, rectName( a ), 1 )
                .insert( policy, rectName( b ), 1 )
        );
    }

    state Free {
        coords: Coordinates;

        spend claim(
            claimed: Coordinates
        ) {
            const { tx, spendingRef, state: { coords } } = context;

            const Some{ value: ownInput } = tx.inputs.find( i => i.ref == spendingRef );
            const ownAddr = ownInput.resolved.address;
            const ownPolicy = ownAddr.payment.hash();

            assert ownInput.resolved.value.amountOf( ownPolicy, FREE_TOKEN_NAME ) == 1;
            assert tx.inputs.filter( i => i.resolved.address == ownAddr ).length() == 1;

            assert isValidRect( claimed );
            assert rectContains( coords, claimed );

            const protocolOwner = this.protocolOwner;
            const Some{ value: payOut } = tx.outputs.find( o => o.address == protocolOwner );
            assert payOut.value.lovelaces() >= rectArea( claimed ) * LOVELACE_PER_PIXEL;

            const freeOuts = tx.outputs.filter( o => o.address == ownAddr );
            let k = 0;
            if( coords.y0 < claimed.y0 ) {
                assert isFreeNodeOut( freeOuts[k], ownAddr, ownPolicy,
                    Coordinates.Coordinates{ x0: coords.x0, y0: coords.y0, x1: coords.x1, y1: claimed.y0 } );
                k = k + 1;
            }
            if( claimed.y1 < coords.y1 ) {
                assert isFreeNodeOut( freeOuts[k], ownAddr, ownPolicy,
                    Coordinates.Coordinates{ x0: coords.x0, y0: claimed.y1, x1: coords.x1, y1: coords.y1 } );
                k = k + 1;
            }
            if( coords.x0 < claimed.x0 ) {
                assert isFreeNodeOut( freeOuts[k], ownAddr, ownPolicy,
                    Coordinates.Coordinates{ x0: coords.x0, y0: claimed.y0, x1: claimed.x0, y1: claimed.y1 } );
                k = k + 1;
            }
            if( claimed.x1 < coords.x1 ) {
                assert isFreeNodeOut( freeOuts[k], ownAddr, ownPolicy,
                    Coordinates.Coordinates{ x0: claimed.x1, y0: claimed.y0, x1: coords.x1, y1: claimed.y1 } );
                k = k + 1;
            }
            assert freeOuts.length() == k;
        }
    }
}
`;

async function compileOwnership() {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([
            [ "main.pebble", fromUtf8( OWNERSHIP ) ],
            [ "rect.pebble", fromUtf8( RECT ) ],
        ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.compile({ entry: "main.pebble", root: "/" });
    return {
        output: ioApi.outputs.get("out/out.flat"),
        diagnostics: c.diagnostics.map( d => d.toString() ),
    };
}

const policy = fromHex( "bb".repeat( 28 ) );

function scriptAddressData(): DataConstr {
    // Address{ payment: Script{ hash }, stake: None }
    return new DataConstr( 0, [
        new DataConstr( 1, [ new DataB( policy ) ] ), // Credential.Script
        new DataConstr( 1, [] ),                      // no stake
    ]);
}

function mintCtxData( redeemer: Data ): DataConstr {
    const txFields: Data[] = Array.from( { length: 16 }, () => new DataI( 0 ) );
    return new DataConstr( 0, [
        new DataConstr( 0, txFields ),                 // tx (all-zero garbage)
        redeemer,                                      // redeemer
        new DataConstr( 0, [ new DataB( policy ) ] ),  // purpose = Mint{ policy }
    ]);
}

describe("masterpiece bug 12 — one method's redeemer extractors must not run in another's arm", () => {

    // minimal shape: `heavy`'s three field extractors are multi-referenced
    // in a strict position, so the letted-placement pass used to hoist them
    // ABOVE the method dispatch — running them against `ping`'s EMPTY
    // redeemer field list (`force headList []` on-chain)
    test("minimal: ping (0 fields) does not run heavy's (3 fields) extractors", async () => {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([ [ "main.pebble", fromUtf8(`
contract M {
    mint ping() {
        const { tx, policy } = context;
        assert true;
    }
    mint heavy( a: int, b: int, c: int ) {
        const { tx, policy } = context;
        assert a*a + b*b + c*c == a + b + c + 12;
    }
}
`) ] ]),
            useConsoleAsOutput: true,
        });
        const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        await c.compile({ entry: "main.pebble", root: "/" });
        const out = ioApi.outputs.get("out/out.flat");
        expect( out instanceof Uint8Array ).toBe( true );

        const validator = parseUPLC( out! ).body;
        const applied = new Application(
            validator,
            UPLCConst.data( mintCtxData( new DataConstr( 0, [] ) ) )
        );
        const r = Machine.evalSimple( applied );
        if( r instanceof CEKError ) throw new Error( "ping failed: " + String( r.msg ?? "" ) );
        expect( r instanceof CEKConst ).toBe( true );
    });

    test("`init` (1-field redeemer) does not evaluate `split`'s (3-field) extractors", async () => {
        const { output, diagnostics } = await compileOwnership();
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );

        const validator = parseUPLC( output! ).body;

        // direct union tags: init = 0, free = 1, split = 2
        const initRedeemer = new DataConstr( 0, [ new DataI( 0 ) ] );

        const applied = new Application(
            new Application(
                validator,
                UPLCConst.data( scriptAddressData() ) // param protocolOwner
            ),
            UPLCConst.data( mintCtxData( initRedeemer ) )
        );

        const result = Machine.evalSimple( applied );

        if( result instanceof CEKError )
        {
            // the bug manifests as `tailList`/`headList` on an empty list:
            // `split`'s field extractors applied to `init`'s 1-field payload
            const msg = String( result.msg ?? "" );
            expect( msg ).not.toMatch( /tailList|headList/ );
            // any other CEKError would mean the trivial `assert true` body
            // failed some other way — equally a miscompilation
            throw new Error( "init arm failed: " + msg );
        }
        expect( result instanceof CEKConst ).toBe( true );
    });
});

describe("IR rewrite pass — stale nodes must not clobber the root", () => {

    // found while hunting bug 11: `rewriteNativesAppliedToConstantsAndReturnRoot`
    // kept queued descendants of already-replaced subtrees on its work stack;
    // rewriting such a DETACHED node hit the "no parent → this is the root"
    // branch and silently replaced the whole program with a fragment of the
    // dead subtree (surfacing later as `trying to increment use of variable
    // not in context` on an unbound `fieldsList`).
    test("two states sharing a helper called inside a capturing lambda compile", async () => {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([ [ "main.pebble", fromUtf8(`
function payCheck( o: TxOut, cred: Credential, minLovelaces: int ): boolean {
    return o.address.payment == cred && o.value.lovelaces() >= minLovelaces;
}

contract T {
    state A {
        n: int
        spend sa( x: int ) {
            const { tx, state: { n } } = context;
            assert tx.outputs.some( o => payCheck( o, tx.inputs[0].resolved.address.payment, x ) );
        }
    }
    state B {
        m: int
        spend sb() {
            const { tx, state: { m } } = context;
            assert tx.outputs.some( o => payCheck( o, tx.inputs[0].resolved.address.payment, 1 ) );
        }
    }
}
`) ] ]),
            useConsoleAsOutput: true,
        });
        const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        await c.compile({ entry: "main.pebble", root: "/" });
        expect( c.diagnostics.map( d => d.toString() ) ).toEqual( [] );
        expect( ioApi.outputs.get("out/out.flat") instanceof Uint8Array ).toBe( true );
    });
});

describe("masterpiece bug 12b — extractors shared across arms are duplicated per branch", () => {

    // when TWO arms share hash-identical field extractors (same dispatch,
    // same field index and type), their references' LCA sits at/above the
    // dispatch and the branch-boundary stop can never trigger — the shared
    // binding ran in EVERY arm. It must be duplicated per branch instead.
    test("ping (0 fields) with TWO sibling 3-field methods still accepts", async () => {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([ [ "main.pebble", fromUtf8(`
contract M {
    mint ping() {
        const { tx, policy } = context;
        assert true;
    }
    mint heavyA( a: int, b: int, c: int ) {
        const { tx, policy } = context;
        assert a*a + b*b + c*c == a + b + c + 12;
    }
    mint heavyB( x: int, y: int, z: int ) {
        const { tx, policy } = context;
        assert x + y*y + z*z*z == x*y*z + 7;
    }
}
`) ] ]),
            useConsoleAsOutput: true,
        });
        const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        await c.compile({ entry: "main.pebble", root: "/" });
        const out = ioApi.outputs.get("out/out.flat");
        expect( out instanceof Uint8Array ).toBe( true );

        const applied = new Application(
            parseUPLC( out! ).body,
            UPLCConst.data( mintCtxData( new DataConstr( 0, [] ) ) )
        );
        const r = Machine.evalSimple( applied );
        if( r instanceof CEKError ) throw new Error( "ping failed: " + String( r.msg ?? "" ) );
        expect( r instanceof CEKConst ).toBe( true );
    });
});
