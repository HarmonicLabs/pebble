// Second-axis sweep: contract/state/redeemer shapes, Value & LinearMap fields.
// The field-type matrix (audit-field-matrix.mjs) covers plain struct fields.
// This covers the shapes a REAL validator uses, which the matrix does not reach.
// Everything is asserted by evaluation or by a real compile of a contract.
import { Compiler, createMemoryCompilerIoApi, testOptions, COMPILER_VERSION, fromUtf8, parseUPLC, Application, UPLCConst, Machine } from "../packages/pebble/dist/index.js";
const origErr = console.error, L = console.log;
function mkio(f) { return createMemoryCompilerIoApi({ sources: new Map([["src/main.pebble", fromUtf8(f)]]), useConsoleAsOutput: false }); }

// compile-only (contracts have no `main` to evaluate)
async function compiles(src) {
  const io = mkio(src); const c = new Compiler(io, { ...testOptions, compilerVersion: COMPILER_VERSION });
  console.error = () => {};
  try {
    await c.check({ entry: "src/main.pebble", root: "/" });
    const d = c.diagnostics.map(x => x.toString().replace(/\s+/g, " ").trim());
    console.error = origErr;
    return d.length ? "CHECK: " + JSON.stringify(d).slice(0, 100) : "CLEAN";
  } catch (e) { console.error = origErr; return "CHECK THREW: " + String(e?.message ?? e).slice(0, 80); }
}
async function ev(src, arg = 5n) {
  const io = mkio(src); const c = new Compiler(io, { ...testOptions, compilerVersion: COMPILER_VERSION });
  console.error = () => {};
  try {
    await c.check({ entry: "src/main.pebble", root: "/" });
    const d = c.diagnostics.map(x => x.toString().replace(/\s+/g, " ").trim());
    if (d.length) { console.error = origErr; return "CHECK: " + JSON.stringify(d).slice(0, 95); }
  } catch (e) { console.error = origErr; return "CHECK THREW: " + String(e?.message ?? e).slice(0, 75); }
  const io2 = mkio(src); const c2 = new Compiler(io2, { ...testOptions, compilerVersion: COMPILER_VERSION });
  try {
    await c2.export({ functionName: "main", entry: "src/main.pebble", root: "/" });
    const u = parseUPLC(io2.outputs.get("out/out.flat")).body;
    const r = Machine.eval(new Application(u, UPLCConst.int(arg))).result;
    console.error = origErr;
    return r?.value !== undefined ? String(r.value) : "RUNTIME " + r?.constructor?.name + ": " + String(r?.msg ?? "").slice(0, 40);
  } catch (e) { console.error = origErr; return "EXPORT THREW: " + String(e?.message ?? e).slice(0, 75); }
}
const E = async (label, src, expect = "5") => {
  const got = await ev(src);
  L(`  ${label.padEnd(46)}: ${String(got).padEnd(12)} ${got === expect ? "ok" : "  <<<<<<<<<< expected " + expect}`);
};
const C = async (label, src) => {
  const got = await compiles(src);
  L(`  ${label.padEnd(46)}: ${got === "CLEAN" ? "CLEAN        ok" : got + "   <<<<<<<<<<"}`);
};
const H = t => L(`\n${"=".repeat(96)}\n${t}\n${"=".repeat(96)}`);

H("A. LinearMap — construction via cast (the form the tests actually use)");
await C("LinearMap as struct field + typed lookup", `
struct D { A{ metadata: LinearMap<bytes, bytes>, version: int } B{ idx: int } }
contract T {
    spend s( redeemer: data ) {
        const { tx } = context;
        const m = std.builtins.unMapData( redeemer ) as LinearMap<bytes, bytes>;
        assert m.lookup( #01 ) is Some;
        assert tx.inputs.length() > 0;
    }
}`);
await C("LinearMap via type alias", `
type Meta = LinearMap<bytes, bytes>;
contract T {
    spend s( redeemer: data ) {
        const { tx } = context;
        const m = std.builtins.unMapData( redeemer ) as Meta;
        assert m.lookup( #01 ) is Some;
        assert tx.inputs.length() > 0;
    }
}`);

