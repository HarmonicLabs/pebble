import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// Bug 9 from `the-cardano-masterpiece` (PEBBLE_BUGS.md, against 0.3.5):
// state types were not nameable — `od as SC.First` failed with 2339
// ("Property 'First' does not exist on type 'SC'": the type parser stopped
// at `SC`, so it parsed as `(od as SC).First`) and there was no way to
// decode another UTxO's datum against a specific state.
// Qualified type names now resolve; `Type.Constructor` yields the type
// NARROWED to that constructor (tag checked against the PARENT index).

async function compile( src: string ) {
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

async function run( src: string ) {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    const r = await c.run({ entry: "main.pebble", root: "/" });
    return { result: r, diagnostics: c.diagnostics.map( d => d.toString() ) };
}

describe("masterpiece bug 9 — state types are nameable/castable", () => {

    test("`od as SC.First` (the report's repro) compiles", async () => {
        const { diagnostics, output } = await compile(`
contract SC {
    state First {
        n: int

        spend a() {
            const { tx, state: { n } } = context;
            const InlineDatum{ datum: od } = tx.outputs[0].datum;
            const First{ n: n2 } = od as SC.First;
            assert n2 == n;
        }
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("second state decodes with its own (non-zero) tag", async () => {
        const { diagnostics, output } = await compile(`
contract SC {
    state First {
        n: int

        spend a() {
            const { tx } = context;
            const InlineDatum{ datum: od } = tx.outputs[0].datum;
            const Second{ m } = od as SC.Second;
            assert m >= 0;
        }
    }
    state Second {
        m: int

        spend b() {
            const { tx } = context;
            assert tx.inputs.length() > 0;
        }
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("masterpiece bug 9 — struct variants as qualified types", () => {

    test("`d as Struct.Variant` compiles", async () => {
        const { diagnostics, output } = await compile(`
struct Two {
    A { a: int }
    B { b: int }
}

contract T {
    spend s( redeemer: data ) {
        const { tx } = context;
        const B{ b } = redeemer as Two.B;
        assert b >= 0;
        assert tx.inputs.length() > 0;
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("narrowed decode checks the PARENT constructor tag (executes)", async () => {
        // `Two.B` is constructor index 1 of `Two`; round-trip through `data`
        // and decode with the narrowed type. If the narrowing lost the
        // parent index (asserted tag 0), this would fail at runtime.
        const { result, diagnostics } = await run(`
struct Two {
    A { a: int }
    B { b: int }
}

const t: Two = Two.B{ b: 42 };
const d = t as data;
const B{ b: decoded } = d as Two.B;
trace decoded;
`);
        expect( diagnostics ).toEqual( [] );
        expect( result.logs ).toEqual( [ "42" ] );
    });

    test("narrowed decode of the WRONG constructor fails at runtime", async () => {
        const { result } = await run(`
struct Two {
    A { a: int }
    B { b: int }
}

const t: Two = Two.B{ b: 42 };
const d = t as data;
const A{ a: decoded } = d as Two.A;
trace decoded;
`);
        // decoding a `B`-tagged value as `Two.A` must NOT succeed
        expect( result.logs ).not.toEqual( [ "42" ] );
    });
});
