import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { Application, UPLCConst, parseUPLC } from "@harmoniclabs/uplc";
import { CEKConst, CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, Data } from "@harmoniclabs/plutus-data";

// Community bug reports (the-cardano-masterpiece, against 0.3.4).

async function compile( src: string ) {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.compile({ entry: "main.pebble", root: "/" });
    return { output: ioApi.outputs.get("out/out.flat"), diagnostics: c.diagnostics.map( d => d.toString() ) };
}

describe("List.length()", () => {
    test("computes the correct count", async () => {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([ [ "main.pebble", fromUtf8( `trace [ #aa, #bb, #cc, #dd ].length();` ) ] ]),
            useConsoleAsOutput: true,
        });
        const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        const r = await c.run({ entry: "main.pebble", root: "/" });
        expect( c.diagnostics.map( d => d.toString() ) ).toEqual( [] );
        expect( r.logs ).toEqual( [ "4" ] );
    });
});

describe("bug7 — bls12_381 multiScalarMul is surfaced", () => {
    test("`std.crypto.bls12_381.multiScalarMul` resolves", async () => {
        const { diagnostics } = await compile(
            `contract C { spend s(redeemer: data) { const { tx } = context; let g = std.crypto.bls12_381.multiScalarMul; assert tx.inputs.length() >= 0; } }`
        );
        expect( diagnostics ).toEqual( [] );
    });
});

// L4 is INTENDED behaviour: the spend redeemer is a method-tagged ADT
// (`Constr <methodIdx> [params]`), uniform whether the contract has one spend
// method or many. So a single `spend edit(redeemer)` expects the on-chain
// redeemer to be `Constr 0 [ <your redeemer> ]` and binds `redeemer` to field 0.
// (The report passed the raw `Constr 0 [I 7]`, i.e. without the method selector.)
describe("L4 — spend redeemer is a method-tagged ADT (intended)", () => {
    const txid = fromHex( "11".repeat( 32 ) );

    async function spendValidator( src: string ) {
        const { output, diagnostics } = await compile( src );
        expect( diagnostics ).toEqual( [] );
        return parseUPLC( output as Uint8Array ).body;
    }

    function spendCtx( redeemer: Data ): DataConstr {
        const tx = new DataConstr( 0, Array.from( { length: 16 }, () => new DataI( 0 ) as Data ) );
        const ref = new DataConstr( 0, [ new DataConstr( 0, [ /* DataB */ ] ), new DataI( 0 ) ] );
        const purpose = new DataConstr( 1, [ ref, new DataConstr( 0, [ new DataConstr( 0, [] ) ] ) ] ); // Spend{ ref, datum }
        return new DataConstr( 0, [ tx, redeemer, purpose ] );
    }
    function run( v: any, redeemer: Data ): string {
        const r = Machine.evalSimple( new Application( v, UPLCConst.data( spendCtx( redeemer ) ) ) );
        return r instanceof CEKError ? "REJECT" : ( r instanceof CEKConst ? "ACCEPT" : "OTHER" );
    }

    test("redeemer with the method selector `Constr 0 [ <R> ]` is accepted; the raw `<R>` is not", async () => {
        const v = await spendValidator(
            `struct R { a: int } contract L4 { spend edit(redeemer: data) { const { tx } = context; let r = redeemer as R; assert r.a >= 0; } }`
        );
        const innerR = new DataConstr( 0, [ new DataI( 7 ) ] ); // R{ a: 7 }
        expect( run( v, new DataConstr( 0, [ innerR ] ) ) ).toBe( "ACCEPT" ); // Constr 0 [ R ]  (edit selector)
        expect( run( v, innerR ) ).toBe( "REJECT" );                          // raw R, no selector
    });
});

// NOTE: L2 (reading a reference input's value overspends the PV11 budget) is a
// cost-model issue, not reproducible in the bundled CEK test machine: the
// lowering for `ri.resolved.value.*` is identical to the (cheaper) `tx.inputs`
// value access — `unValueData` + `lookupCoin`, no array builtins. Deferred
// pending on-chain budget data; intentionally not covered here.
