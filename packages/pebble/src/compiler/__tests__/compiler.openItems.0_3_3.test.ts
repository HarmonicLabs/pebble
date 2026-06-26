import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { DiagnosticMessage } from "../../diagnostics/DiagnosticMessage";
import { DiagnosticCategory } from "../../diagnostics/DiagnosticCategory";
import { DiagnosticCode } from "../../diagnostics/diagnosticMessages.generated";
import { SourceRange } from "../../ast/Source/SourceRange";
import { Source, SourceKind } from "../../ast/Source/Source";

// Open items from the-cardano-masterpiece/onchain/PEBBLE_BUGS.md, fixed in 0.3.3.

async function trace1( srcText: string ) {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( srcText ) ] ]),
        useConsoleAsOutput: true,
    });
    const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    const result = await compiler.run({ entry: "main.pebble", root: "/" });
    return { logs: result.logs, diagnostics: compiler.diagnostics.map( d => d.toString() ) };
}

async function compileOk( srcText: string ) {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( srcText ) ] ]),
        useConsoleAsOutput: true,
    });
    const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await compiler.compile({ entry: "main.pebble", root: "/" });
    return {
        output: ioApi.outputs.get("out/out.flat"),
        diagnostics: compiler.diagnostics.map( d => d.toString() ),
    };
}

describe("0.3.3 open items", () => {

    // BUG 6 + BUG 2
    test("`bool` aliases `boolean`, and `boolean == boolean` compiles & evaluates", async () => {
        const { logs, diagnostics } = await trace1(`
function xnor( a: bool, b: bool ): bool { return a == b; }
function asInt( x: bool ): int { return x ? 1 : 0; }
trace asInt( xnor( true, true ) ) + asInt( xnor( false, false ) ) * 10 + asInt( xnor( true, false ) ) * 100;
`);
        expect( diagnostics ).toEqual( [] );
        // xnor(t,t)=1, xnor(f,f)=1 (*10), xnor(t,f)=0 (*100) => 1 + 10 + 0
        expect( logs ).toEqual( [ "11" ] );
    });

    // BUG 7 — feature gap: multiScalarMul was not surfaced in stdlib.
    // Verified at the compiler level (type-checks + lowers to the CIP-381
    // builtin + compiles to valid UPLC). NOTE: the JS test evaluator
    // (@harmoniclabs/plutus-machine) has an unrelated `instanceof` bug in its
    // MSM point validation, so this is a compile assertion, not an eval one.
    test("bls12_381 g1/g2 multiScalarMul are callable and compile", async () => {
        const { output, diagnostics } = await compileOk(`
contract C {
    spend run( red: data ) {
        const seed = red as bytes;
        const p = std.crypto.bls12_381.g1HashToGroup( seed, #42 );
        const q = std.crypto.bls12_381.g1HashToGroup( std.bytes.concat( seed, #ff ), #42 );
        const r1 = std.crypto.bls12_381.g1MultiScalarMul( [ 2, 3 ], [ p, q ] );

        const p2 = std.crypto.bls12_381.g2HashToGroup( seed, #42 );
        const q2 = std.crypto.bls12_381.g2HashToGroup( std.bytes.concat( seed, #ff ), #42 );
        const r2 = std.crypto.bls12_381.g2MultiScalarMul( [ 2, 3 ], [ p2, q2 ] );

        assert std.crypto.bls12_381.g1Equal( r1, r1 ) && std.crypto.bls12_381.g2Equal( r2, r2 );
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    // BUG 3 — diagnostic pretty-printer threw "pos out of range" on synthetic
    // (mock) ranges, masking later errors.
    test("Source.lineAt clamps out-of-range positions instead of throwing", () => {
        const src = new Source( SourceKind.User, "t.pebble", "uid", "line1\nline2\nline3" );
        expect( () => src.lineAt( -1 ) ).not.toThrow();
        expect( () => src.lineAt( 0x7fffffff ) ).not.toThrow();
        expect( src.lineAt( -1 ) ).toBe( 1 );
        expect( src.lineAt( 0 ) ).toBe( 1 );
        expect( src.lineAt( 6 ) ).toBe( 2 );
    });

    test("a diagnostic on a mock range prints instead of crashing the pass", () => {
        const msg = DiagnosticMessage
            .create( DiagnosticCode._0_is_not_defined, DiagnosticCategory.Error, "Foo" )
            .withRange( SourceRange.mock );
        let s = "";
        expect( () => { s = msg.toString(); } ).not.toThrow();
        expect( s ).toContain( "'Foo' is not defined" );
    });

    // BUG 4 — `pebble test` reported "0 total" with no error when a test file
    // failed to compile. The compiler surfaces the errors in `diagnostics`
    // (the CLI now prints them); this locks in that contract.
    test("compiler.test() leaves compile errors in `diagnostics` (not silently empty)", async () => {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([ [ "main.pebble", fromUtf8(`
test broken() {
    let x: int = #deadbeef;
    assert x == 0;
}
`) ] ]),
            useConsoleAsOutput: false,
        });
        const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        const results = await compiler.test({ entry: "main.pebble", root: "/" } as any );

        // no runnable tests (the file didn't compile) ...
        expect( results.length ).toBe( 0 );
        // ... but the error is visible, not swallowed
        const errors = compiler.diagnostics.map( d => String( d ) ).filter( s => s.startsWith( "ERROR" ) );
        expect( errors.length ).toBeGreaterThan( 0 );
    });
});
