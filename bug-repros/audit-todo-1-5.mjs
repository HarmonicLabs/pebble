// TODO items 1-5 from PEBBLE_BUGS.md, verified by evaluation where applicable.
import { Compiler, createMemoryCompilerIoApi, testOptions, COMPILER_VERSION, fromUtf8, parseUPLC, Application, UPLCConst, Machine } from "../packages/pebble/dist/index.js";
const origErr = console.error, L = console.log;
function mkio(f) { return createMemoryCompilerIoApi({ sources: new Map([["src/main.pebble", fromUtf8(f)]]), useConsoleAsOutput: false }); }
async function run(src, arg = 5n) {
  const io = mkio(src); const c = new Compiler(io, { ...testOptions, compilerVersion: COMPILER_VERSION });
  console.error = () => {};
  try {
    await c.check({ entry: "src/main.pebble", root: "/" });
    const d = c.diagnostics.map(x => x.toString().replace(/\s+/g, " ").trim());
    if (d.length) { console.error = origErr; return "check: " + JSON.stringify(d).slice(0, 118); }
  } catch (e) { console.error = origErr; return "CHECK THREW: " + String(e?.message ?? e).slice(0, 90); }
  const io2 = mkio(src); const c2 = new Compiler(io2, { ...testOptions, compilerVersion: COMPILER_VERSION });
  try {
    await c2.export({ functionName: "main", entry: "src/main.pebble", root: "/" });
    const u = parseUPLC(io2.outputs.get("out/out.flat")).body;
    const r = Machine.eval(new Application(u, UPLCConst.int(arg))).result;
    console.error = origErr;
    return "eval-> " + (r?.value !== undefined ? String(r.value) : r?.constructor?.name + ": " + String(r?.msg ?? "").slice(0, 50));
  } catch (e) { console.error = origErr; return "EXPORT THREW: " + String(e?.message ?? e).slice(0, 90); }
}
const T = async (label, src, expect) => {
  const got = await run(src);
  const ok = expect !== undefined && got === `eval-> ${expect}`;
  L(`  ${label.padEnd(44)}: ${got}${expect !== undefined ? (ok ? "  ok" : `  <<< expected eval-> ${expect}`) : ""}`);
};
const H = t => L(`\n${"=".repeat(100)}\n${t}\n${"=".repeat(100)}`);
const M = `\nexport function main( n: int ): int { return n; }`;

H("TODO 1 — BUG 41: data struct with a List field (CRITICAL, silent miscompile)");
await T("non-generic data struct, List<int> field",
  `data struct Bx { B{ items: List<int> } }
export function main( n: int ): int { const b: Bx = Bx.B{ items: [ n, n+1 ] }; return case b is B{ items } => items.head() ; }`, "5");
await T("generic data struct, List<T> @int",
  `data struct Box<T> { B{ items: List<T> } }
export function main( n: int ): int { const b: Box<int> = Box.B{ items: [ n, n+1 ] }; return case b is B{ items } => items.head() ; }`, "5");
await T("generic data struct, List<T> @bytes",
  `data struct Box<T> { B{ items: List<T> } }
export function main( n: int ): int { const b: Box<bytes> = Box.B{ items: [ #ff ] }; return case b is B{ items } => ( items.head() == #ff ? 1 : 0 ) ; }`, "1");
await T("read 2nd elem of a struct's list field",
  `data struct Bx { B{ items: List<int> } }
export function main( n: int ): int { const b: Bx = Bx.B{ items: [ n, n+1 ] }; return case b is B{ items } => items.tail().head() ; }`, "6");
await T("nested: struct field List of structs",
  `data struct In { I{ v: int } }
data struct Out { O{ xs: List<In> } }
export function main( n: int ): int { const o: Out = Out.O{ xs: [ In.I{ v: n } ] }; return case o is O{ xs } => ( case xs.head() is I{ v } => v ) ; }`, "5");
await T("control: runtime struct, List<T> field",
  `runtime struct Box<T> { B{ items: List<T> } }
export function main( n: int ): int { const b: Box<int> = Box.B{ items: [ n, n+1 ] }; return case b is B{ items } => items.head() ; }`, "5");
await T("control: Optional<T> field",
  `data struct Box<T> { B{ v: Optional<T> } }
export function main( n: int ): int { const b: Box<int> = Box.B{ v: Some{ value: n } }; return case b is B{ v } => ( case v is Some{ value } => value is None{} => 0 ) ; }`, "5");

H("TODO 2 — generic type aliases");
await T("type Al<T> = T;", `type Al<T> = T;` + M);
await T("generic alias used in a signature",
  `type Al<T> = T;
function idA( x: Al<int> ): int { return x; }
export function main( n: int ): int { return idA( n ); }`, "5");
await T("generic alias over a container", `type Lst<T> = List<T>;` + M);

H("TODO 3 — `self` parameter inference in interface impls");
await T("user interface + impl",
  `interface Sh { sh( self ): int }
data struct Foo { F{ a: int } }
type Foo implements Sh { sh( self ): int { return 42; } }` + M);
await T("impl method actually called",
  `interface Sh { sh( self ): int }
data struct Foo { F{ a: int } }
type Foo implements Sh { sh( self ): int { return 42; } }
export function main( n: int ): int { const f: Foo = Foo.F{ a: n }; return f.sh(); }`, "42");
await T("impl reading self's field",
  `interface Sh { sh( self ): int }
data struct Foo { F{ a: int } }
type Foo implements Sh { sh( self ): int { return case self is F{ a } => a ; } }
export function main( n: int ): int { const f: Foo = Foo.F{ a: n }; return f.sh(); }`, "5");

H("TODO 4 — constraint-based dispatch at monomorphization (Stage 4b)");
await T("<T implements ToData> @int",
  `function conv<T implements ToData>( x: T ): data { return x.toData(); }
export function main( n: int ): int { const d: data = conv<int>( n ); return n; }`, "5");
await T("<T implements ToData> @struct",
  `data struct Foo { F{ a: int } }
function conv<T implements ToData>( x: T ): data { return x.toData(); }
export function main( n: int ): int { const f: Foo = Foo.F{ a: n }; const d: data = conv<Foo>( f ); return n; }`, "5");
await T("user interface as a bound, method used",
  `interface Sh { sh( self ): int }
data struct Foo { F{ a: int } }
type Foo implements Sh { sh( self ): int { return 7; } }
function useSh<T implements Sh>( x: T ): int { return x.sh(); }
export function main( n: int ): int { const f: Foo = Foo.F{ a: n }; return useSh<Foo>( f ); }`, "7");

H("TODO 5 — parameter inference (the 'full inference' claim)");
await T("param annotation omitted", `function f( x ): int { return x + 1; }` + M);
await T("omitted param, actually called",
  `function f( x ): int { return x + 1; }
export function main( n: int ): int { return f( n ); }`, "6");
await T("omitted param AND return", `function f( x ) { return x + 1; }` + M);
await T("control: annotated", `function f( x: int ): int { return x + 1; }
export function main( n: int ): int { return f( n ); }`, "6");

L("\nCOMPILER_VERSION = " + COMPILER_VERSION);
