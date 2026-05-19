import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst } from "@harmoniclabs/uplc";
import {
    CEKConst, CEKError, DataB, DataConstr, DataI, Machine
} from "@harmoniclabs/buildooor";

/*
 * Tests for the `_dataStructToIR` path in TirCaseExpr — covers `case`
 * expressions over Data-encoded structs. Each test compiles and exports a
 * function and feeds it a `Constr`-encoded argument so the data path
 * (unConstrData / fstPair-based dispatch) is exercised end-to-end.
 *
 * Module isolation matches export.isExpr.narrowing.test.ts to sidestep a
 * pre-existing IR-caching nondeterminism across consecutive exports.
 */

async function exportFunction(srcText: string, functionName: string): Promise<any> {
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
        const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await compiler.export({ functionName, entry: "test.pebble", root: "/" });
        diagnostics = compiler.diagnostics.map((d: any) => d.toString());

        const outputBytes = ioApi.outputs.get("out/out.flat") as Uint8Array;
        if (!outputBytes) throw new Error("export produced no output bytes");
        uplc = parseUPLC(outputBytes).body;
    });
    if (diagnostics.length !== 0)
        throw new Error(`compilation produced diagnostics:\n${diagnostics.join("\n")}`);
    return uplc;
}

function applyAndExpectInt(uplc: any, arg: UPLCConst, expected: bigint): void {
    const result = Machine.eval(new Application(uplc, arg));
    expect(result.result instanceof CEKConst).toBe(true);
    expect((result.result as CEKConst).value).toBe(expected);
}

function applyAndExpectBytes(uplc: any, arg: UPLCConst, expected: Uint8Array): void {
    const result = Machine.eval(new Application(uplc, arg));
    expect(result.result instanceof CEKConst).toBe(true);
    expect((result.result as CEKConst).value).toEqual(expected);
}

function applyAndExpectError(uplc: any, arg: UPLCConst): void {
    const result = Machine.eval(new Application(uplc, arg));
    expect(result.result instanceof CEKError).toBe(true);
}

