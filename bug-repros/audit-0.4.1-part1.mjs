import { Compiler, createMemoryCompilerIoApi, testOptions, COMPILER_VERSION, fromUtf8, parseUPLC, Application, UPLCConst, Machine } from "/home/michele/hlabs/packages/plutus/pebble/packages/pebble/dist/index.js";

const origErr = console.error, L = console.log;
const mute = () => { console.error = () => {}; };
const unmute = () => { console.error = origErr; };

function mkio(files) {
  return createMemoryCompilerIoApi({
    sources: new Map(Object.entries(files).map(([k, v]) => [k, fromUtf8(v)])),
    useConsoleAsOutput: false,
  });
}

// returns { diags: string[] } or { threw: string }
async function check(files, entry = "src/main.pebble") {
  const io = mkio(files);
  const c = new Compiler(io, { ...testOptions, compilerVersion: COMPILER_VERSION });
  mute();
  try {
    await c.check({ entry, root: "/" });
    const diags = c.diagnostics.map(d => d.toString().replace(/\s+/g, " ").trim());
    unmute();
    return { diags };
  } catch (e) { unmute(); return { threw: String(e?.message ?? e) }; }
}

// returns { diagsAfterExport, evaluated } or { threw }
async function exportAndEval(files, arg = 5n, entry = "src/main.pebble") {
  const io = mkio(files);
  const c = new Compiler(io, { ...testOptions, compilerVersion: COMPILER_VERSION });
  mute();
  try {
    await c.export({ functionName: "main", entry, root: "/" });
    const diagsAfterExport = c.diagnostics.length;
    const u = parseUPLC(io.outputs.get("out/out.flat")).body;
    const r = Machine.eval(new Application(u, UPLCConst.int(arg))).result;
    unmute();
    const val = r?.value !== undefined ? String(r.value)
              : (r?.constructor?.name + ": " + String(r?.msg ?? "").slice(0, 70));
    return { diagsAfterExport, evaluated: val };
  } catch (e) { unmute(); return { threw: String(e?.message ?? e).slice(0, 140) }; }
}

const fmt = r => r.threw ? `THREW: ${r.threw}` : JSON.stringify(r.diags ?? r);
let n = 0;
const hdr = t => L(`\n${"=".repeat(78)}\n[${++n}] ${t}\n${"=".repeat(78)}`);

/* ---------------------------------------------------------------- BUG 27 */
hdr("SoP multi-ctor: construct T.B, match -> wrong branch?");
for (const enc of ["runtime", "data"]) {
  for (const [ctor, exp] of [["A{ x: n }", "111"], ["B{ y: n }", "222"]]) {
    const src = `${enc} struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int {
    const v: T = T.${ctor};
    return case v is A{ x } => 111 is B{ y } => 222 ;
}`;
    const ck = await check({ "src/main.pebble": src });
    if (ck.diags?.length || ck.threw) { L(`  ${enc.padEnd(7)} T.${ctor.padEnd(10)} check: ${fmt(ck)}`); continue; }
    const r = await exportAndEval({ "src/main.pebble": src });
    L(`  ${enc.padEnd(7)} T.${ctor.padEnd(10)} -> ${r.evaluated ?? "THREW: " + r.threw} (expected ${exp})${r.evaluated === exp ? "  ok" : "  <<< WRONG"}`);
  }
}

/* ---------------------------------------------------------------- BUG 28 */
hdr("case expression: non-exhaustive accepted at compile time?");
{
  const src = `data struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int {
    const v: T = T.B{ y: n };
    return case v is A{ x } => 111 ;
}`;
  L("  check    : " + fmt(await check({ "src/main.pebble": src })));
  L("  runtime  : " + JSON.stringify(await exportAndEval({ "src/main.pebble": src })));
}
{
  const src = `data struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int {
    const v: T = T.B{ y: n };
    match v { when A{ x }: { return 111; } }
}`;
  L("  same via match stmt: " + fmt(await check({ "src/main.pebble": src })));
}

/* ---------------------------------------------------------------- BUG 29 */
hdr("nested pattern in match stmt: clean check then codegen crash?");
{
  const src = `data struct Inner { A{ x: int } B{ y: int } }
data struct Wrap { W{ i: Inner } }
export function main( n: int ): int {
    const o: Wrap = Wrap.W{ i: Inner.A{ x: n } };
    match o { when W{ i: A{ x } }: { return x; } else: { return 0; } }
}`;
  L("  check  : " + fmt(await check({ "src/main.pebble": src })));
  L("  export : " + JSON.stringify(await exportAndEval({ "src/main.pebble": src })));
}
{
  const src = `data struct Inner { A{ x: int } B{ y: int } }
data struct Wrap { W{ i: Inner } }
export function main( n: int ): int {
    const o: Wrap = Wrap.W{ i: Inner.A{ x: n } };
    return case o is W{ i } => case i is A{ x } => x is B{ y } => y ;
}`;
  L("  nested via case expr instead: " + JSON.stringify(await exportAndEval({ "src/main.pebble": src })));
}

