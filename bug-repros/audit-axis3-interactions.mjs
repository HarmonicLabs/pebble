// Third-axis sweep: INTERACTIONS between features that landed independently
// (generic structs, recursive structs, HOFs/function types, interfaces + self,
// constraint dispatch, namespaces). Each landed on its own; their combinations
// are what no test covers. Everything asserted by evaluation.
import { Compiler, createMemoryCompilerIoApi, testOptions, COMPILER_VERSION, fromUtf8, parseUPLC, Application, UPLCConst, Machine } from "../packages/pebble/dist/index.js";
const origErr = console.error, L = console.log;
function mkio(f) { return createMemoryCompilerIoApi({ sources: new Map([["src/main.pebble", fromUtf8(f)]]), useConsoleAsOutput: false }); }
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
const T = async (label, src, expect = "5") => {
  const got = await ev(src);
  L(`  ${label.padEnd(50)}: ${String(got).padEnd(12)} ${got === expect ? "ok" : "  <<<<<<<<<< expected " + expect}`);
};
const H = t => L(`\n${"=".repeat(100)}\n${t}\n${"=".repeat(100)}`);

H("A. generics x recursion");
await T("generic recursive list, recursive generic fn", `
data struct L2<T> { Nil{} Cons{ h: T, t: L2<T> } }
function len<T>( l: L2<T> ): int { return case l is Cons{ h, t } => 1 + len<T>( t ) is Nil{} => 0 ; }
export function main( n: int ): int { const l: L2<int> = L2.Cons{ h: n, t: L2.Cons{ h: n, t: L2.Cons{ h: n, t: L2.Nil{} } } }; return len<int>( l ) + 2; }`);
await T("generic recursive TREE, depth", `
data struct Tr<T> { Leaf{ v: T } Node{ l: Tr<T>, r: Tr<T> } }
function depth<T>( t: Tr<T> ): int { return case t is Leaf{ v } => 1 is Node{ l, r } => 1 + ( depth<T>( l ) > depth<T>( r ) ? depth<T>( l ) : depth<T>( r ) ) ; }
export function main( n: int ): int { const t: Tr<int> = Tr.Node{ l: Tr.Leaf{ v: n }, r: Tr.Node{ l: Tr.Leaf{ v: n }, r: Tr.Leaf{ v: n } } }; return depth<int>( t ) + 2; }`);
await T("generic recursive, runtime encoding", `
runtime struct L2<T> { Nil{} Cons{ h: T, t: L2<T> } }
function len<T>( l: L2<T> ): int { return case l is Cons{ h, t } => 1 + len<T>( t ) is Nil{} => 0 ; }
export function main( n: int ): int { const l: L2<int> = L2.Cons{ h: n, t: L2.Cons{ h: n, t: L2.Nil{} } }; return len<int>( l ) + 3; }`);
await T("generic recursive instantiated at a STRUCT", `
data struct In { I{ v: int } }
data struct L2<T> { Nil{} Cons{ h: T, t: L2<T> } }
export function main( n: int ): int { const l: L2<In> = L2.Cons{ h: In.I{ v: n }, t: L2.Nil{} }; return case l is Cons{ h, t } => ( case h is I{ v } => v ) is Nil{} => 0 ; }`);
await T("generic recursive instantiated at List<int>", `
data struct L2<T> { Nil{} Cons{ h: T, t: L2<T> } }
export function main( n: int ): int { const l: L2<List<int>> = L2.Cons{ h: [ n ], t: L2.Nil{} }; return case l is Cons{ h, t } => h.head() is Nil{} => 0 ; }`);

H("B. generics x higher-order functions");
await T("HOF over a generic recursive structure (fold)", `
data struct L2<T> { Nil{} Cons{ h: T, t: L2<T> } }
function foldL<A,B>( l: L2<A>, z: B, f: (acc: B, x: A) => B ): B { return case l is Cons{ h, t } => foldL<A,B>( t, f( z, h ), f ) is Nil{} => z ; }
export function main( n: int ): int { const l: L2<int> = L2.Cons{ h: n, t: L2.Cons{ h: n, t: L2.Nil{} } }; return foldL<int,int>( l, 0, ( a, x ) => a + x ) - 5; }`);
await T("HOF returning a generic struct", `
data struct Box<T> { B{ value: T } }
function mk<A,B>( x: A, f: (a: A) => B ): Box<B> { return Box.B{ value: f( x ) }; }
export function main( n: int ): int { const b: Box<int> = mk<int,int>( n, x => x + 0 ); return case b is B{ value } => value ; }`);
await T("HOF taking a HOF, generic", `
function twice<A>( f: (a: A) => A, x: A ): A { return f( f( x ) ); }
export function main( n: int ): int { return twice<int>( y => y + 0, n ); }`);

