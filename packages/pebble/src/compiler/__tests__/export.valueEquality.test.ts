import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, parseUPLCText, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

const policyHexA = "aa".repeat(28);
const policyHexB = "bb".repeat(28);
const nameHex = "ff";

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

function valueArg( entries: Array<{ policy: string, tokens: Array<{ name: string, qty: bigint }> }> ): UPLCConst {
    const tokenList = (toks: Array<{ name: string, qty: bigint }>) =>
        toks.map(t => `(#${t.name}, ${t.qty})`).join(", ");
    const body = entries.map(e => `(#${e.policy}, [${tokenList(e.tokens)}])`).join(", ");
    return parseUPLCText( `(con value [${body}])` ) as UPLCConst;
}

function evalBool( uplc: UPLCTerm, a: UPLCConst, b: UPLCConst ): boolean
{
    const r = Machine.eval( new Application( new Application( uplc, a ), b ) ).result;
    if( !( r instanceof CEKConst ) ) throw new Error("eval returned non-const: " + JSON.stringify(r));
    return (r as CEKConst).value as boolean;
}

describe("V4 Value equality", () => {

    test("identical values  →  true (==)", async () => {
        const uplc = await compileSingleFn(
            "vEq",
            `function vEq( a: Value, b: Value ): boolean { return a == b; }`
        );
        const v = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 42n }] }]);
        const v2 = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 42n }] }]);
        expect( evalBool( uplc, v, v2 ) ).toBe( true );
    });

    test("different quantities  →  false (==)", async () => {
        const uplc = await compileSingleFn(
            "vEq",
            `function vEq( a: Value, b: Value ): boolean { return a == b; }`
        );
        const a = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 42n }] }]);
        const b = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 7n }] }]);
        expect( evalBool( uplc, a, b ) ).toBe( false );
    });

    test("different policies  →  false (==)", async () => {
        const uplc = await compileSingleFn(
            "vEq",
            `function vEq( a: Value, b: Value ): boolean { return a == b; }`
        );
        const a = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 1n }] }]);
        const b = valueArg([{ policy: policyHexB, tokens: [{ name: nameHex, qty: 1n }] }]);
        expect( evalBool( uplc, a, b ) ).toBe( false );
    });

    test("strict equality (===) on Value behaves the same", async () => {
        const uplc = await compileSingleFn(
            "vSeq",
            `function vSeq( a: Value, b: Value ): boolean { return a === b; }`
        );
        const v = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 5n }] }]);
        const v2 = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 5n }] }]);
        expect( evalBool( uplc, v, v2 ) ).toBe( true );
        const w = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 6n }] }]);
        expect( evalBool( uplc, v, w ) ).toBe( false );
    });

    test("not-equal (!=) on Value", async () => {
        const uplc = await compileSingleFn(
            "vNeq",
            `function vNeq( a: Value, b: Value ): boolean { return a != b; }`
        );
        const v = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 5n }] }]);
        const w = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 6n }] }]);
        expect( evalBool( uplc, v, w ) ).toBe( true );
        expect( evalBool( uplc, v, v ) ).toBe( false );
    });

    test("equality after Value arithmetic round-trip", async () => {
        // (a + b) - b  should equal a
        const uplc = await compileSingleFn(
            "rt",
            `function rt( a: Value, b: Value ): boolean { return ((a + b) - b) == a; }`
        );
        const a = valueArg([
            { policy: policyHexA, tokens: [{ name: nameHex, qty: 10n }] },
            { policy: policyHexB, tokens: [{ name: nameHex, qty: 3n }] },
        ]);
        const b = valueArg([{ policy: policyHexA, tokens: [{ name: nameHex, qty: 7n }] }]);
        expect( evalBool( uplc, a, b ) ).toBe( true );
    });

});