H("B. Contract / state / redeemer shapes");
await C("single spend, typed struct redeemer", `
data struct R { Go{ amt: int } Stop{} }
contract T {
    spend s( redeemer: R ) {
        const { tx } = context;
        match (redeemer) { when Go{ amt }: { assert amt > 0; } when Stop{}: { assert tx.inputs.length() > 0; } }
    }
}`);
await C("stateful contract, 2 states, datum struct", `
data struct D { Open{ owner: bytes } Closed{ at: int } }
contract T {
    state Open2 {
        spend claim( datum: D, redeemer: int ) { const { tx } = context; assert redeemer > 0; assert tx.inputs.length() > 0; }
    }
    state Closed2 {
        spend reopen( datum: D, redeemer: int ) { const { tx } = context; assert tx.inputs.length() > 0; }
    }
}`);
await C("mint + spend in one contract", `
contract T {
    mint init( redeemer: int ) { const { tx } = context; assert redeemer > 0; }
    spend s( redeemer: int ) { const { tx } = context; assert tx.inputs.length() > 0; }
}`);
// NOTE: contract params are declared `param x: T;` INSIDE the body — not
// constructor-style parens. An earlier version of this file used the latter and
// reported a false positive.
await C("contract params read via this.", `
contract T {
    param owner: bytes;
    spend s( redeemer: int ) { const { tx } = context; assert tx.requiredSigners.includes( this.owner ); }
}`);
await C("generic struct as a redeemer type", `
data struct Box<T> { B{ value: T } }
contract T {
    spend s( redeemer: Box<int> ) { const { tx } = context; const v = case redeemer is B{ value } => value ; assert v > 0; }
}`);
await C("recursive struct as a datum type", `
data struct L { Nil{} Cons{ h: int, t: L } }
contract T {
    spend s( datum: L, redeemer: int ) { const { tx } = context; const h = case datum is Cons{ h, t } => h is Nil{} => 0 ; assert h >= 0; }
}`);

H("C. Value / prelude types as struct fields (round-trip by evaluation)");
await E("Value field in a data struct", `
data struct S { C{ v: Value, n: int } }
export function main( n: int ): int { const s: S = S.C{ v: std.value.zero, n: n }; return case s is C{ v, n: m } => m ; }`);
await E("Value field in a runtime struct", `
runtime struct S { C{ v: Value, n: int } }
export function main( n: int ): int { const s: S = S.C{ v: std.value.zero, n: n }; return case s is C{ v, n: m } => m ; }`);
await E("Value in a MULTI-ctor data struct", `
data struct S { A{ a: int } B{ v: Value, n: int } }
export function main( n: int ): int { const s: S = S.B{ v: std.value.zero, n: n }; return case s is A{ a } => 999 is B{ v, n: m } => m ; }`);
await E("bytes+bool+list mixed multi-field", `
data struct S { A{ a: int } B{ f: bool, g: bytes, h: List<int> } }
export function main( n: int ): int { const s: S = S.B{ f: true, g: #05, h: [ n ] }; return case s is A{ a } => 999 is B{ f, g, h } => ( f ? h.head() : 0 ) ; }`);
await E("3 ctors, payload in the THIRD", `
data struct S { A{ a: int } B{ b: bytes } C3{ f: bool, xs: List<int> } }
export function main( n: int ): int { const s: S = S.C3{ f: true, xs: [ n ] }; return case s is A{ a } => 901 is B{ b } => 902 is C3{ f, xs } => ( f ? xs.head() : 0 ) ; }`);
await E("runtime 3 ctors, payload in the THIRD", `
runtime struct S { A{ a: int } B{ b: bytes } C3{ f: bool, xs: List<int> } }
export function main( n: int ): int { const s: S = S.C3{ f: true, xs: [ n ] }; return case s is A{ a } => 901 is B{ b } => 902 is C3{ f, xs } => ( f ? xs.head() : 0 ) ; }`);
await E("Optional<struct> field", `
data struct In { I{ v: int } }
data struct S { A{ a: int } B{ o: Optional<In> } }
export function main( n: int ): int { const s: S = S.B{ o: Some{ value: In.I{ v: n } } }; return case s is A{ a } => 999 is B{ o } => ( case o is Some{ value } => ( case value is I{ v } => v ) is None{} => 0 ) ; }`);
await E("List<Optional<int>> field", `
data struct S { A{ a: int } B{ xs: List<Optional<int>> } }
export function main( n: int ): int { const s: S = S.B{ xs: [ Some{ value: n } ] }; return case s is A{ a } => 999 is B{ xs } => ( case xs.head() is Some{ value } => value is None{} => 0 ) ; }`);

L("\nCOMPILER_VERSION = " + COMPILER_VERSION);
