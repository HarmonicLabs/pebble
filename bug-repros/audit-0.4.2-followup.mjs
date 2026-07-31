import { Compiler, createMemoryCompilerIoApi, testOptions, COMPILER_VERSION, fromUtf8, parseUPLC, Application, UPLCConst, Machine } from "../packages/pebble/dist/index.js";
const origErr = console.error, L = console.log;
function mkio(files) {
  return createMemoryCompilerIoApi({ sources: new Map(Object.entries(files).map(([k, v]) => [k, fromUtf8(v)])), useConsoleAsOutput: false });
}
async function check(files, entry = "src/main.pebble") {
  const io = mkio(files);
  const c = new Compiler(io, { ...testOptions, compilerVersion: COMPILER_VERSION });
  console.error = () => {};
  try { await c.check({ entry, root: "/" });
    const d = c.diagnostics.map(x => x.toString().replace(/\s+/g, " ").trim());
    console.error = origErr; return d.length ? JSON.stringify(d) : "CLEAN";
  } catch (e) { console.error = origErr; return "THREW: " + String(e?.message ?? e).slice(0, 130); }
}
async function ev(files, arg = 5n, entry = "src/main.pebble") {
  const io = mkio(files);
  const c = new Compiler(io, { ...testOptions, compilerVersion: COMPILER_VERSION });
  console.error = () => {};
  try {
    await c.export({ functionName: "main", entry, root: "/" });
    const u = parseUPLC(io.outputs.get("out/out.flat")).body;
    const r = Machine.eval(new Application(u, UPLCConst.int(arg))).result;
    console.error = origErr;
    return r?.value !== undefined ? String(r.value) : r?.constructor?.name + ": " + String(r?.msg ?? "").slice(0, 60);
  } catch (e) { console.error = origErr; return "THREW: " + String(e?.message ?? e).slice(0, 130); }
}
const T = async (label, src, alsoEval) => {
  const files = typeof src === "string" ? { "src/main.pebble": src } : src;
  L(`  ${label.padEnd(52)}: ${await check(files)}`);
  if (alsoEval) L(`  ${"".padEnd(52)}  eval-> ${await ev(files)}`);
};
const H = t => L(`\n${"-".repeat(84)}\n${t}\n${"-".repeat(84)}`);

H("A. ISOLATE: is the failure `x.toData()` or the explicit-type-arg CALL SITE?");
await T("explicit type args in RETURN position",
  `function id2<T>( x: T ): T { return x; }\nexport function main( n: int ): int { return id2<int>( n ); }`, true);
await T("explicit type args as EXPRESSION STATEMENT",
  `function id2<T>( x: T ): T { return x; }\nexport function main( n: int ): int { id2<int>( n ); return n; }`);
await T("explicit type args in a const initializer",
  `function id2<T>( x: T ): T { return x; }\nexport function main( n: int ): int { const a: int = id2<int>( n ); return a; }`, true);
await T("INFERRED type args as expression statement",
  `function id2<T>( x: T ): T { return x; }\nexport function main( n: int ): int { id2( n ); return n; }`);
await T("non-generic call as expression statement",
  `function plain( x: int ): int { return x; }\nexport function main( n: int ): int { plain( n ); return n; }`);

H("B. BUG 35 proper: method call on a type-param value, no confounding call site");
await T("<T> body uses x.toData(), returned directly",
  `function conv<T>( x: T ): data { return x.toData(); }\nexport function main( n: int ): int { return n; }`);
await T("<T implements ToData> body uses x.toData()",
  `function conv<T implements ToData>( x: T ): data { return x.toData(); }\nexport function main( n: int ): int { return n; }`);
await T("...and INSTANTIATED at int (return position)",
  `function conv<T implements ToData>( x: T ): data { return x.toData(); }\nexport function main( n: int ): int { const d: data = conv<int>( n ); return n; }`, true);
await T("...INSTANTIATED at a struct with no ToData impl",
  `data struct Foo { F{ a: int } }
function conv<T implements ToData>( x: T ): data { return x.toData(); }
export function main( n: int ): int { const f: Foo = Foo.F{ a: n }; const d: data = conv<Foo>( f ); return n; }`);
await T("unconstrained <T> instantiated at struct (should it error?)",
  `data struct Foo { F{ a: int } }
function conv<T>( x: T ): data { return x.toData(); }
export function main( n: int ): int { const f: Foo = Foo.F{ a: n }; const d: data = conv<Foo>( f ); return n; }`);

H("C. BUG 32 regression: do generic containers actually RUN, not just check?");
await T("wrap<int> evaluated",
  `function wrap<T>( x: T ): List<T> { return [ x ]; }\nexport function main( n: int ): int { const l: List<int> = wrap<int>( n ); return l.head(); }`, true);
await T("first<int> evaluated",
  `function first<T>( xs: List<T> ): T { return xs.head(); }\nexport function main( n: int ): int { const l: List<int> = [ n, n + 1 ]; return first<int>( l ); }`, true);
await T("user-written map<int,int> (the stdlib blocker)",
  `function myMap<A,B>( xs: List<A>, f: (a: A) => B ): List<B> { return xs.map( f ); }
export function main( n: int ): int { const l: List<int> = [ n ]; const r: List<int> = myMap<int,int>( l, x => x + 1 ); return r.head(); }`, true);

H("D. BUG 27 regression: SoP with 3 ctors + fields actually bound correctly");
for (const [ctor, exp] of [["A{ x: n }", "1"], ["B{ y: n }", "2"], ["C{ z: n }", "3"]])
  await T(`runtime 3-ctor T.${ctor}`,
    `runtime struct T { A{ x: int } B{ y: int } C{ z: int } }
export function main( n: int ): int { const v: T = T.${ctor}; return case v is A{ x } => 1 is B{ y } => 2 is C{ z } => 3 ; }`, true);
await T("runtime 2-ctor: is the FIELD VALUE bound right?",
  `runtime struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int { const v: T = T.B{ y: n + 100 }; return case v is A{ x } => x is B{ y } => y ; }`, true);

H("E. NEW findings the ledger flags — independent confirmation");
await T("user interface impl: `self` param inference",
  `interface Show2 { sh( self ): int }
data struct Foo { F{ a: int } }
type Foo implements Show2 { sh( self ): int { return 42; } }
export function main( n: int ): int { return n; }`);
await T("trace on a plain int",
  `export function main( n: int ): int { trace n; return n; }`, true);
await T("trace on a struct (Show for structs)",
  `data struct Foo { F{ a: int } }\nexport function main( n: int ): int { const f: Foo = Foo.F{ a: n }; trace f; return n; }`, true);

L("\nCOMPILER_VERSION = " + COMPILER_VERSION);