H("C. interfaces x generics x structs");
await T("generic fn bounded by a USER interface", `
interface Sh { sh( self ): int }
data struct Foo { F{ a: int } }
type Foo implements Sh { sh( self ): int { return case self is F{ a } => a ; } }
function useSh<T implements Sh>( x: T ): int { return x.sh(); }
export function main( n: int ): int { const f: Foo = Foo.F{ a: n }; return useSh<Foo>( f ); }`);
await T("interface impl on a GENERIC struct", `
interface Sh { sh( self ): int }
data struct Box<T> { B{ value: T } }
type Box<int> implements Sh { sh( self ): int { return case self is B{ value } => value ; } }
export function main( n: int ): int { const b: Box<int> = Box.B{ value: n }; return b.sh(); }`);
await T("two impls, dispatch picks the right one", `
interface Sh { sh( self ): int }
data struct A1 { A{ a: int } }
data struct B1 { B{ b: int } }
type A1 implements Sh { sh( self ): int { return 100; } }
type B1 implements Sh { sh( self ): int { return case self is B{ b } => b ; } }
function useSh<T implements Sh>( x: T ): int { return x.sh(); }
export function main( n: int ): int { const b: B1 = B1.B{ b: n }; return useSh<B1>( b ); }`);

H("D. namespaces x generics x recursion");
await T("generic struct declared inside a namespace", `
namespace M { data struct Box<T> { B{ value: T } } }
export function main( n: int ): int { const b: M.Box<int> = M.Box.B{ value: n }; return case b is B{ value } => value ; }`);
await T("recursive struct inside a namespace", `
namespace M { data struct L { Nil{} Cons{ h: int, t: L } } }
export function main( n: int ): int { const l: M.L = M.L.Cons{ h: n, t: M.L.Nil{} }; return case l is Cons{ h, t } => h is Nil{} => 0 ; }`);
await T("generic fn in a namespace, called qualified", `
namespace M { export function id2<T>( x: T ): T { return x; } }
export function main( n: int ): int { return M.id2<int>( n ); }`);

H("E. cross-module (import) x generics x recursion");
// multi-file variant needs its own io setup
async function evFiles(files, arg = 5n) {
  const mk = () => createMemoryCompilerIoApi({ sources: new Map(Object.entries(files).map(([k, v]) => [k, fromUtf8(v)])), useConsoleAsOutput: false });
  const c = new Compiler(mk(), { ...testOptions, compilerVersion: COMPILER_VERSION });
  console.error = () => {};
  try {
    await c.check({ entry: "src/main.pebble", root: "/" });
    const d = c.diagnostics.map(x => x.toString().replace(/\s+/g, " ").trim());
    if (d.length) { console.error = origErr; return "CHECK: " + JSON.stringify(d).slice(0, 95); }
  } catch (e) { console.error = origErr; return "CHECK THREW: " + String(e?.message ?? e).slice(0, 75); }
  const io2 = mk(); const c2 = new Compiler(io2, { ...testOptions, compilerVersion: COMPILER_VERSION });
  try {
    await c2.export({ functionName: "main", entry: "src/main.pebble", root: "/" });
    const u = parseUPLC(io2.outputs.get("out/out.flat")).body;
    const r = Machine.eval(new Application(u, UPLCConst.int(arg))).result;
    console.error = origErr;
    return r?.value !== undefined ? String(r.value) : "RUNTIME " + r?.constructor?.name + ": " + String(r?.msg ?? "").slice(0, 40);
  } catch (e) { console.error = origErr; return "EXPORT THREW: " + String(e?.message ?? e).slice(0, 75); }
}
const TF = async (label, files, expect = "5") => {
  const got = await evFiles(files);
  L(`  ${label.padEnd(50)}: ${String(got).padEnd(12)} ${got === expect ? "ok" : "  <<<<<<<<<< expected " + expect}`);
};
await TF("imported GENERIC struct", {
  "src/lib.pebble": `export data struct Box<T> { B{ value: T } }`,
  "src/main.pebble": `import { Box } from "./lib.pebble";
export function main( n: int ): int { const b: Box<int> = Box.B{ value: n }; return case b is B{ value } => value ; }`,
});
await TF("imported RECURSIVE struct", {
  "src/lib.pebble": `export data struct L { Nil{} Cons{ h: int, t: L } }`,
  "src/main.pebble": `import { L } from "./lib.pebble";
export function main( n: int ): int { const l: L = L.Cons{ h: n, t: L.Nil{} }; return case l is Cons{ h, t } => h is Nil{} => 0 ; }`,
});
await TF("imported generic HOF", {
  "src/lib.pebble": `export function ap<A,B>( f: (a: A) => B, x: A ): B { return f( x ); }`,
  "src/main.pebble": `import { ap } from "./lib.pebble";
export function main( n: int ): int { return ap<int,int>( y => y + 0, n ); }`,
});
await TF("imported interface + impl", {
  "src/lib.pebble": `export interface Sh { sh( self ): int }
export data struct Foo { F{ a: int } }
type Foo implements Sh { sh( self ): int { return case self is F{ a } => a ; } }`,
  "src/main.pebble": `import { Sh, Foo } from "./lib.pebble";
export function main( n: int ): int { const f: Foo = Foo.F{ a: n }; return f.sh(); }`,
});

L("\nCOMPILER_VERSION = " + COMPILER_VERSION);
