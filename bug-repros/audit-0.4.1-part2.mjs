import { Compiler, createMemoryCompilerIoApi, testOptions, COMPILER_VERSION, fromUtf8, parseUPLC, Application, UPLCConst, Machine } from "/home/michele/hlabs/packages/plutus/pebble/packages/pebble/dist/index.js";
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
  } catch (e) { console.error = origErr; return "THREW: " + String(e?.message ?? e).slice(0, 120); }
}
async function ev(files, arg = 5n, entry = "src/main.pebble") {
  const io = mkio(files);
  const c = new Compiler(io, { ...testOptions, compilerVersion: COMPILER_VERSION });
  console.error = () => {};
  try {
    await c.export({ functionName: "main", entry, root: "/" });
    const leftover = c.diagnostics.length;
    const u = parseUPLC(io.outputs.get("out/out.flat")).body;
    const r = Machine.eval(new Application(u, UPLCConst.int(arg))).result;
    console.error = origErr;
    return (r?.value !== undefined ? String(r.value) : r?.constructor?.name + ": " + String(r?.msg ?? "").slice(0, 60)) + `  [diags left after export: ${leftover}]`;
  } catch (e) { console.error = origErr; return "THREW: " + String(e?.message ?? e).slice(0, 120); }
}
const T = async (label, files, alsoEval) => {
  L(`  ${label.padEnd(46)}: ${await check(files)}`);
  if (alsoEval) L(`  ${"".padEnd(46)}  eval-> ${await ev(files)}`);
};
const H = t => L(`\n${"-".repeat(80)}\n${t}\n${"-".repeat(80)}`);

const INNER = `data struct Inner { A{ x: int } B{ y: int } }\ndata struct Wrap { W{ i: Inner } }\n`;

H("A. match statement: parens required? nested patterns?");
await T("match (v) flat, exhaustive", { "src/main.pebble": `data struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int { const v: T = T.A{ x: n }; match (v) { when A{ x }: { return x; } when B{ y }: { return y; } } }` }, true);
await T("match v flat, no parens", { "src/main.pebble": `data struct T { A{ x: int } B{ y: int } }
export function main( n: int ): int { const v: T = T.A{ x: n }; match v { when A{ x }: { return x; } when B{ y }: { return y; } } }` });
await T("match (o) NESTED pattern", { "src/main.pebble": INNER + `
export function main( n: int ): int { const o: Wrap = Wrap.W{ i: Inner.A{ x: n } }; match (o) { when W{ i: A{ x } }: { return x; } else: { return 0; } } }` }, true);
await T("match (o) one level, then inner case", { "src/main.pebble": INNER + `
export function main( n: int ): int { const o: Wrap = Wrap.W{ i: Inner.A{ x: n } }; match (o) { when W{ i }: { return case i is A{ x } => x is B{ y } => y ; } } }` }, true);

H("B. interface method signature: trailing ';' and return type");
for (const [lbl, sig] of [["bytes with ;", "show(self): bytes;"], ["bytes no ;", "show(self): bytes"], ["int with ;", "m(self): int;"], ["int no ;", "m(self): int"], ["data with ;", "toD(self): data;"]])
  await T(lbl, { "src/main.pebble": `interface I { ${sig} }\nexport function main( n: int ): int { return n; }` });

H("C. generic bounds: does <T implements I> parse and enforce?");
await T("decl only, <T implements ToData>", { "src/main.pebble": `function idC<T implements ToData>( x: T ): T { return x; }\nexport function main( n: int ): int { return idC<int>( n ); }` });
await T("body USES x.toData(), T unconstrained", { "src/main.pebble": `function conv<T>( x: T ): data { return x.toData(); }\nexport function main( n: int ): int { conv<int>( n ); return n; }` });
await T("body USES x.toData(), T implements ToData", { "src/main.pebble": `function conv<T implements ToData>( x: T ): data { return x.toData(); }\nexport function main( n: int ): int { conv<int>( n ); return n; }` });
await T("constraint at struct with NO impl", { "src/main.pebble": `data struct Foo { F{ a: int } }
function conv<T implements ToData>( x: T ): data { return x.toData(); }
export function main( n: int ): int { const f: Foo = Foo.F{ a: n }; conv<Foo>( f ); return n; }` });
await T("unknown interface name as constraint", { "src/main.pebble": `function q<T implements NoSuchIface>( x: T ): T { return x; }\nexport function main( n: int ): int { return n; }` });

H("D. namespaces: exported types, qualified type lookup, export *");
await T("struct inside namespace (no 'export')", { "src/main.pebble": `namespace M { struct Inside { I{ b: int } } }\nexport function main( n: int ): int { return n; }` });
await T("'export struct' inside namespace", { "src/main.pebble": `namespace M { export struct Inside { I{ b: int } } }\nexport function main( n: int ): int { return n; }` });
await T("M.Inside as a type annotation (real member)", { "src/main.pebble": `namespace M { struct Inside { I{ b: int } } }\nexport function main( o: M.Inside ): int { return 0; }` });
await T("M.Outside where Outside is FILE-level (leak?)", { "src/main.pebble": `data struct Outside { O{ a: int } }
namespace M { function f( a: int ): int { return a; } }
export function main( o: M.Outside ): int { return 0; }` });
await T("M.Nope, genuinely nonexistent", { "src/main.pebble": `namespace M { function f( a: int ): int { return a; } }
export function main( o: M.Nope ): int { return 0; }` });
await T("export * from re-export", { "src/lib.pebble": `export function helper( n: int ): int { return n + 1; }`,
  "src/reexport.pebble": `export * from "./lib.pebble";`,
  "src/main.pebble": `import { helper } from "./reexport.pebble";\nexport function main( n: int ): int { return helper( n ); }` });
await T("export { helper } from re-export", { "src/lib.pebble": `export function helper( n: int ): int { return n + 1; }`,
  "src/reexport.pebble": `export { helper } from "./lib.pebble";`,
  "src/main.pebble": `import { helper } from "./reexport.pebble";\nexport function main( n: int ): int { return helper( n ); }` });
await T("direct import (control)", { "src/lib.pebble": `export function helper( n: int ): int { return n + 1; }`,
  "src/main.pebble": `import { helper } from "./lib.pebble";\nexport function main( n: int ): int { return helper( n ); }` }, true);

H("E. export() vs check(): does export() drop diagnostics? (main stays valid)");
{
  // type error in a NON-entry function so 'main' still registers
  const files = { "src/main.pebble": `function bad( n: int ): int { return #00; }\nexport function main( n: int ): int { return n; }` };
  L("  check()  : " + await check(files));
  L("  export() : " + await ev(files));
}
L("\nCOMPILER_VERSION = " + COMPILER_VERSION);
