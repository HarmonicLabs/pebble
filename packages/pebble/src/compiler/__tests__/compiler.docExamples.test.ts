import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

/**
 * Each runnable Pebble snippet on https://pebble.harmoniclabs.tech is
 * mirrored here as a `compiler.run(...)` invocation so we catch the moment
 * a doc example stops compiling or starts failing at runtime.
 *
 * Coverage rule: every `<RunnableExample initialCode={`...`}/>` block under
 * `pebble-docs/docs/` MUST have a matching test here. If a doc example
 * cannot be expressed as runnable top-level Pebble (e.g. it needs a
 * contract/transaction context), it stays as a static ```ts code block in
 * the docs — not inside `<RunnableExample>` — and gets no test entry here.
 *
 * Each entry below quotes the snippet verbatim so reviewers can diff against
 * the .mdx file directly.
 */

async function runSrc( src: string )
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([
            ["main.pebble", fromUtf8(src)],
        ]),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    const result = await compiler.run({ entry: "main.pebble", root: "/" });
    return { compiler, result };
}

function expectClean( compiler: Compiler, result: { result?: { tag: number } } )
{
    expect( compiler.diagnostics ).toEqual( [] );
    // CEKValueTag.Error === 5. Anything else means execution finished normally.
    expect( result.result?.tag ).not.toBe( 5 );
}

