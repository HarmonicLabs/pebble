import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, Case as UplcCase, parseUPLC, prettyUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

async function compileSingleFn( name: string, src: string ): Promise<UPLCTerm> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: name, entry: "test.pebble", root: "/" });
    if( c.diagnostics.length ) {
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));
    }
    return parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
}

function evalBool2( uplc: UPLCTerm, a: boolean, b: boolean ): boolean {
    const r = Machine.eval( new Application(
        new Application( uplc, UPLCConst.bool( a ) ),
        UPLCConst.bool( b )
    ) ).result;
    return (r as CEKConst).value as boolean;
}

function evalBool1( uplc: UPLCTerm, a: boolean ): boolean {
    const r = Machine.eval( new Application( uplc, UPLCConst.bool( a ) ) ).result;
    return (r as CEKConst).value as boolean;
}

/** Count `Case` nodes in the UPLC term tree. */
function countCases( t: UPLCTerm ): number {
    let n = 0;
    const visit = ( x: any ) => {
        if( x instanceof UplcCase ) n++;
        if( x && typeof x === "object" ) {
            for( const k of Object.keys( x ) ) {
                if( k === "parent" ) continue;
                visit( (x as any)[k] );
            }
        }
    };
    visit( t );
    return n;
}

/** Pretty-printed UPLC must NOT mention `ifThenElse` after bool case lowering. */
function assertNoIfThenElse( uplc: UPLCTerm ): void {
    const text = prettyUPLC( uplc, 2 );
    expect( text.includes( "ifThenElse" ) ).toBe( false );
}

describe("bool → Case-over-Const lowering", () => {

    test("&&  →  case", async () => {
        const uplc = await compileSingleFn(
            "lAnd",
            `function lAnd( a: boolean, b: boolean ): boolean { return a && b; }`
        );
        assertNoIfThenElse( uplc );
        expect( countCases( uplc ) ).toBeGreaterThan( 0 );

        expect( evalBool2( uplc, true,  true  ) ).toBe( true );
        expect( evalBool2( uplc, true,  false ) ).toBe( false );
        expect( evalBool2( uplc, false, true  ) ).toBe( false );
        expect( evalBool2( uplc, false, false ) ).toBe( false );
    });

    test("||  →  case", async () => {
        const uplc = await compileSingleFn(
            "lOr",
            `function lOr( a: boolean, b: boolean ): boolean { return a || b; }`
        );
        assertNoIfThenElse( uplc );

        expect( evalBool2( uplc, true,  true  ) ).toBe( true );
        expect( evalBool2( uplc, true,  false ) ).toBe( true );
        expect( evalBool2( uplc, false, true  ) ).toBe( true );
        expect( evalBool2( uplc, false, false ) ).toBe( false );
    });

    test("!  →  case", async () => {
        const uplc = await compileSingleFn(
            "lNot",
            `function lNot( a: boolean ): boolean { return !a; }`
        );
        assertNoIfThenElse( uplc );

        expect( evalBool1( uplc, true  ) ).toBe( false );
        expect( evalBool1( uplc, false ) ).toBe( true );
    });

    test("if/else  →  case", async () => {
        const uplc = await compileSingleFn(
            "branch",
            `function branch( a: boolean ): int { if( a ) { return 1; } else { return 2; } }`
        );
        assertNoIfThenElse( uplc );

        const eval1 = ( v: boolean ) =>
            ( Machine.eval( new Application( uplc, UPLCConst.bool( v ) ) ).result as CEKConst ).value;
        expect( eval1( true  ) ).toBe( 1n );
        expect( eval1( false ) ).toBe( 2n );
    });

    test("nested &&/||/! short-circuit semantics", async () => {
        const uplc = await compileSingleFn(
            "mixed",
            `function mixed( a: boolean, b: boolean ): boolean { return !(a && b) || a; }`
        );
        assertNoIfThenElse( uplc );
        // !(a && b) || a:
        //   a=T,b=T → !T || T = F || T = T
        //   a=T,b=F → !F || T = T || T = T
        //   a=F,b=T → !F || F = T || F = T
        //   a=F,b=F → !F || F = T || F = T
        expect( evalBool2( uplc, true,  true  ) ).toBe( true );
        expect( evalBool2( uplc, true,  false ) ).toBe( true );
        expect( evalBool2( uplc, false, true  ) ).toBe( true );
        expect( evalBool2( uplc, false, false ) ).toBe( true );
    });

});
