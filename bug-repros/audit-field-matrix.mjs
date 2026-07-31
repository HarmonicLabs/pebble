// Systematic field-type x encoding matrix, asserted BY EVALUATION.
// This is the class that produced BUG 27 and BUG 41: a shape that type-checks
// clean and miscompiles. Every case constructs a struct, reads the field back
// out, and checks the runtime value.
import { Compiler, createMemoryCompilerIoApi, testOptions, COMPILER_VERSION, fromUtf8, parseUPLC, Application, UPLCConst, Machine } from "../packages/pebble/dist/index.js";
const origErr = console.error, L = console.log;
function mkio(f) { return createMemoryCompilerIoApi({ sources: new Map([["src/main.pebble", fromUtf8(f)]]), useConsoleAsOutput: false }); }
async function run(src, arg = 5n) {
  const io = mkio(src); const c = new Compiler(io, { ...testOptions, compilerVersion: COMPILER_VERSION });
  console.error = () => {};
  try {
    await c.check({ entry: "src/main.pebble", root: "/" });
    const d = c.diagnostics.map(x => x.toString().replace(/\s+/g, " ").trim());
    if (d.length) { console.error = origErr; return "CHECK: " + JSON.stringify(d).slice(0, 90); }
  } catch (e) { console.error = origErr; return "CHECK THREW: " + String(e?.message ?? e).slice(0, 70); }
  const io2 = mkio(src); const c2 = new Compiler(io2, { ...testOptions, compilerVersion: COMPILER_VERSION });
  try {
    await c2.export({ functionName: "main", entry: "src/main.pebble", root: "/" });
    const u = parseUPLC(io2.outputs.get("out/out.flat")).body;
    const r = Machine.eval(new Application(u, UPLCConst.int(arg))).result;
    console.error = origErr;
    return r?.value !== undefined ? String(r.value) : "RUNTIME " + r?.constructor?.name + ": " + String(r?.msg ?? "").slice(0, 40);
  } catch (e) { console.error = origErr; return "EXPORT THREW: " + String(e?.message ?? e).slice(0, 70); }
}

// field type -> [ decl, literal, "read expr yielding an int == 5" ]
const FIELDS = {
  "int":                 ["int",              "n",                                  "f"],
  "bytes":               ["bytes",            "#0505",                              "( f == #0505 ? 5 : 0 )"],
  "bool":                ["bool",             "true",                               "( f ? 5 : 0 )"],
  "List<int>":           ["List<int>",        "[ n, n+1 ]",                         "f.head()"],
  "List<bytes>":         ["List<bytes>",      "[ #05 ]",                            "( f.head() == #05 ? 5 : 0 )"],
  "List<List<int>>":     ["List<List<int>>",  "[ [ n ] ]",                          "f.head().head()"],
  "Optional<int>":       ["Optional<int>",    "Some{ value: n }",                   "( case f is Some{ value } => value is None{} => 0 )"],
  "Optional<List<int>>": ["Optional<List<int>>","Some{ value: [ n ] }",             "( case f is Some{ value } => value.head() is None{} => 0 )"],
  "nested struct":       ["In",               "In.I{ v: n }",                       "( case f is I{ v } => v )"],
  "List<struct>":        ["List<In>",         "[ In.I{ v: n } ]",                   "( case f.head() is I{ v } => v )"],
  // NOTE: no `LinearMap` row — Pebble has no map-literal syntax, so a map cannot
  // be built inline the way this matrix requires. `LinearMap` as a struct-field
  // declaration, behind an alias, and in cast position is covered by
  // `audit-axis2-contracts.mjs` instead. An earlier version of this file used a
  // `{ [k]: v }` literal and reported a false positive.
};

const H = t => L(`\n${"=".repeat(92)}\n${t}\n${"=".repeat(92)}`);

async function matrix(enc) {
  H(`${enc.toUpperCase()} STRUCT — field type x construct/read round-trip (expect 5)`);
  for (const [name, [ty, lit, read]] of Object.entries(FIELDS)) {
    const src = `data struct In { I{ v: int } }
${enc} struct S { C{ f: ${ty} } }
export function main( n: int ): int {
    const s: S = S.C{ f: ${lit} };
    return case s is C{ f } => ${read} ;
}`;
    const got = await run(src);
    L(`  ${name.padEnd(22)}: ${String(got).padEnd(10)} ${got === "5" ? "ok" : "  <<<<<<<<<< NOT 5"}`);
  }
}
await matrix("data");
await matrix("runtime");

H("GENERIC struct, same fields instantiated at the field type (expect 5)");
for (const [name, [ty, lit, read]] of Object.entries(FIELDS)) {
  if (name === "LinearMap<int,int>") continue;
  const src = `data struct In { I{ v: int } }
data struct G<T> { C{ f: T } }
export function main( n: int ): int {
    const s: G<${ty}> = G.C{ f: ${lit} };
    return case s is C{ f } => ${read} ;
}`;
  const got = await run(src);
  L(`  G<${name}>`.padEnd(26) + `: ${String(got).padEnd(10)} ${got === "5" ? "ok" : "  <<<<<<<<<< NOT 5"}`);
}

H("MULTI-CONSTRUCTOR dispatch with payload fields (expect the 2nd ctor's value)");
for (const enc of ["data", "runtime"]) {
  for (const [name, [ty, lit, read]] of Object.entries(FIELDS)) {
    if (name === "LinearMap<int,int>") continue;
    const src = `data struct In { I{ v: int } }
${enc} struct S { A{ a: int } B{ f: ${ty} } }
export function main( n: int ): int {
    const s: S = S.B{ f: ${lit} };
    return case s is A{ a } => 999 is B{ f } => ${read} ;
}`;
    const got = await run(src);
    L(`  ${enc.padEnd(8)} B{${name}}`.padEnd(34) + `: ${String(got).padEnd(10)} ${got === "5" ? "ok" : "  <<<<<<<<<< NOT 5"}`);
  }
}

L("\nCOMPILER_VERSION = " + COMPILER_VERSION);
