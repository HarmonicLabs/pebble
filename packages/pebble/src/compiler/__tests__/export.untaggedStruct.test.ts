import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst } from "@harmoniclabs/uplc";
import {
    CEKConst, DataB, DataConstr, DataI, DataList, Machine
} from "@harmoniclabs/buildooor";

/*
 * End-to-end tests for `untagged` data structs (listData encoding,
 * single constructor). Covers:
 *   - explicit `untagged` keyword
 *   - `encodingStrategy: "minimal"` opting shortcut-form structs in
 *   - prop access lowering bypasses the case rewrite
 *   - `case`/`match` over an untagged value
 *   - `is` operator (statically true) preserves side-effect evaluation
 */

type EncodingStrategy = "default" | "minimal";

async function exportFunction(
    srcText: string,
    functionName: string,
    encodingStrategy: EncodingStrategy = "default"
): Promise<any> {
    let uplc: any;
    let diagnostics: string[] = [];
    await jest.isolateModulesAsync(async () => {
        const { Compiler } = require("../Compiler");
        const { createMemoryCompilerIoApi } = require("../io/CompilerIoApi");
        const { testOptions, COMPILER_VERSION } = require("../../IR");

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([["test.pebble", fromUtf8(srcText)]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler(ioApi, {
            ...testOptions,
            compilerVersion: COMPILER_VERSION,
            encodingStrategy
        });

        await compiler.export({ functionName, entry: "test.pebble", root: "/" });
        diagnostics = compiler.diagnostics
            .filter((d: any) => d.category === 1 /* error */)
            .map((d: any) => d.toString());

        const outputBytes = ioApi.outputs.get("out/out.flat") as Uint8Array;
        if (!outputBytes) throw new Error("export produced no output bytes");
        uplc = parseUPLC(outputBytes).body;
    });
    if (diagnostics.length !== 0)
        throw new Error(`compilation produced errors:\n${diagnostics.join("\n")}`);
    return uplc;
}

function applyAndExpectInt(uplc: any, arg: UPLCConst, expected: bigint): void {
    const result = Machine.eval(new Application(uplc, arg));
    expect(result.result instanceof CEKConst).toBe(true);
    expect((result.result as CEKConst).value).toBe(expected);
}

function applyAndExpectBool(uplc: any, arg: UPLCConst, expected: boolean): void {
    const result = Machine.eval(new Application(uplc, arg));
    expect(result.result instanceof CEKConst).toBe(true);
    expect((result.result as CEKConst).value).toBe(expected);
}

describe("untagged data structs", () => {

    // -----------------------------------------------------------------
    // Explicit `untagged` keyword — single-field access reads from a
    // listData-encoded value.
    // -----------------------------------------------------------------
    test("explicit `untagged`: single-field access (listData input)", async () => {
        const uplc = await exportFunction(`
untagged data struct Wrap { value: int }

export function unwrap( w: Wrap ): int {
    return w.value;
}
`, "unwrap");
        // listData([ iData(42) ])
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataList([ new DataI(42n) ])),
            42n
        );
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataList([ new DataI(-7n) ])),
            -7n
        );
    });

    test("explicit `untagged`: multi-field access reads fields by name", async () => {
        const uplc = await exportFunction(`
untagged data struct Pair { a: int, b: int }

export function diff( p: Pair ): int {
    return p.a - p.b;
}
`, "diff");
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataList([ new DataI(10n), new DataI(3n) ])),
            7n
        );
    });

    test("explicit `untagged`: field of type bytes goes through unBData", async () => {
        const uplc = await exportFunction(`
untagged data struct Box { payload: bytes }

export function lenPayload( b: Box ): int {
    return b.payload.length();
}
`, "lenPayload");
        const result = Machine.eval(new Application(
            uplc,
            UPLCConst.data(new DataList([ new DataB(new Uint8Array([0x01, 0x02, 0x03, 0x04])) ]))
        ));
        expect(result.result instanceof CEKConst).toBe(true);
        expect((result.result as CEKConst).value).toBe(4n);
    });

    // -----------------------------------------------------------------
    // `encodingStrategy: "minimal"` makes shortcut-form structs untagged.
    // The same source code compiles to a listData consumer under "minimal"
    // and a constrData consumer under "default".
    // -----------------------------------------------------------------
    test("encodingStrategy: minimal makes shortcut-form structs untagged", async () => {
        const src = `
struct Pair { a: int, b: int }

export function sumPair( p: Pair ): int {
    return p.a + p.b;
}
`;
        const minimal = await exportFunction(src, "sumPair", "minimal");
        applyAndExpectInt(
            minimal,
            UPLCConst.data(new DataList([ new DataI(10n), new DataI(32n) ])),
            42n
        );

        const def = await exportFunction(src, "sumPair", "default");
        applyAndExpectInt(
            def,
            UPLCConst.data(new DataConstr(0, [ new DataI(10n), new DataI(32n) ])),
            42n
        );
    });

    test("encodingStrategy: explicit `untagged` overrides default", async () => {
        const uplc = await exportFunction(`
untagged data struct Pair { a: int, b: int }

export function sumPair( p: Pair ): int {
    return p.a + p.b;
}
`, "sumPair", "default");
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataList([ new DataI(10n), new DataI(32n) ])),
            42n
        );
    });

    test("encodingStrategy: named-constructor form unaffected by minimal", async () => {
        // Named-constructor `data struct Pair { Pair { a, b } }` is NOT
        // a shortcut form, so it stays tagged regardless of strategy.
        const src = `
data struct Pair {
    Pair { a: int, b: int }
}

export function sumPair( p: Pair ): int {
    const Pair { a, b } = p;
    return a + b;
}
`;
        const uplc = await exportFunction(src, "sumPair", "minimal");
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [ new DataI(10n), new DataI(32n) ])),
            42n
        );
    });

    // -----------------------------------------------------------------
    // `case` over an untagged value: only one ctor possible.
    // -----------------------------------------------------------------
    test("case over untagged: single-arm extraction", async () => {
        const uplc = await exportFunction(`
untagged data struct Pair { a: int, b: int }

export function sumPair( p: Pair ): int {
    return case p
        is Pair { a, b } => a + b
        ;
}
`, "sumPair");
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataList([ new DataI(10n), new DataI(32n) ])),
            42n
        );
    });

    // -----------------------------------------------------------------
    // `is` operator on untagged is statically true.
    // -----------------------------------------------------------------
    test("is operator on untagged is always true", async () => {
        const uplc = await exportFunction(`
untagged data struct Wrap { x: int }

export function checkIs( w: Wrap ): boolean {
    return w is Wrap;
}
`, "checkIs");
        applyAndExpectBool(
            uplc,
            UPLCConst.data(new DataList([ new DataI(0n) ])),
            true
        );
    });

    // -----------------------------------------------------------------
    // Round-trip: data value through an untagged-typed function param
    // and back to data preserves the listData encoding.
    // -----------------------------------------------------------------
    test("data cast back from untagged is identity", async () => {
        const uplc = await exportFunction(`
untagged data struct Wrap { x: int }

export function asData( w: Wrap ): data {
    return w as data;
}
`, "asData");
        const input = new DataList([ new DataI(99n) ]);
        const result = Machine.eval(new Application(
            uplc,
            UPLCConst.data(input)
        ));
        expect(result.result instanceof CEKConst).toBe(true);
        // identity: the same DataList comes back
        expect((result.result as CEKConst).value).toEqual(input);
    });
});
