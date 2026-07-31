// M1.A feature audit against the local build.
// Checks BOTH typecheck and evaluation — a clean check() is not evidence the
// feature works, as the 0.4.1 audit showed repeatedly.
import { Compiler, createMemoryCompilerIoApi, testOptions, COMPILER_VERSION, fromUtf8, parseUPLC, Application, UPLCConst, Machine } from "../packages/pebble/dist/index.js";

const origErr = console.error, L = console.log;
function mkio(files) {
  return createMemoryCompilerIoApi({ sources: new Map(Object.entries(files).map(([k, v]) => [k, fromUtf8(v)])), useConsoleAsOutput: false });
}
async function check(src) {
  const io = mkio({ "src/main.pebble": src });
  const c = new Compiler(io, { ...testOptions, compilerVersion: COMPILER_VERSION });
  console.error = () => {};
  try { await c.check({ entry: "src/main.pebble", root: "/" });
    const d = c.diagnostics.map(x => x.toString().replace(/\s+/g, " ").trim());
    console.error = origErr; return d.length ? JSON.stringify(d).slice(0, 125) : "CLEAN";
  } catch (e) { console.error = origErr; return "THREW: " + String(e?.message ?? e).slice(0, 95); }
}
async function ev(src, arg = 5n) {
  const io = mkio({ "src/main.pebble": src });
  const c = new Compiler(io, { ...testOptions, compilerVersion: COMPILER_VERSION });
  console.error = () => {};
  try {
    await c.export({ functionName: "main", entry: "src/main.pebble", root: "/" });
    const u = parseUPLC(io.outputs.get("out/out.flat")).body;
    const r = Machine.eval(new Application(u, UPLCConst.int(arg))).result;
    console.error = origErr;
    return r?.value !== undefined ? String(r.value) : (r?.constructor?.name + ": " + String(r?.msg ?? "").slice(0, 45));
  } catch (e) { console.error = origErr; return "THREW: " + String(e?.message ?? e).slice(0, 85); }
}
const T = async (label, src, expect) => {
  const ck = await check(src);
  let line = `  ${label.padEnd(38)}: ${ck}`;
  if (ck === "CLEAN" && expect !== undefined) {
    const got = await ev(src);
    line += `  | eval-> ${got}${got === expect ? " ok" : `  <<< expected ${expect}`}`;
  }
  L(line);
};
const H = t => L(`\n${"=".repeat(96)}\n${t}\n${"=".repeat(96)}`);
const M = `\nexport function main( n: int ): int { return n; }`;

H("1. GENERIC STRUCTS");
await T("declare generic struct", `data struct Box<T> { B{ value: T } }` + M);
await T("declare generic runtime struct", `runtime struct Box<T> { B{ value: T } }` + M);
await T("construct + read Box<int>",
  `data struct Box<T> { B{ value: T } }
export function main( n: int ): int { const b: Box<int> = Box.B{ value: n }; return case b is B{ value } => value ; }`, "5");
await T("generic multi-ctor Result<T,E>",
  `data struct Result<T,E> { Ok{ v: T } Err{ e: E } }
export function main( n: int ): int { const r: Result<int,bytes> = Result.Ok{ v: n }; return case r is Ok{ v } => v is Err{ e } => 0 ; }`, "5");
await T("Result Err branch",
  `data struct Result<T,E> { Ok{ v: T } Err{ e: E } }
export function main( n: int ): int { const r: Result<int,bytes> = Result.Err{ e: #ff }; return case r is Ok{ v } => v is Err{ e } => 99 ; }`, "99");
await T("two instantiations coexist",
  `data struct Box<T> { B{ value: T } }
export function main( n: int ): int { const a: Box<int> = Box.B{ value: n }; const b: Box<bytes> = Box.B{ value: #ff }; return case a is B{ value } => value ; }`, "5");
await T("nested Box<Box<int>>",
  `data struct Box<T> { B{ value: T } }
export function main( n: int ): int { const b: Box<Box<int>> = Box.B{ value: Box.B{ value: n } }; return case b is B{ value } => case value is B{ value: inner } => inner ; }`, "5");
await T("generic type alias", `type Al<T> = T;` + M);
await T("generic struct as fn param",
  `data struct Box<T> { B{ value: T } }
function unbox<T>( b: Box<T> ): T { return case b is B{ value } => value ; }
export function main( n: int ): int { const b: Box<int> = Box.B{ value: n }; return unbox<int>( b ); }`, "5");