/* ---------------------------------------------------------------- BUG 30 */
hdr("generic TYPES (struct / alias / interface / enum)");
for (const [label, src] of [
  ["generic struct", `struct Box<T> { value: T }\nexport function main( n: int ): int { return n; }`],
  ["generic alias", `type Pair2<T> = T;\nexport function main( n: int ): int { return n; }`],
  ["generic interface", `interface Show<T> { show(self): int }\nexport function main( n: int ): int { return n; }`],
]) L(`  ${label.padEnd(18)}: ${fmt(await check({ "src/main.pebble": src }))}`);

/* ---------------------------------------------------------------- BUG 31 */
hdr("generic container in a USER generic signature");
for (const [label, src] of [
  ["bare T -> T", `function id2<T>( x: T ): T { return x; }\nexport function main( n: int ): int { return id2<int>( n ); }`],
  ["T -> List<T>", `function wrap<T>( x: T ): List<T> { return [ x ]; }\nexport function main( n: int ): int { return n; }`],
  ["List<T> -> T", `function first<T>( xs: List<T> ): T { return xs.head(); }\nexport function main( n: int ): int { return n; }`],
  ["T -> Optional<T>", `function opt<T>( x: T ): Optional<T> { return Some{ value: x }; }\nexport function main( n: int ): int { return n; }`],
]) L(`  ${label.padEnd(18)}: ${fmt(await check({ "src/main.pebble": src }))}`);

/* ---------------------------------------------------------------- BUG 32 */
hdr("generic bounds enforced?");
{
  const src = `struct Foo { F{ a: int } }
function conv<T implements ToData>( x: T ): data { return x.toData(); }
export function main( n: int ): int { const f = Foo.F{ a: n }; conv<Foo>( f ); return n; }`;
  L("  <T implements ToData> at a type with no impl: " + fmt(await check({ "src/main.pebble": src })));
}

/* ---------------------------------------------------------------- BUG 33 */
hdr("return-type inference: if/else both return int");
for (const [label, src] of [
  ["annotated", `export function main( n: int ): int { if( n > 0 ) { return 1; } else { return 2; } }`],
  ["omitted", `function f( n: int ) { if( n > 0 ) { return 1; } else { return 2; } }\nexport function main( n: int ): int { return f( n ); }`],
  ["omitted, single top-level return", `function g( n: int ) { return n + 1; }\nexport function main( n: int ): int { return g( n ); }`],
]) L(`  ${label.padEnd(32)}: ${fmt(await check({ "src/main.pebble": src }))}`);

/* ---------------------------------------------------------------- BUG 34 */
hdr("case-expression arms with mismatched types, no hint");
{
  const src = `data struct Sh { C{ r: int } S{ s: int } }
export function main( n: int ): int {
    const sh: Sh = Sh.C{ r: n };
    const x = case sh is C{ r } => r is S{ s } => #00 ;
    return n;
}`;
  L("  int arm + bytes arm: " + fmt(await check({ "src/main.pebble": src })));
}

/* ---------------------------------------------------------------- BUG 35 */
hdr("export() swallows diagnostics (test-suite vacuity)");
{
  const src = `export function main( n: int ): int { return #00; }`;
  L("  check()  diags: " + fmt(await check({ "src/main.pebble": src })));
  const r = await exportAndEval({ "src/main.pebble": src });
  L("  export() then compiler.diagnostics.length = " + (r.diagsAfterExport ?? "n/a (threw: " + r.threw + ")"));
}

/* ---------------------------------------------------------------- BUG 36 */
hdr("export * from is a silent no-op");
{
  const files = {
    "src/lib.pebble": `export function helper( n: int ): int { return n + 1; }`,
    "src/reexport.pebble": `export * from "./lib.pebble";`,
    "src/main.pebble": `import { helper } from "./reexport.pebble";\nexport function main( n: int ): int { return helper( n ); }`,
  };
  L("  via export *: " + fmt(await check(files)));
}

/* ---------------------------------------------------------------- BUG 37 */
hdr("qualified namespace type lookup leaks the file scope");
{
  const src = `struct Outside { O{ a: int } }
namespace M { export struct Inside { I{ b: int } } }
export function main( o: M.Outside ): int { return 0; }`;
  L("  M.Outside where Outside is file-level: " + fmt(await check({ "src/main.pebble": src })));
}

/* ---------------------------------------------------------------- BUG 38 */
hdr("interface method signature with trailing semicolon");
for (const [label, src] of [
  ["with ;", `interface I { m(self): int; }\nexport function main( n: int ): int { return n; }`],
  ["without ;", `interface I { m(self): int }\nexport function main( n: int ): int { return n; }`],
]) L(`  ${label.padEnd(12)}: ${fmt(await check({ "src/main.pebble": src }))}`);

L("\nCOMPILER_VERSION = " + COMPILER_VERSION);