describe("doc examples — every `<RunnableExample>` snippet compiles and executes cleanly", () => {

    // ------------------------------------------------------------------
    // docs/Welcome to Pebble.mdx
    // ------------------------------------------------------------------

    test("Welcome — for-loop sum to 55", async () => {
        const src = `
const n = 10;

let result = 0;
for( let i = 0; i <= n; i++ ) {
    result += i;
}

assert result == 55 else "boom";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Prelude/Int.mdx
    // ------------------------------------------------------------------

    test("Prelude / int — supply minus spent", async () => {
        const src = `
const supply: int = 1_000_000;
let   spent:  int = 500;

const left = supply - spent;
assert left >= 0       else "underflow";
assert left == 999_500 else "math off";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Prelude/Bytes.mdx
    // ------------------------------------------------------------------

    test("Prelude / bytes — length / slice / encode round-trip", async () => {
        // NOTE: there is no `.toBytes()` method on a `string` literal in
        // Pebble; use `std.builtins.encodeUtf8` instead, or supply a hex
        // literal directly.
        const src = `
const policy:    bytes = #deadbeef;
const tokenName: bytes = #4d79546f6b656e;

assert std.bytes.length(policy) == 4         else "wrong width";
assert std.bytes.slice(1, 2, policy) == #adbe else "slice off";
assert tokenName == #4d79546f6b656e            else "utf-8 off";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Prelude/Array.mdx
    // ------------------------------------------------------------------

    test("Prelude / Array — fromList / at / length", async () => {
        const src = `
const xs: Array<int> = std.array.fromList([10, 20, 30, 40]);

assert std.array.length(xs) == 4 else "wrong length";
assert std.array.at(xs, 2)  == 30 else "at(2) wrong";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Prelude/List.mdx
    // ------------------------------------------------------------------

    test("Prelude / List — std.list namespace form (map is method-only)", async () => {
        const src = `
const xs: List<int> = [1, 2, 3, 4, 5];

const total = std.list.foldl((acc, n) => acc + n, 0, xs);
const evens = std.list.filter((n) => n % 2 == 0, xs);

assert total == 15                    else "sum wrong";
assert std.list.length(evens) == 2    else "filter wrong";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Standard Library/std.mdx
    // ------------------------------------------------------------------

    test("std — id / equals", async () => {
        const src = `
const a: int = 42;
const b: int = 42;

const same: boolean = std.equals(a, b);
assert same                  else "equals failed";
assert std.id(a) == 42       else "id failed";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Standard Library/std.int.mdx
    // ------------------------------------------------------------------

    test("std.int — add via foldl + isZero", async () => {
        // NOTE: `using { add, isZero } = std.int;` does not parse because
        // `int` is a reserved type-name token, not an identifier that the
        // namespace-import form accepts. Use fully-qualified names.
        const src = `
const amounts:  List<int> = [10, 20, 30, 40];
const expected: int       = 100;

const total = std.list.foldl(std.int.add, 0, amounts);
assert std.int.isZero(total - expected) else "sum off";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Standard Library/std.bytes.mdx
    // ------------------------------------------------------------------

    test("std.bytes — slice / concat round-trip", async () => {
        // NOTE: `using { … } = std.bytes;` does not parse — `bytes` is a
        // reserved type-name token. Use fully-qualified names.
        const src = `
const payload: bytes = #deadbeefcafe;

const head = std.bytes.slice(0, 4, payload);
const tail = std.bytes.slice(4, std.bytes.length(payload) - 4, payload);
const out  = std.bytes.concat(head, tail);

assert out == payload else "round-trip failed";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Standard Library/std.boolean.mdx
    // ------------------------------------------------------------------

    test("std.boolean — strictAnd over a list with one false", async () => {
        // NOTE: `using { … } = std.boolean;` does not parse — `boolean` is a
        // reserved type-name token. Use fully-qualified names. Also note
        // `bool` is not an alias for `boolean`.
        const src = `
const signs: List<boolean> = [true, true, true, false];

const allPositive: boolean = std.list.foldl(std.boolean.strictAnd, true, signs);
assert !allPositive else "expected one false";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Standard Library/std.data.mdx
    // ------------------------------------------------------------------

    test("std.data — strToData / strFromData round-trip", async () => {
        // NOTE: string literals like `"hello"` are typed as `bytes` in
        // Pebble, so we have to round-trip them through `decodeUtf8` to get
        // a `string`. Comparison is done bytes-wise to dodge the same issue.
        const src = `
const txt:  string = std.builtins.decodeUtf8(#68656c6c6f);
const d:    data   = std.data.strToData(txt);
const back: string = std.data.strFromData(d);

assert std.builtins.encodeUtf8(back) == std.builtins.encodeUtf8(txt) else "round-trip failed";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Standard Library/std.list.mdx
    //
    // This is the snippet that originally exposed the bug in this commit:
    // generic-call argument inference must propagate the expected function
    // type onto unannotated lambda arguments.
    // ------------------------------------------------------------------

    test("std.list — filter + foldl with unannotated lambdas", async () => {
        const src = `
using { foldl, filter } = std.list;

const evens = filter((n) => n % 2 == 0, [1, 2, 3, 4, 5]);
const sum   = foldl((acc, n) => acc + n, 0, evens);

assert sum == 6 else "expected 2+4 = 6";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Standard Library/std.array.mdx
    // ------------------------------------------------------------------

    test("std.array — fromList / at / length", async () => {
        const src = `
using { fromList, at, length } = std.array;

const xs = fromList([10, 20, 30]);

assert at(xs, 1)   == 20 else "at wrong";
assert length(xs)  == 3  else "length wrong";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Standard Library/std.crypto.mdx
    // ------------------------------------------------------------------

    test("std.crypto — sha2 / sha3 / blake2b output widths", async () => {
        // NOTE: there is no `.toBytes()` on a string literal — we feed the
        // hash a raw byte literal directly.
        const src = `
const payload: bytes = #68656c6c6f;

const d1 = std.crypto.sha2_256(payload);
const d2 = std.crypto.sha3_256(payload);
const d3 = std.crypto.blake2b_256(payload);

assert std.bytes.length(d1) == 32 else "sha2 width wrong";
assert std.bytes.length(d2) == 32 else "sha3 width wrong";
assert std.bytes.length(d3) == 32 else "blake2b width wrong";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });

    // ------------------------------------------------------------------
    // docs/onchain/Standard Library/std.crypto.bls12_381.mdx
    // ------------------------------------------------------------------

    test("std.crypto.bls12_381 — 2·P == P + P", async () => {
        // NOTE: `using { … } = std.crypto.bls12_381;` triggers an
        // expressify-stage "variable not found" failure when destructured
        // names are later closed over. Stick to fully-qualified calls.
        const src = `
const p      = std.crypto.bls12_381.g1HashToGroup(#68656c6c6f, #424c535f5349475f445354);
const pPlusP = std.crypto.bls12_381.g1Add(p, p);
const twoP   = std.crypto.bls12_381.g1ScalarMul(2, p);

assert std.crypto.bls12_381.g1Equal(pPlusP, twoP) else "2*P != P+P";`;
        const { compiler, result } = await runSrc( src );
        expectClean( compiler, result );
    });
});
