import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromHex, fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, parseUPLCText, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

const policyHexA = "aa".repeat(28);
const policyHexB = "bb".repeat(28);
const nameHex = "ff";

/** Compile a single-function pebble program and return its parsed UPLC body. */
async function compileSingleFn( name: string, src: string ): Promise<UPLCTerm> {
    const fileName = "test.pebble";
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([[fileName, fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: name, entry: fileName, root: "/" });
    if( c.diagnostics.length ) {
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));
    }
    return parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
}

/** A literal `(con value …)` UPLC arg holding `[(policy, [(name, qty), …]), …]`. */
function valueArg( entries: Array<{ policy: string, tokens: Array<{ name: string, qty: bigint }> }> ): UPLCConst {
    const tokenList = (toks: Array<{ name: string, qty: bigint }>) =>
        toks.map(t => `(#${t.name}, ${t.qty})`).join(", ");
    const body = entries.map(e => `(#${e.policy}, [${tokenList(e.tokens)}])`).join(", ");
    const src = `(con value [${body}])`;
    // parseUPLCText returns a UPLCTerm of `UPLCConst` shape
    return parseUPLCText( src ) as UPLCConst;
}

describe("Value operators", () => {

    test("Value + Value  →  unionValue", async () => {
        const uplc = await compileSingleFn(
            "add",
            `function add( a: Value, b: Value ): int { return (a + b).amountOf( #${policyHexA}, #${nameHex} ); }`
        );
        const a = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 10n }] }]);
        const b = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 32n }] }]);
        const r = Machine.eval( new Application( new Application( uplc, a ), b ) ).result;
        expect( r instanceof CEKConst ).toBe( true );
        expect( ( r as CEKConst ).value ).toBe( 42n );
    });

    test("- Value  →  negateValue (== scaleValue -1)", async () => {
        const uplc = await compileSingleFn(
            "neg",
            `function neg( v: Value ): int { return (-v).amountOf( #${policyHexA}, #${nameHex} ); }`
        );
        const v = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 7n }] }]);
        const r = Machine.eval( new Application( uplc, v ) ).result;
        expect( r instanceof CEKConst ).toBe( true );
        expect( ( r as CEKConst ).value ).toBe( -7n );
    });

    test("Value - Value  →  unionValue(a, negateValue(b))", async () => {
        const uplc = await compileSingleFn(
            "sub",
            `function sub( a: Value, b: Value ): int { return (a - b).amountOf( #${policyHexA}, #${nameHex} ); }`
        );
        const a = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 50n }] }]);
        const b = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 8n }] }]);
        const r = Machine.eval( new Application( new Application( uplc, a ), b ) ).result;
        expect( r instanceof CEKConst ).toBe( true );
        expect( ( r as CEKConst ).value ).toBe( 42n );
    });

    test("int * Value  →  scaleValue", async () => {
        const uplc = await compileSingleFn(
            "scaleL",
            `function scaleL( k: int, v: Value ): int { return (k * v).amountOf( #${policyHexA}, #${nameHex} ); }`
        );
        const k = UPLCConst.int( 6n );
        const v = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 7n }] }]);
        const r = Machine.eval( new Application( new Application( uplc, k ), v ) ).result;
        expect( r instanceof CEKConst ).toBe( true );
        expect( ( r as CEKConst ).value ).toBe( 42n );
    });

    test("Value * int  →  scaleValue", async () => {
        const uplc = await compileSingleFn(
            "scaleR",
            `function scaleR( v: Value, k: int ): int { return (v * k).amountOf( #${policyHexA}, #${nameHex} ); }`
        );
        const v = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 7n }] }]);
        const k = UPLCConst.int( 6n );
        const r = Machine.eval( new Application( new Application( uplc, v ), k ) ).result;
        expect( r instanceof CEKConst ).toBe( true );
        expect( ( r as CEKConst ).value ).toBe( 42n );
    });

    test("cross-policy unionValue", async () => {
        const uplc = await compileSingleFn(
            "addCross",
            `function addCross( a: Value, b: Value ): int { return (a + b).amountOf( #${policyHexB}, #${nameHex} ); }`
        );
        const a = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 10n }] }]);
        const b = valueArg([{ policy: policyHexB, tokens: [{ name: nameHex, qty: 11n }] }]);
        const r = Machine.eval( new Application( new Application( uplc, a ), b ) ).result;
        expect( r instanceof CEKConst ).toBe( true );
        expect( ( r as CEKConst ).value ).toBe( 11n );
    });

});