H("2. RECURSIVE STRUCTS");
await T("recursive list decl", `data struct L { Nil{} Cons{ h: int, t: L } }` + M);
await T("recursive tree decl", `data struct Tr { Leaf{ v: int } Node{ l: Tr, r: Tr } }` + M);
await T("build + walk a 2-elem list",
  `data struct L { Nil{} Cons{ h: int, t: L } }
export function main( n: int ): int {
    const l: L = L.Cons{ h: n, t: L.Cons{ h: n + 1, t: L.Nil{} } };
    return case l is Cons{ h, t } => h is Nil{} => 0 ;
}`, "5");
await T("read the SECOND element",
  `data struct L { Nil{} Cons{ h: int, t: L } }
export function main( n: int ): int {
    const l: L = L.Cons{ h: n, t: L.Cons{ h: n + 1, t: L.Nil{} } };
    return case l is Cons{ h, t } => ( case t is Cons{ h: h2, t: t2 } => h2 is Nil{} => 0 ) is Nil{} => 0 ;
}`, "6");
await T("generic recursive list List2<T>",
  `data struct List2<T> { Nil{} Cons{ h: T, t: List2<T> } }
export function main( n: int ): int {
    const l: List2<int> = List2.Cons{ h: n, t: List2.Nil{} };
    return case l is Cons{ h, t } => h is Nil{} => 0 ;
}`, "5");

H("3. BUG 40 — function-type annotations (the `require` crash)");
await T("HOF param declared",
  `function ap( f: (a: int) => int, x: int ): int { return f( x ); }` + M);
await T("HOF called with a lambda",
  `function ap( f: (a: int) => int, x: int ): int { return f( x ); }
export function main( n: int ): int { return ap( y => y + 1, n ); }`, "6");
await T("user-written map<A,B>",
  `function myMap<A,B>( xs: List<A>, f: (a: A) => B ): List<B> { return xs.map( f ); }
export function main( n: int ): int { const l: List<int> = [ n ]; const r: List<int> = myMap<int,int>( l, x => x * 3 ); return r.head(); }`, "15");
await T("user-written fold",
  `function myFold<A,B>( xs: List<A>, z: B, f: (acc: B, x: A) => B ): B { return xs.reduce( z, f ); }` + M);

H("4. REMAINING GAPS from the last review");
await T("interface user impl (self inference)",
  `interface Sh { sh( self ): int }
data struct Foo { F{ a: int } }
type Foo implements Sh { sh( self ): int { return 42; } }` + M);
await T("constraint dispatch <T implements ToData>",
  `function conv<T implements ToData>( x: T ): data { return x.toData(); }
export function main( n: int ): int { const d: data = conv<int>( n ); return n; }`);
await T("param annotation omitted (full inference)", `function f( x ): int { return x + 1; }` + M);
await T("re-export `export * from`", `export * from "./lib.pebble";` + M);

H("5. NO-REGRESSION spot checks on previously fixed bugs");
await T("BUG 27 SoP ctor index",
  `runtime struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int { const v: T = T.B{ y: n }; return case v is A{ x } => 111 is B{ y } => 222 ; }`, "222");
await T("BUG 28 non-exhaustive case rejected",
  `data struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int { const v: T = T.A{ x: n }; return case v is A{ x } => 111 ; }`);
await T("BUG 39 list.map",
  `export function main( n: int ): int { const l: List<int> = [ n ]; const r: List<int> = l.map( x => x * 10 ); return r.head(); }`, "50");
await T("BUG 34 return inference if/else",
  `function f( n: int ) { if( n > 0 ) { return 1; } else { return 2; } }
export function main( n: int ): int { return f( n ); }`, "1");

L("\nCOMPILER_VERSION = " + COMPILER_VERSION);
