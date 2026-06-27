import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { Application, UPLCConst, parseUPLC } from "@harmoniclabs/uplc";
import { CEKConst, CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataList, DataB, DataI, Data } from "@harmoniclabs/plutus-data";

// Community bug reports (github.com/maxalexweber1/pebble/tree/main/bugs).

async function compileContract( src: string ) {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.compile({ entry: "main.pebble", root: "/" });
    return {
        output: ioApi.outputs.get("out/out.flat"),
        diagnostics: c.diagnostics.map( d => d.toString() ),
    };
}

describe("community bug 1 — `invalid deBruijn index` (lone indexed spend + >=2 mints)", () => {
    // A single `spend` doing indexed UTxO access (`tx.inputs[i]`) together with
    // two or more `mint` methods crashed IR->UPLC lowering with a NEGATIVE de
    // Bruijn index. Root cause: de Bruijn resolution used a tree-wide
    // symbol->context map (last writer wins), which is wrong when a binder
    // symbol appears in sibling scopes (here the shared `const { tx } = context`
    // duplicated across the purpose-match cases). Now resolved lexically.
    test("compiles without throwing", async () => {
        const { output, diagnostics } = await compileContract(`
contract DebruijnRepro {
    mint m1() { const { tx, policy } = context; assert tx.mint.amountOf( policy, # ) == 1; }
    mint m2() { const { tx, policy } = context; assert tx.mint.amountOf( policy, # ) < 0; }
    spend idx( i: int ) {
        const { tx, spendingRef } = context;
        const { ref, resolved } = tx.inputs[ i ];
        assert spendingRef == ref;
        assert resolved.address.payment.hash() == #;
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    // Also exercise the bisection neighbours that already worked, so the
    // resolver stays correct across method-count combinations.
    test("neighbouring shapes still compile (2 mint/2 spend, 1 mint/1 spend)", async () => {
        const twoTwo = await compileContract(`
contract C {
    mint m1() { const { tx, policy } = context; assert tx.mint.amountOf( policy, # ) == 1; }
    mint m2() { const { tx, policy } = context; assert tx.mint.amountOf( policy, # ) < 0; }
    spend a( i: int ) { const { tx } = context; const x = tx.inputs[ i ]; assert x.ref.index >= 0; }
    spend b( j: int ) { const { tx } = context; const y = tx.outputs[ j ]; assert y.value.lovelaces() >= 0; }
}
`);
        expect( twoTwo.diagnostics ).toEqual( [] );
        expect( twoTwo.output instanceof Uint8Array ).toBe( true );
    });
});

// Bug 2 in the report ("`this.<scalar-param>` evaluates to a wrong REJECT") is
// NOT a compiler bug: contract parameters are contract CONSTANTS, applied
// directly as their (native) type — there is no data decoding. `this.<name>`
// is sugar for reading the parameter. The report's harness data-encoded the
// scalar param (`bData(owner)`); that is the wrong representation for a
// native-typed param (a struct param happens to work because its native
// representation already IS data). Applied natively, it ACCEPTs — locked in
// below so neither the intended behaviour nor an accidental decode regresses.
describe("community bug 2 — `this.<scalar-param>` is intended behaviour", () => {

    const owner = fromHex( "aa".repeat( 28 ) );
    const policy = fromHex( "bb".repeat( 28 ) );

    function ctxData( signers: DataB[] ): DataConstr {
        const txFields: Data[] = Array.from( { length: 16 }, () => new DataI( 0 ) );
        txFields[8] = new DataList( signers ); // Tx.requiredSigners
        return new DataConstr( 0, [
            new DataConstr( 0, txFields ),          // tx
            new DataConstr( 0, [] ),                // redeemer
            new DataConstr( 0, [ new DataB( policy ) ] ), // purpose = Mint{ policy }
        ]);
    }

    async function mintValidator( src: string ) {
        const { output, diagnostics } = await compileContract( src );
        expect( diagnostics ).toEqual( [] );
        return parseUPLC( output as Uint8Array ).body;
    }

    function runNativeOwner( validator: any, ownerArg: Uint8Array, signers: Uint8Array[] ): string {
        // param applied DIRECTLY as its native type (a bytestring const), then ctx
        const applied = new Application(
            new Application( validator, UPLCConst.byteString( ownerArg as any ) ),
            UPLCConst.data( ctxData( signers.map( s => new DataB( s ) ) ) )
        );
        const r = Machine.evalSimple( applied );
        if( r instanceof CEKError ) return "REJECT";
        if( r instanceof CEKConst ) return "ACCEPT";
        return "OTHER";
    }

    test("scalar `this.owner`, param applied natively → ACCEPT when present", async () => {
        const v = await mintValidator(
            `contract R { param owner: bytes; mint probe() { const { tx } = context; assert tx.requiredSigners.includes( this.owner ); } }`
        );
        expect( runNativeOwner( v, owner, [ owner ] ) ).toBe( "ACCEPT" );
        // and correctly REJECTs when the owner is NOT a required signer
        expect( runNativeOwner( v, owner, [ fromHex( "cc".repeat( 28 ) ) ] ) ).toBe( "REJECT" );
    });
});