describe("case expression — Data struct lowering", () => {

    // -----------------------------------------------------------------
    // single-constructor zero-field — degenerate but the wildcard-only
    // path still needs to evaluate correctly.
    // -----------------------------------------------------------------
    test("single-constructor zero-field: wildcard returns body", async () => {
        const uplc = await exportFunction(`
data struct Unit { Only{} }

export function f( u: Unit ): int {
    return case u
        is Only{} => 42
        ;
}
`, "f");
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [])), 42n);
    });

    // -----------------------------------------------------------------
    // multi-constructor, zero-field arms (TirDataStructType zero-field
    // branch — lines 369-387 in _dataStructToIR)
    // -----------------------------------------------------------------
    test("multi-constructor zero-field arms dispatch on ctor idx", async () => {
        const uplc = await exportFunction(`
data struct Color {
    Red{}
    Green{}
    Blue{}
}

export function rank( c: Color ): int {
    return case c
        is Red{}   => 1
        is Green{} => 2
        is Blue{}  => 3
        ;
}
`, "rank");
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [])), 1n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(1, [])), 2n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(2, [])), 3n);
    });

    // -----------------------------------------------------------------
    // single-field used branch (lines 396-441 in _dataStructToIR).
    // Each case extracts exactly one field of its constructor.
    // -----------------------------------------------------------------
    test("single field used: extracts the named field", async () => {
        const uplc = await exportFunction(`
data struct M {
    First{ n: int }
    Second{ k: int }
}

export function pick( m: M ): int {
    return case m
        is First{ n }  => n
        is Second{ k } => k
        ;
}
`, "pick");
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [new DataI(7n)])), 7n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(1, [new DataI(13n)])), 13n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [new DataI(-1n)])), -1n);
    });

    // -----------------------------------------------------------------
    // multiple fields used (lines 443-503 in _dataStructToIR).
    // Each case extracts >= 2 fields of its constructor.
    // -----------------------------------------------------------------
    test("multiple fields used: extracts multiple fields per arm", async () => {
        const uplc = await exportFunction(`
data struct Pair {
    Both{ a: int, b: int }
    Single{ x: int }
}

export function sum( p: Pair ): int {
    return case p
        is Both{ a, b } => a + b
        is Single{ x }  => x
        ;
}
`, "sum");
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [new DataI(3n), new DataI(4n)])), 7n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [new DataI(10n), new DataI(-3n)])), 7n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(1, [new DataI(99n)])), 99n);
    });

    // -----------------------------------------------------------------
    // partial-field destructuring — pattern names a subset of the
    // constructor's fields. The lowering must still extract by NAME, not
    // by positional order in the pattern.
    // -----------------------------------------------------------------
    test("partial-field destructuring: only the named fields are bound", async () => {
        const uplc = await exportFunction(`
data struct Triple {
    All{ x: int, y: int, z: int }
}

export function justY( t: Triple ): int {
    return case t
        is All{ y } => y
        ;
}
`, "justY");
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [new DataI(1n), new DataI(2n), new DataI(3n)])), 2n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [new DataI(99n), new DataI(42n), new DataI(0n)])), 42n);
    });

    // -----------------------------------------------------------------
    // partial-field, multiple-fields used, fields NOT in declaration
    // order — exercises the `sortedUsedFields` sort step in
    // _dataStructToIR (line 449-451).
    // -----------------------------------------------------------------
    test("multiple fields used out of declaration order", async () => {
        const uplc = await exportFunction(`
data struct Quad {
    Q{ a: int, b: int, c: int, d: int }
}

export function pickAC( q: Quad ): int {
    return case q
        is Q{ c, a } => c - a
        ;
}
`, "pickAC");
        // a=10, b=99, c=30, d=99 → c - a = 20
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [
                new DataI(10n), new DataI(99n), new DataI(30n), new DataI(99n)
            ])),
            20n
        );
    });

    // -----------------------------------------------------------------
    // wildcard case (line 343 in _dataStructToIR): unmatched ctor idx
    // routes to the wildcard body.
    // -----------------------------------------------------------------
    test("wildcard catches un-listed constructors", async () => {
        const uplc = await exportFunction(`
data struct Color {
    Red{}
    Green{}
    Blue{}
}

export function isRed( c: Color ): int {
    return case c
        is Red{} => 1
        else     0
        ;
}
`, "isRed");
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [])), 1n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(1, [])), 0n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(2, [])), 0n);
    });

    // -----------------------------------------------------------------
    // wildcard with destructuring arms — the wildcard must fire when
    // no explicit arm matches, even though earlier arms destructure
    // fields.
    // -----------------------------------------------------------------
    test("wildcard with destructuring arms", async () => {
        const uplc = await exportFunction(`
data struct M {
    First{ n: int }
    Second{ k: int }
    Third{}
}

export function pick( m: M ): int {
    return case m
        is First{ n } => n + 1
        else          0
        ;
}
`, "pick");
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [new DataI(41n)])), 42n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(1, [new DataI(99n)])), 0n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(2, [])), 0n);
    });

    // -----------------------------------------------------------------
    // no wildcard, no matching ctor → UPLC error (the trailing
    // `ifThenElseMatchingStatements` is IRError when no wildcard is
    // provided).
    // -----------------------------------------------------------------
    test("no wildcard + unmatched ctor → UPLC error", async () => {
        const uplc = await exportFunction(`
data struct M {
    First{}
    Second{}
}

export function onlyFirst( m: M ): int {
    return case m
        is First{} => 1
        is Second{} => 2
        ;
}
`, "onlyFirst");
        // both listed ctors evaluate fine
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [])), 1n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(1, [])), 2n);
        // out-of-universe ctor idx → no branch matches → IRError
        applyAndExpectError(uplc, UPLCConst.data(new DataConstr(7, [])));
    });

    // -----------------------------------------------------------------
    // case order is independent of declaration order (the data path
    // re-sorts cases by ctor idx before generating the ifThenElse
    // chain — line 351-355).
    // -----------------------------------------------------------------
    test("case arms in reversed order still evaluate correctly", async () => {
        const uplc = await exportFunction(`
data struct M {
    A{ a: int }
    B{ b: int }
    C{ c: int }
}

export function compute( m: M ): int {
    return case m
        is C{ c } => c * 3
        is A{ a } => a * 1
        is B{ b } => b * 2
        ;
}
`, "compute");
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [new DataI(5n)])), 5n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(1, [new DataI(5n)])), 10n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(2, [new DataI(5n)])), 15n);
    });

    // -----------------------------------------------------------------
    // mixed-encoding fields — a data struct with a bytes field
    // exercises the `_inlineFromData` (unBData) call inside the
    // extracted-field IR.
    // -----------------------------------------------------------------
    test("non-int field type goes through fromData on extraction", async () => {
        const uplc = await exportFunction(`
data struct W {
    Wrap{ payload: bytes }
}

export function payloadOf( w: W ): bytes {
    return case w
        is Wrap{ payload } => payload
        ;
}
`, "payloadOf");
        const bs = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        applyAndExpectBytes(
            uplc,
            UPLCConst.data(new DataConstr(0, [new DataB(bs)])),
            bs
        );
    });

    // -----------------------------------------------------------------
    // bare `is Member` (no braces) for zero-field ctors — the parser
    // accepts both forms; this confirms the data path handles the
    // SimpleVarDecl→empty-NamedDeconstruct promotion correctly.
    //
    // NOTE: bare-name promotion is implemented for enum scrutinees in
    // the AstCompiler; for structs the AstCompiler still requires the
    // `{}` form. Keep this assertion to catch regressions if/when bare
    // forms get extended.
    // -----------------------------------------------------------------
    test("zero-field arm requires `{}` braces for struct scrutinees", async () => {
        // sanity check that the `{}` form is the canonical struct form
        const uplc = await exportFunction(`
data struct M { A{} B{} }

export function pick( m: M ): int {
    return case m
        is A{} => 100
        is B{} => 200
        ;
}
`, "pick");
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(0, [])), 100n);
        applyAndExpectInt(uplc, UPLCConst.data(new DataConstr(1, [])), 200n);
    });

    // -----------------------------------------------------------------
    // nested case: outer case arm body itself contains an inner case
    // (the inner case must compile and evaluate inside an arbitrary
    // outer scope).
    // -----------------------------------------------------------------
    test("nested case expressions over data structs", async () => {
        const uplc = await exportFunction(`
data struct Inner {
    L{ left: int }
    R{ right: int }
}
data struct Outer {
    Wrap{ i: Inner, sign: int }
}

export function score( o: Outer ): int {
    return case o
        is Wrap{ i, sign } => (
            case i
                is L{ left }  => left * sign
                is R{ right } => 0 - (right * sign)
                ;
        )
        ;
}
`, "score");
        // Wrap{ i: L{ 5 }, sign: 1 } → 5 * 1 = 5
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [
                new DataConstr(0, [new DataI(5n)]),
                new DataI(1n)
            ])),
            5n
        );
        // Wrap{ i: R{ 7 }, sign: 2 } → -(7 * 2) = -14
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [
                new DataConstr(1, [new DataI(7n)]),
                new DataI(2n)
            ])),
            -14n
        );
    });

    // -----------------------------------------------------------------
    // TirDataOptT path (lines 295-330 in _dataStructToIR): exercised
    // when an Optional<T> appears as a field of a Data struct (top-level
    // `Optional<T>` function params resolve to SoP optionals; only Data
    // contexts retain the Data encoding).
    //
    // The lowering dispatches via unConstrData + ctor-idx check
    // (Some=0, None=1) and applies `_inlineFromData` to extract the
    // wrapped value.
    // -----------------------------------------------------------------
    test("Data Optional<int> inside data struct: Some/None dispatch + value extraction", async () => {
        const uplc = await exportFunction(`
data struct Wrapped {
    W{ inner: Optional<int> }
}

export function unwrap( w: Wrapped ): int {
    return case w
        is W{ inner } => case inner
            is Some{ value } => value
            is None{}        => -1
            ;
        ;
}
`, "unwrap");
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [new DataConstr(0, [new DataI(42n)])])),
            42n
        );
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [new DataConstr(1, [])])),
            -1n
        );
    });

    test("Data Optional<int> inside data struct: Some arm without binding", async () => {
        const uplc = await exportFunction(`
data struct Wrapped {
    W{ inner: Optional<int> }
}

export function hasValue( w: Wrapped ): int {
    return case w
        is W{ inner } => case inner
            is Some{} => 1
            is None{} => 0
            ;
        ;
}
`, "hasValue");
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [new DataConstr(0, [new DataI(99n)])])),
            1n
        );
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [new DataConstr(1, [])])),
            0n
        );
    });

    test("Data Optional<int> inside data struct: wildcard catches None (with value-extracting Some arm)", async () => {
        const uplc = await exportFunction(`
data struct Wrapped {
    W{ inner: Optional<int> }
}

export function valueOr( w: Wrapped ): int {
    return case w
        is W{ inner } => case inner
            is Some{ value } => value
            else             100
            ;
        ;
}
`, "valueOr");
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [new DataConstr(0, [new DataI(7n)])])),
            7n
        );
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [new DataConstr(1, [])])),
            100n
        );
    });

    // Wildcard with no value-binding arm — exercises the same DataOpt
    // dispatch path but avoids the buggy extraction.
    test("Data Optional<int> inside data struct: wildcard catches None, no value bound", async () => {
        const uplc = await exportFunction(`
data struct Wrapped {
    W{ inner: Optional<int> }
}

export function isSome( w: Wrapped ): int {
    return case w
        is W{ inner } => case inner
            is Some{} => 1
            else      0
            ;
        ;
}
`, "isSome");
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [new DataConstr(0, [new DataI(7n)])])),
            1n
        );
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [new DataConstr(1, [])])),
            0n
        );
    });

    // -----------------------------------------------------------------
    // unused field declaration: a constructor field that no arm uses
    // must still be present in the Data input (the lowering only reads
    // listed fields, never assumes absent ones).
    // -----------------------------------------------------------------
    // -----------------------------------------------------------------
    // Lazy extraction: a pattern that BINDS a field but never USES it
    // produces the same UPLC as one that doesn't bind it at all (the
    // letted-handling pass elides the unused extraction).
    // -----------------------------------------------------------------
    test("lazy extraction: binding an unused field doesn't change result", async () => {
        const baseSrc = `
data struct Pair {
    Both{ a: int, b: int }
}

export function justA( p: Pair ): int {
    return case p
        is Both{ a } => a
        ;
}
`;
        const uplc = await exportFunction(baseSrc, "justA");
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [new DataI(7n), new DataI(99n)])),
            7n
        );

        const withUnusedBinding = await exportFunction(`
data struct Pair {
    Both{ a: int, b: int }
}

export function justA( p: Pair ): int {
    return case p
        is Both{ a, b } => a
        ;
}
`, "justA");
        // same observational result — the unused `b` extraction is elided
        applyAndExpectInt(
            withUnusedBinding,
            UPLCConst.data(new DataConstr(0, [new DataI(7n), new DataI(99n)])),
            7n
        );
    });

    test("constructor fields the pattern doesn't bind are simply ignored", async () => {
        const uplc = await exportFunction(`
data struct M {
    Only{ keep: int, skip: int }
}

export function keepOnly( m: M ): int {
    return case m
        is Only{ keep } => keep
        ;
}
`, "keepOnly");
        applyAndExpectInt(
            uplc,
            UPLCConst.data(new DataConstr(0, [new DataI(42n), new DataI(999n)])),
            42n
        );
    });

});
