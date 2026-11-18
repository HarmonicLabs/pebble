# Pebble — bugs open against 0.4.1

> **STATUS (fixed 2026-07-28, local build).** All 12 audited bugs are
> addressed; regression coverage is in
> `packages/pebble/src/compiler/__tests__/compiler.auditBugs.0_4_1.test.ts`
> (26 tests). Full suite green (656 passed). Resolution per bug:
>
> | # | Resolution |
> |---|---|
> | 27 | FIXED — SoP literals emit `IRConstr(parentCtorIdx)`, not hardcoded 0 |
> | 28 | FIXED — `case` expressions run the same exhaustiveness check as `match` |
> | 29 | FIXED — arm types are joined (`joinTypes`); incompatible arms error |
> | 30 | FIXED — `export()` throws on ERROR diagnostics (warnings tolerated). This unmasked pre-existing VACUOUS tests: the whole `Show` integration for structs/Value/`trace` (now wired for real) and one user-impl `self`-inference gap (see notes) |
> | 31 | FIXED — the three raw throws are now located diagnostics ("generic … not supported yet") |
> | 32 | FIXED — generic containers in generic signatures lower symbolically (`List<T>` → `TirListT(TirTypeParam)`) and monomorphize; `wrap<T>`/`first<T>`/`opt<T>` compile, `wrap<int>` runs |
> | 33 | FIXED — nested patterns now parse (`skipTypeAndInitializer` propagation) and `else:` colon is accepted; nested *refinement* patterns give ONE clear diagnostic pointing at the bind-then-`case` workaround, instead of 3 misleading parse errors / a codegen crash |
> | 34 | FIXED — `_inferReturnType` recurses into if/match/loop/block bodies |
> | 35 | NOT REPRODUCED at parse — `x.toData()` on a type-param parses & checks cleanly now; constraint-based method DISPATCH at monomorphization is the deferred "Stage 4b" feature the interfaceConstraints test already documents (not implemented here) |
> | 36 | FIXED — optional `;` after an interface method signature |
> | 37 | FIXED — qualified type lookup uses non-walking `resolveLocalType` |
> | 38 | FIXED — `export`/`private` on namespace members parse; `export … from` re-export gives a clear "not supported yet" diagnostic (the feature itself is not implemented) |
>
> **New findings unmasked by the BUG 30 fix (NOT in the original audit):**
> the `Show` interface was unimplemented for structs/`Value` and `trace`
> auto-show (all now wired via `_showIR` return-type + `trace` gate), and
> the `self` parameter of every user `type X implements I { m( self ) … }`
> block is not inferred ("ERROR 285"), so no user interface impl compiles.
> The last is a foundational impl-method gap, left as a documented
> `test.failing` in `compiler.show.test.ts` /
> `compiler.interfaceConstraints.test.ts`.

---

## Re-verification against 0.4.2 (2026-07-29)

Re-ran the **original, unmodified** audit scripts (`bug-repros/audit-0.4.1-part1.mjs`,
`-part2.mjs`) against a clean `npm run build` of the working tree
(`COMPILER_VERSION = 0.4.2`, uncommitted on top of `f8517fbb`). Follow-up
isolation probes are in `bug-repros/audit-0.4.2-followup.mjs`.

**Result: 11 of 12 confirmed fixed. BUG 35 was never a real bug (my error — see
below). Two claims need narrowing, and one pre-existing HIGH-severity bug that
the original audit missed is recorded as BUG 39.**

| # | Claimed | Verified | Evidence |
|---|---|---|---|
| 27 | FIXED | **confirmed** | `T.A/B/C` on a 3-ctor `runtime struct` → `1/2/3`; field values bind correctly (`T.B{ y: n+100 }`, n=5 → `105`) |
| 28 | FIXED | **confirmed** | non-exhaustive `case` → `ERROR 289` at compile time |
| 29 | FIXED | **confirmed** | int arm + bytes arm → `ERROR 2322` |
| 30 | FIXED | **confirmed** | `export()` now throws on ERROR diagnostics |
| 31 | FIXED | **confirmed** | all three are located `ERROR 100` diagnostics, no raw throw |
| 32 | FIXED | **partial — see below** | `wrap<T>`/`first<T>`/`opt<T>` check *and evaluate*; but `map` still cannot be written |
| 33 | FIXED | **confirmed** | one `ERROR 100` naming the bind-then-`case` workaround |
| 34 | FIXED | **confirmed** | if/else body infers `int` |
| 35 | NOT REPRODUCED | **correct — my error** | see below |
| 36 | FIXED | **confirmed** | optional `;` accepted for `bytes`/`int`/`data` |
| 37 | FIXED | **confirmed** | `M.Outside` → `ERROR 30001` |
| 38 | FIXED | **confirmed** | `export`/`private` on namespace members parse; re-export gives `ERROR 100` |

### BUG 35 was a misattribution — the original report was wrong

`x.toData()` on a type-param value **parses and checks cleanly**, and did so
before. My 0.4.1 repro was confounded: it called the generic at an
*expression-statement* call site (`conv<Foo>( f );`), and a bare call as a
statement does not parse at all — **including a non-generic one**:

```pebble
function plain( x: int ): int { return x; }
export function main( n: int ): int { plain( n ); return n; }
```
→ `ERROR 1005: "'=' expected."` + `ERROR 1368: "Statement expected."`

The same call is clean in return position or as a `const` initializer. In a pure
language, rejecting a discarded call is defensible, but the diagnostic points at
the wrong thing — worth a real "expression statements are not allowed" message.

What *is* still open is constraint-based **dispatch** at monomorphization, which
the ledger already scopes as deferred "Stage 4b": `conv<int>( n )` on a
`<T implements ToData>` function gives
`ERROR 2339: "Property 'toData' does not exist on type 'int'."`, i.e. the
constraint grants nothing at instantiation. Correctly scoped, not a regression.

### BUG 32 is fixed for containers but the stdlib blocker remains

`List<T>` / `Optional<T>` in a user generic signature now compile *and run*
(`wrap<int>( 5 ).head()` → `5`, `first<int>([5,6])` → `5`). But the original
report's framing — "you cannot write `map`, `filter`, or `fold`" — still holds,
for a different reason: **there is no function-type syntax for a parameter
annotation**, so a higher-order function cannot be declared at all. None of these
parse:

```pebble
function ap( f: (a: int) => int, x: int ): int { ... }   // ERROR 1110 "Type expected."
function ap( f: (int) => int, x: int ): int { ... }      // ERROR 1110
function ap( f: fn(int) -> int, x: int ): int { ... }    // ERROR 1005 "')' expected."
function ap( f: Func<int,int>, x: int ): int { ... }     // ERROR 256 "'Func' is not defined"
```

`AstFuncType` is only ever constructed when parsing a function *declaration* or
lambda (`Parser.ts:1709`, `:3509`) — the type-annotation grammar has no
function-type production, and no test or doc uses one. Written up as
**BUG 40** below; still open as of 2026-07-29.

### BUG 39 (NEW, HIGH) — `List.map` is unusable with any lambda — FIXED (2026-07-29)

> **FIXED.** Two compounding causes: (1) a lambda compiled against an
> expected type whose return was a free `TirTypeParam` adopted that param as
> its own return type, making it non-concrete (`(int) => T`) so it failed to
> assign to itself; (2) the non-template call path never inferred the free
> param from the argument, so the result stayed `List<T>`. Now a lambda whose
> expected return is generic infers its real return from the body
> (`_compileFuncExpr`), and the call path infers free signature params from
> the compiled args and substitutes them (`_compileCallExpr`). `l.map( x => x
> + 1 )` type-checks and runs; type-changing maps (`int -> bytes`, `int ->
> bool`) work; `filter` unaffected. Regression coverage in
> `compiler.auditBugs.0_4_1.test.ts` (4 tests; verified to fail if reverted).

Missed by the original audit. Present in **published 0.4.1 and in 0.4.2
identically**, so it was pre-existing, not a regression:

```pebble
export function main( n: int ): int {
    const l: List<int> = [ n ];
    const r: List<int> = l.map( x => x + 1 );
    return r.head();
}
```
→ `ERROR 2322: "Type '(int) => T' is not assignable to type '(int) => T'."`

A type reported as not assignable to *itself*. Annotating the lambda
(`( x: int ): int => x + 1`) does not help. `l.filter( x => x > 0 )` is **clean**,
which localises it: `filter`'s callback returns concrete `bool`, while `map`'s
returns the type param `B`, which is never resolved against the call site — so
the residual `T` on both sides fails identity comparison.

This is the most-used combinator in the stdlib and it fails with a maximally
confusing message. Recommend prioritising it above the remaining polish items.

### Regression check: the three mainnet contracts are byte-identical

Recompiled `the-cardano-masterpiece` (its own `scripts/compile-local.ts`, against
the fresh 0.4.2 dist, in a scratch copy) and compared to the deployed 0.4.1
artifacts:

| contract | 0.4.1 sha256 | 0.4.2 sha256 | bytes |
|---|---|---|---|
| stewardship | `f013832da712d487…` | `f013832da712d487…` | 5835 → 5835 |
| masterpiece | `909cf4f03f2e0189…` | `909cf4f03f2e0189…` | 5354 → 5354 |
| marketplace | `5ee3b2fbeb0f71ee…` | `5ee3b2fbeb0f71ee…` | 3202 → 3202 |
| lock | `62d9f3694679ce71…` | `62d9f3694679ce71…` | 87 → 87 |

All identical, so nothing on chain is invalidated. Expected: those contracts use
`data struct`, which the BUG 27 SoP fix does not touch.

### Suite status

`npx jest` from the repo root: **663 passed, 0 failed tests**, 12 skipped, 5 todo;
`compiler.auditBugs.0_4_1.test.ts` PASSes. But **2 suites fail to load**:
`packages/onchain/src/pluts/Script/__tests__/Script.compile.test.ts` and
`…tx_interval.test.ts`, both `SyntaxError: Identifier 'PBound' has already been
declared`. Both files are **unmodified** and the duplicate import is present in
the committed 0.4.1 blob, so this is pre-existing legacy `packages/onchain`
breakage, not caused by these fixes — but it means "full suite green" is not
currently true from the repo root, and the CI job would go red on it. Worth
deleting the duplicate import lines.

### Confirmed: the two new findings in the STATUS block above

`trace` on both an `int` and a `data struct` compiles and evaluates. And the
`self` gap reproduces exactly as described:

```pebble
interface Show2 { sh( self ): int }
data struct Foo { F{ a: int } }
type Foo implements Show2 { sh( self ): int { return 42; } }
```
→ `ERROR 285: "Could not infer function signature, parameter type is missing."`

So no user-written interface impl compiles. Combined with BUG 35's deferred
dispatch, user-defined interfaces are declaration-only end to end — worth stating
plainly in the M1.A writeup rather than leaving as a `test.failing`.

---

Found by a type-system audit of the compiler against published
`@harmoniclabs/pebble` **0.4.1** (`f8517fbb`, 2026-07-25), run for Milestone 1.A
acceptance ("type system finalized: full inference, sum types, generics,
namespaces").

Numbering continues from the downstream ledger in
`the-cardano-masterpiece/PEBBLE_BUGS.md` (BUGs 1–26, found while building that
project) to avoid collisions. Those were found *using* the compiler; these were
found *auditing* it, so several are gaps that no downstream project has hit yet
because the affected syntax is unreachable in practice.

**Every repro below was executed against 0.4.1** and the observed output pasted
verbatim. All of them drive `Compiler` from `packages/pebble/dist` through
`createMemoryCompilerIoApi`, `check()` for diagnostics and `export()` +
`Machine.eval` for runtime behaviour.

Severity key: **CRITICAL** = silently wrong on-chain code; **HIGH** = accepted
at compile time, fails or misbehaves later; **MEDIUM** = compiler crash or
missing type-system feature; **LOW** = surface/consistency.

| # | Severity | One-liner |
|---|---|---|
| 27 | CRITICAL | `runtime struct` multi-ctor literals all compile to constructor 0 → wrong branch executes |
| 28 | HIGH | Non-exhaustive `case` expression accepted, then crashes on chain |
| 29 | HIGH | `case` arms with mismatched types accepted with no diagnostic |
| 30 | HIGH | `export()` discards diagnostics, making most of the test suite vacuous |
| 31 | MEDIUM | Generic structs / aliases / interfaces crash the compiler with a raw throw |
| 32 | MEDIUM | Any generic container in a user generic signature crashes the compiler |
| 33 | MEDIUM | Nested destructuring patterns in `match` do not parse |
| 34 | MEDIUM | Return-type inference fails on any body with more than one `return` |
| 35 | LOW | Method call on a type-param value does not parse → constraints are declaration-only |
| 36 | LOW | `interface` method signature cannot end with `;` — which is the form the tests use |
| 37 | LOW | Qualified namespace path resolves file-level types (scope leak) |
| 38 | LOW | `export * from` / `export { x } from` do not parse; `export` on a namespace type member does not parse |

Found later, during the 0.4.2 re-verification (not part of the original 12):

| # | Severity | One-liner | Status |
|---|---|---|---|
| 39 | HIGH | `List.map` unusable with any lambda — type not assignable to itself | FIXED 2026-07-29 |
| 40 | MEDIUM | No function-type syntax for a parameter annotation → higher-order functions cannot be declared | FIXED 2026-07-29 |
| 41 | CRITICAL | `data struct` with a `List<…>` field type-checks clean and miscompiles | FIXED 2026-07-31 |
| 42 | CRITICAL | multi-ctor `runtime struct` with an `Optional<…>` field type-checks clean and miscompiles | FIXED 2026-07-31 |
| 43 | HIGH | `bool` field in a multi-constructor `data struct` crashes the backend | FIXED 2026-07-31 |
| 44 | MEDIUM | `Optional<…>` as a `runtime struct` field, or as a generic instantiation, crashes the backend (the "deconstruct + `case`" expressify crash first noted under this number is the same defect) | FIXED 2026-07-31 |

Found by the second-axis sweep (contract/state/redeemer shapes, prelude types as
fields — `bug-repros/audit-axis2-contracts.mjs`). All three are **pre-existing,
reproduce identically on published 0.4.1**, and none is silent:

| # | Severity | One-liner | Status |
|---|---|---|---|
| 45 | HIGH | `Value` as a `data struct` field: checks clean, then the backend cannot decode it | **OPEN** |
| 46 | LOW | `case` as a `const`/`let` initializer is newline-sensitive — same code parses multi-line, fails on one line | **OPEN** |
| 47 | LOW | a generic prelude type (`LinearMap<…>`) is not usable directly in cast position; only via an alias | FIXED 2026-07-31 |
| 48 | LOW | a struct constructor is not reachable through a qualified namespace path (`M.S.C{…}`); `using` works | **OPEN** |

---

## BUG 27 — CRITICAL: `runtime struct` multi-constructor literals all compile to constructor 0

Every SoP struct literal is emitted as `IRConstr(0, …)` regardless of which
constructor was named, while `case` dispatches *by* constructor index. So
matching a non-first variant silently runs the **first** variant's arm, with the
wrong field bound to the wrong name.

```pebble
runtime struct T { A{ x: int } B{ y: int } }

export function main( n: int ): int {
    const v: T = T.B{ y: n };
    return case v is A{ x } => 111 is B{ y } => 222 ;
}
```

**Observed:** compiles with zero diagnostics; evaluates to **`111`**.
**Expected:** `222`.

The identical program with `data struct` is correct (`T.A` → 111, `T.B` → 222),
so only the SoP encoding is affected.

**Root cause:** `packages/pebble/src/compiler/tir/expressions/litteral/TirLitNamedObjExpr.ts:102-107`

```ts
if( type instanceof TirSoPStructType ) {
    return new IRConstr(
        0,                                    // <-- hardcoded
        namedFields.map(({ expr }) => expr.toIR( ctx ) )
    );
}
```

The correct index is already computed at
[`TirLitNamedObjExpr.ts:74`](packages/pebble/src/compiler/tir/expressions/litteral/TirLitNamedObjExpr.ts#L74)
(`const ctorIdx = type.constructors.findIndex( c => c.name === this.name.text )`)
and is used on the data path at `:154`, but the SoP path discards it. Same bug in
`TirLitObjExpr.ts:101-107`.

**Fix:** pass `ctorIdx` instead of `0` in both files.

**Why it survived:** `grep -rl "runtime struct" packages/pebble/src/compiler/__tests__/`
returns **0 files**. The SoP multi-constructor path has no test coverage at all.
A regression test should assert *evaluated results* for each constructor of a
2+-constructor `runtime struct`, not just absence of diagnostics.

---

## BUG 28 — HIGH: non-exhaustive `case` expression is accepted, then crashes on chain

```pebble
data struct T { A{ x: int } B{ y: int } }

export function main( n: int ): int {
    const v: T = T.B{ y: n };
    return case v is A{ x } => 111 ;      // B not covered
}
```

**Observed:** `check()` returns `[]`. At runtime:
`CEKError: case: constructor tag 1 out of range (1 branches)`.
**Expected:** a compile-time non-exhaustiveness error.

The equivalent `match` *statement* is correctly rejected with
`ERROR 289: "Match cases are not exhaustive"`, so the check exists — it is just
wired only into the statement path
([`_compileMatchStmt.ts:127`](packages/pebble/src/compiler/AstCompiler/internal/statements/_compileMatchStmt.ts#L127)
is the only emitter of `DiagnosticCode.Match_cases_are_not_exhaustive`).
`_compileCaseExpr.ts` performs no exhaustiveness check.

**Fix:** run the same constructor-coverage check in `_compileCaseExpr`, or factor
it out of `_compileMatchStmt` and call it from both.

This is the failure mode most likely to reach mainnet, because a `case` missing a
variant looks fine in review and only fails on the input that takes the missing
branch.

---

## BUG 29 — HIGH: `case` arms with mismatched types are accepted with no diagnostic

```pebble
data struct Sh { C{ r: int } S{ s: int } }

export function main( n: int ): int {
    const sh: Sh = Sh.C{ r: n };
    const x = case sh is C{ r } => r is S{ s } => #00 ;   // int arm and bytes arm
    return n;
}
```

**Observed:** zero diagnostics.
**Expected:** the arms have incompatible types (`int` vs `bytes`); one of them
should error.

**Root cause:** [`_compileCaseExpr.ts:43`](packages/pebble/src/compiler/AstCompiler/internal/exprs/_compileCaseExpr.ts#L43)

```ts
const returnType = cases[0]?.body.type ?? typeHint;
```

The whole expression takes the **first arm's** type and the remaining arms are
never checked against it. With a type hint present the hint wins and mismatches
are caught; with no hint (as in a bare `const`) they are not.

**Fix:** check every arm against `returnType` (and ideally compute a join/LUB
rather than taking arm 0).

---

## BUG 30 — HIGH: `export()` discards diagnostics, making most of the test suite vacuous

`Compiler.export()` drains `this.diagnostics` into stdout and the failure `throw`
is commented out, so after `export()` the array is always empty:

`packages/pebble/src/compiler/Compiler.ts:114-122`

```ts
if( this.diagnostics.length > 0 ) {
    let msg: DiagnosticMessage;
    const fstErrorMsg = this.diagnostics[0].toString();
    const nDiags = this.diagnostics.length;
    while( msg = this.diagnostics.shift()! ) {         // <-- drains
        this.io.stdout.write( msg.toString() + "\n" );
    }
    // throw new Error("compilation failed with " + nDiags + " diagnostic messages; ...
}
```

**Repro:**

```pebble
function bad( n: int ): int { return #00; }
export function main( n: int ): int { return n; }
```

- `check()` → `ERROR 2322: "Type 'bytes' is not assignable to type 'int'."`
- `export()` on the same source → succeeds, evaluates to `5`, and
  `compiler.diagnostics.length === 0`.

**Impact:** the dominant assertion across the suite is
`await compiler.export(...); expect( compiler.diagnostics ).toEqual( [] )`, which
therefore **passes for programs with type errors**. The 630 green tests
substantially overstate coverage. Tests that additionally assert on evaluated
UPLC output are still meaningful; tests that only assert empty diagnostics after
`export()` are not.

Worse, `compiler.interfaceConstraints.test.ts:15-19` wraps `export()` in
`try {} catch {}`, so those 7 tests assert nothing at all — and their fixture
does not even parse (see BUG 36).

**Fix:** either uncomment the throw, or have tests assert against `check()`
(which preserves diagnostics), or snapshot the drained messages. This should be
fixed *first* — until it is, a green suite is not evidence that any other fix in
this file worked.

---

## BUG 31 — MEDIUM: generic structs / aliases / interfaces crash the compiler

These are uncaught `throw new Error`, not diagnostics — the process dies with a
stack trace and no source location.

```pebble
struct Box<T> { value: T }
```
→ `not_implemented::AstCompiler::_compileStructDecl::typeParams`
([`AstCompiler.ts:1493`](packages/pebble/src/compiler/AstCompiler/AstCompiler.ts#L1493))

```pebble
type Alias<T> = T;
```
→ `not_implemented::AstCompiler::_compileTypeAliasDecl::typeParams`
([`AstCompiler.ts:1619`](packages/pebble/src/compiler/AstCompiler/AstCompiler.ts#L1619))

```pebble
interface Show<T> { show(self): int }
```
→ `not implemented; generic interfaces`
([`AstCompiler.ts:1227`](packages/pebble/src/compiler/AstCompiler/AstCompiler.ts#L1227))

`EnumDecl` has no `typeParams` field at all, so generic enums are not even
representable.

**This is the milestone-blocking gap:** generic *functions* monomorphize
correctly (`monomorphizeGeneric.ts` is real work — memoized per template + type
args, with in-flight cycle detection), but there are no generic *types*.

**Minimum fix to stop being user-hostile:** convert the three throws into proper
diagnostics with source ranges, so `struct Box<T>` reports "generic structs are
not supported yet" at the right line instead of crashing. That is a small change
and independent of implementing the feature.

---

## BUG 32 — MEDIUM: any generic container in a user generic signature crashes the compiler

```pebble
function wrap<T>( x: T ): List<T> { return [ x ]; }        // crash
function first<T>( xs: List<T> ): T { return xs.head(); }  // crash
function opt<T>( x: T ): Optional<T> { return Some{ value: x }; }  // crash
```

All three die with the uncaught

```
`toConcreteTirTypeName` called on TirTypeParam; tir cannot have ambiguous types
```

from [`TirTypeParam.ts:22`](packages/pebble/src/compiler/tir/types/TirTypeParam.ts#L22),
reached via `_registerGenericTemplate` → `getDataFuncSignature` →
`_compileSopEncodedConcreteType` → `TypedProgram.getAppliedGeneric`. The
signature is being lowered to concrete TIR at *declaration* time, before any
instantiation has substituted `T`.

Only a bare `T` in argument/return position works — `function id<T>( x: T ): T`
is clean and evaluates correctly.

**Impact:** `map`, `filter`, and `fold` cannot be written in Pebble. The ~20
passing tests in `compiler.genericInference.test.ts` all exercise **`std`**
functions, which are registered as `kind: "native"` templates
(`monomorphizeGeneric.ts:92-98`) and bypass this path entirely — which is why the
suite is green while the user-facing feature is unusable.

**Fix:** defer concrete-TIR lowering of a generic signature until
monomorphization, keeping `TirTypeParam` legal in the template's stored
signature.

---

## BUG 33 — MEDIUM: nested destructuring patterns in `match` do not parse

```pebble
data struct Inner { A{ x: int } B{ y: int } }
data struct Wrap { W{ i: Inner } }

export function main( n: int ): int {
    const o: Wrap = Wrap.W{ i: Inner.A{ x: n } };
    match (o) {
        when W{ i: A{ x } }: { return x; }
        else: { return 0; }
    }
}
```

**Observed:** three `ERROR 1368: "Statement expected."` — the parser stops at the
nested `A{ x }`.
**Expected:** either support, or one clear "nested patterns are not supported"
diagnostic instead of three misleading ones pointing at the wrong construct.

The workaround compiles and evaluates correctly, and is what to document until
this is implemented:

```pebble
match (o) { when W{ i }: { return case i is A{ x } => x is B{ y } => y ; } }
```

Nested patterns appear nowhere in the test suite
(`grep -rn "when [A-Z][A-Za-z]*{ [a-z]*: [A-Z]"` → no hits), so this is untested
rather than regressed.

---

## BUG 34 — MEDIUM: return-type inference fails on any body with more than one `return`

```pebble
function f( n: int ) { if( n > 0 ) { return 1; } else { return 2; } }
export function main( n: int ): int { return f( n ); }
```

**Observed:** `ERROR 2322: "Type 'void' is not assignable to type 'int'."`
**Expected:** `f` infers `int`.

A single top-level `return` infers fine (`function g( n: int ) { return n + 1; }`
is clean), and annotating the return type fixes it.

**Root cause:**
[`_compileFuncExpr.ts:262`](packages/pebble/src/compiler/AstCompiler/internal/exprs/_compileFuncExpr.ts#L262)
— `_inferReturnType` scans only **top-level** statements for a `TirReturnStmt`.
It never recurses into `if` / `match` / block bodies and performs no join, so a
body whose returns are all nested falls back to `void_t` at `:249`.

**Fix:** recurse into nested blocks and join the collected return types (which
also gives BUG 29 its LUB helper).

More broadly: there is no unification or constraint solving anywhere in the
compiler. The only inference machinery is
[`inferTypeArgs.ts`](packages/pebble/src/compiler/tir/types/utils/inferTypeArgs.ts)
(107 lines), self-described at `:20-22` as *"intentionally syntactic — no
subtyping, no widening"*, and used only for generic call sites. Function
parameters always require annotations
(`Could_not_infer_function_signature_parameter_type_is_missing`). "Full
inference" as worded in M1.A is not an accurate description of what exists —
this is bidirectional checking with mandatory annotations plus local `let`
inference. Worth either scoping the claim down or planning the engine.

---

## BUG 35 — LOW: method call on a type-param value does not parse, so constraints are declaration-only

```pebble
function conv<T implements ToData>( x: T ): data { return x.toData(); }
```

**Observed:** `ERROR 1005: "'=' expected."` + `ERROR 1368: "Statement expected."`
— the parse fails on `x.toData()`, i.e. on member access on a type-param value,
whether or not the constraint is present.

So `<T implements I>` parses as a declaration but grants nothing usable, and
`monomorphizeGeneric.ts` never reads `template.constraints`. Constraint *names*
are resolved (`<T implements NoSuchIface>` → `ERROR 256: "'NoSuchIface' is not
defined"`, correctly), which is the only part that works.

`compiler.interfaceConstraints.test.ts` documents this honestly in a comment
("user-body method dispatch on type-param values is deferred to Stage 4b"), so it
is known — recorded here because from the outside it reads as a working feature.

---

## BUG 36 — LOW: `interface` method signature cannot end with `;` — and that is the form the tests use

```pebble
interface I { show(self): bytes; }    // ERROR 1003: "Identifier expected."
interface I { show(self): bytes }     // clean
```

Confirmed for `bytes`, `int` and `data` return types, so it is the separator, not
the type.

This is why the 7 tests in `compiler.interfaceConstraints.test.ts` assert
nothing: their fixture is `interface Show { show(self): bytes; }`, which does not
parse, and the failure is swallowed by the surrounding `try {} catch {}` (BUG 30).

**Fix:** accept an optional `;` after a method signature — every other
declaration form in the language tolerates it, and the trailing semicolon is what
a TypeScript-shaped syntax leads people to write.

---

## BUG 37 — LOW: qualified namespace path resolves file-level types

```pebble
data struct Outside { O{ a: int } }
namespace M { function f( a: int ): int { return a; } }

export function main( o: M.Outside ): int { return 0; }   // accepted!
```

**Observed:** zero diagnostics, even though `M` contains no `Outside`.
**Expected:** `ERROR 30001: "Namespace 'M' has no exported member 'Outside'."` —
which *is* produced correctly for a name that exists nowhere (`M.Nope`).

**Root cause:**
[`_compileQualifiedNamedTypeExpr.ts:63`](packages/pebble/src/compiler/AstCompiler/internal/types/_compileQualifiedNamedTypeExpr.ts#L63)
resolves through `publicScope.resolveType(...)`, and `resolveType` walks parent
scopes (`AstScope.ts:317-320`) while `publicScope` is a child of the file scope
(`AstCompiler.ts:1159`). So any file-level type is reachable through any
namespace's qualified path.

Since `publicScope` is what importers see, an importer can also reach
non-exported types via `Lib.M.PrivateType`. Worth fixing for that reason rather
than the cosmetic one.

**Fix:** use a non-walking lookup for the qualified case.

Namespaces are otherwise the most complete of the four M1.A features: nested
namespaces to 3+ levels, `private` members, `using { x } = M`, `using m = M`,
`export namespace` + `import { M }`, `import * as Lib`, and a real recursive
dependency graph with cycle detection all work and are tested.

---

## BUG 38 — LOW: re-export forms and `export` on a namespace type member do not parse

```pebble
export * from "./lib.pebble";            // ERROR 1368: "Statement expected."
export { helper } from "./lib.pebble";   // ERROR 1005 + three ERROR 1368
```

Direct `import { helper } from "./lib.pebble"` works, so there is simply no
re-export syntax. Not a silent-loss bug — it fails loudly — but it means a
package cannot present a barrel/public API surface, which will matter as soon as
anyone ships a Pebble library.

Separately:

```pebble
namespace M { export struct Inside { I{ b: int } } }
```
→ `ERROR 1005: "'namespace member declaration' expected."`

while plain `namespace M { struct Inside { … } }` is clean and `M.Inside` is
usable as a type from outside. So namespace type members are implicitly
exported and the `export` keyword on them is a parse error — inconsistent with
`export namespace` and with `private` members, both of which do exist.

---

## BUG 40 — MEDIUM: no function-type syntax, so higher-order functions cannot be declared — FIXED (2026-07-29)

> **FIXED.** A TypeScript-style function type is now a valid type annotation —
> `function ap( f: (a: int) => int, x: int ): int { return f( x ); }` — so
> users can write their own `map`/`fold`/etc. Added a `( params ) => Return`
> production to `parseTypeExpr`, and both concrete-type compilers now lower an
> `AstFuncType` to the same `TirFuncT` a function DECLARATION with that
> signature yields (via `getDataFuncSignature`), so a top-level function or a
> lambda type-checks against it identically. `twice( y => y + 3, 1 )` → `7`.
> Crucially, a lambda passed to a user higher-order function reaches the exact
> same lowering as one passed to `map`/`filter`, so the earlier lambda
> fixes/optimizations apply unchanged: the `const`-only capture rule still
> fires (`ERROR 30207` on a captured `let`), and a captured expensive `const`
> is still hoisted and evaluated ONCE (verified: a `sha2_256` in a HOF lambda
> appears once in the compiled UPLC). Regression coverage in
> `compiler.auditBugs.0_4_1.test.ts` (5 tests; verified to fail if reverted).

Found during the 0.4.2 re-verification (2026-07-29), while checking whether the
BUG 32 fix had unblocked user-written `map`/`filter`/`fold`. It had not, for this
separate reason (now fixed as described above).

A function type cannot be written in a parameter annotation, in any spelling.
There is no working form:

```pebble
function ap( f: (a: int) => int, x: int ): int { return f( x ); }
// ERROR 1110: "Type expected."   +   ERROR 1005: "')' expected."

function ap( f: (int) => int, x: int ): int { return f( x ); }
// ERROR 1110: "Type expected."   +   ERROR 1005: "')' expected."

function ap( f: fn(int) -> int, x: int ): int { return f( x ); }
// ERROR 1005: "')' expected."

function ap( f: Func<int,int>, x: int ): int { return f( x ); }
// ERROR 256: "'Func' is not defined"
```

The first two are the forms a TypeScript-shaped syntax leads people to write, and
they produce the least helpful of the four messages: `Type expected.` pointing at
the `(` of the function type.

**Root cause:** the type-annotation grammar has no function-type production.
`AstFuncType` exists (`ast/nodes/types/AstNativeTypeExpr`) but is only ever
constructed while parsing a function *declaration* or a lambda
(`Parser.ts:1709`, `Parser.ts:3509`) — never from `parseType`. Nothing in the
test suite or the docs uses a function type in an annotation position, which is
why the gap went unnoticed.

**Impact.** This is what actually blocks a user-written standard library, now
that BUG 32 is fixed:

- `List<T>` in a user generic signature works and runs
  (`function first<T>( xs: List<T> ): T` → clean, evaluates).
- But `function myMap<A,B>( xs: List<A>, f: (a: A) => B ): List<B>` cannot be
  declared at all, because of the `f` parameter.

So generics over *containers* are usable while generics over *behaviour* are not.
`map`, `filter`, `fold`, `find`, and every combinator anyone would write for
their own type remain impossible in user code. The built-in `l.map( … )` works
(BUG 39), so this is specifically about user-defined higher-order functions.

Lambdas themselves are fine — `l.filter( x => x > 0 )` compiles, and lambda
parameters are inferred bidirectionally from the expected type
(`_compileFuncExpr.ts:286-291`). The machinery to *type* a function value exists;
only the surface syntax to *name* that type in an annotation is missing.

**Fix:** add a function-type production to `parseType` producing `AstFuncType`,
and settle on one spelling. `( a: int ) => int` is the obvious choice — it
matches the lambda syntax the language already has, so declaration and use read
the same way.

**Note for the M1.A writeup:** "generics" is reasonable to claim once generic
structs land, but a language where a function cannot take a function is hard to
describe as having a finalized type system. Either fix this alongside generic
structs, or state the limitation explicitly.

---

## BUG 41 — CRITICAL: `data struct` with a `List<…>` field type-checks clean and miscompiles — FIXED (2026-07-31)

**Fix (two independent defects):**

1. **Encoder nil type + missing wrap** (`TirToDataExpr.ts`): converting a
   list with non-data elements (`List<int>`) to `Data` consed the
   data-mapped elements onto a nil of the ELEMENT list type
   (`_mkMapList`'s first argument is the nil of the OUTPUT list) — the
   runtime `mkCons :: incongruent list types` trap — and the inline branch
   also never wrapped the mapped `list data` in `listData`. Same wrong nil
   in the cached `mkMapListToData` helper.
2. **Nested compilation leaking state** (`TirLitArrExpr.ts`,
   `TirElemAccessExpr.ts`): constant-folding a list literal runs a full
   nested `compileIRToUPLC` INSIDE the outer compile's `CompilationCtx`;
   the ctx's `hoistedCache` then pointed the outer pipeline at live nodes
   of the discarded nested tree (the `invalid constant` /
   "trying to increment use of variable not in context" backend crashes).
   Nested eager compiles now run on a CLONE of their term under a FRESH
   `CompilationCtx`.

Regression coverage: `compiler.structFieldRoundTrip.test.ts` — the field
type × encoding matrix below, all asserted by evaluation.

Found 2026-07-31 while auditing the 0.4.3 generic-struct work. **Not caused by
it** — reproduces identically on published **0.4.1**, so it is a long-standing
silent miscompile that the original audit missed. It is also **not
generics-related**: a plain non-generic struct fails the same way.

```pebble
data struct Bx { B{ items: List<int> } }

export function main( n: int ): int {
    const b: Bx = Bx.B{ items: [ n, n + 1 ] };
    return case b is B{ items } => items.head() ;
}
```

**Observed:** zero diagnostics; at runtime
`CEKError: mkCons :: incongruent list types; listT: list integer`.
**Expected:** `5`.

On 0.4.1 the same source fails with a differently-worded CEK error
(`case: expected constr or constant value`), i.e. broken in both, same class.

The `bytes` instantiation is worse — it dies at **compile** time with an
uncaught `invalid constant` from the backend:

```pebble
data struct Box<T> { B{ items: List<T> } }
export function main( n: int ): int {
    const b: Box<bytes> = Box.B{ items: [ #ff ] };
    return case b is B{ items } => ( items.head() == #ff ? 1 : 0 ) ;
}
```

**Scope — what does and does not fail** (all verified on 0.4.3):

| shape | result |
|---|---|
| `data struct` + `List<int>` field | **miscompiles** (`mkCons` CEK error) |
| `data struct Box<T>` + `List<T>` field @ `int` | **miscompiles** (same) |
| `data struct Box<T>` + `List<T>` field @ `bytes` | **compile crash** (`invalid constant`) |
| `runtime struct Box<T>` + `List<T>` field | works (`5`) |
| `data struct Box<T>` + plain `T` field | works (`5`) |
| `data struct Box<T>` + `Optional<T>` field | works (`5`) |
| bare `List<int>` local, no struct | works |

So it is specific to the **data (constr) encoding of a struct field whose type
is a list** — the list is not being converted to/from `Data` at the field
boundary, so a raw `list integer` meets a `list data` at runtime.

**Why this outranks the remaining feature gaps:** a validator datum holding a
list is one of the most common shapes in real Cardano contracts, and this fails
*silently* at compile time — exactly the BUG 27 failure mode, which is the class
that can put broken validators on chain. None of the deployed
`the-cardano-masterpiece` contracts hit it (they all still compile
byte-identically), but that is luck of their datum shapes, not coverage.

**Suggested test:** an evaluated round-trip for every field type crossed with
both encodings — `int`/`bytes`/`bool`/struct/`List<…>`/`Optional<…>` as a field
of a `data struct` and of a `runtime struct`. The gap that let this through is
that no test constructs a data-encoded struct with a list field and *runs* it.

---

## BUGs 42–44 — found by the first systematic field-type × encoding sweep (2026-07-31)

After BUG 41 was fixed I ran the round-trip matrix that the BUG 41 entry
recommends — every field type × every encoding, **constructed and read back and
asserted by evaluation** (`bug-repros/audit-field-matrix.mjs`, 52 cases). Most
combinations are fine. Four shapes are not, and one of them is silent.

This is the third time this exact class has produced a bug (27, 41, now 42).
The matrix is cheap and should become a real test — see "Suggested test" at the
end of this section.

> **STATUS: BUGs 42/43/44 FIXED (2026-07-31).** Root causes and fixes:
>
> - **42** — the named `Some{ value: … }` literal stored its payload RAW,
>   while the SoP-optional convention (see `TirCaseExpr._sopStructToIR`)
>   is that `Some` wraps DATA and consumers decode on extraction. The
>   literal now encodes the payload (`TirLitNamedObjExpr`), and the
>   `_inlineToData` / `_inlineFromData` optional branches were aligned to
>   the same convention (they re-encoded / pre-decoded the payload,
>   producing the mirror-image "iData :: not an int" / double-decode
>   failures). Standalone `Some{…}` + `case` was broken the same way.
> - **43** — `IRCase.clone()` cloned the continuations but passed the
>   SCRUTINEE by reference; the clone's constructor re-parented it, so the
>   backend's in-place pipeline mutations leaked into every tree still
>   sharing that node — poisoning the module-level `_boolFromData` helper
>   after its first use ("only closed terms can be hoisted"). The scrutinee
>   is now cloned; the ToData twins also got defensive `.clone()`s on
>   handout (`_boolToData` / `_mkUnitData` / `_strToData`).
> - **44** — two defects: `getNestedDestructsInSingleSopDestructPattern`
>   flattened ANY `TirSoPStructType` field as a single-constructor struct,
>   and `TirSopOptT` EXTENDS `TirSoPStructType`, so a two-constructor
>   optional field got destructured as constructor 0 (the "simple var decl
>   without init expr" crash — now guarded with `isSingleConstrStruct`);
>   and the literal compilers rejected `TirSopOptT` field values as
>   non-data-encodable through the same inheritance (optionals HAVE a data
>   conversion — now excluded from the rejection; the "filed" typo is also
>   fixed).
>
> Regression coverage: `compiler.structFieldRoundTrip.test.ts` now IS the
> suggested matrix — field type × encoding × (single-ctor, multi-ctor
> dispatch, generic instantiation), 64 cases, all asserted by evaluation.

### BUG 42 — CRITICAL: multi-ctor `runtime struct` with an `Optional<…>` field miscompiles — FIXED (2026-07-31)

```pebble
runtime struct S { A{ a: int } B{ f: Optional<int> } }

export function main( n: int ): int {
    const s: S = S.B{ f: Some{ value: n } };
    return case s is A{ a } => 999 is B{ f } => ( case f is Some{ value } => value is None{} => 0 ) ;
}
```

**Observed:** zero diagnostics; at runtime `CEKError: unIData :: not data value`.
**Expected:** `5`.

With `Optional<List<int>>` in the same position it is
`CEKError: unListData :: not data`. Silent at compile time — the BUG 27 / BUG 41
failure mode, i.e. the one that can put a broken validator on chain.

Not comparable against 0.4.1 (top-level `Some` was not resolvable there:
`ERROR 256 "'Some' is not defined"`), so this is newly-reachable territory rather
than a confirmed regression.

**Scope:** single-constructor `runtime struct` with an `Optional` field crashes
instead (BUG 44); the `data` encoding of both shapes is **correct**; `Optional`
nested in a `data` multi-ctor is correct.

### BUG 43 — HIGH: `bool` field in a multi-constructor `data struct` crashes the backend — FIXED (2026-07-31)

```pebble
data struct S { A{ a: int } B{ f: bool } }

export function main( n: int ): int {
    const s: S = S.B{ f: true };
    return case s is A{ a } => 999 is B{ f } => ( f ? 5 : 0 ) ;
}
```

**Observed:** `EXPORT THREW: only closed terms can be hoisted` — an internal
backend message with no source location.
**Expected:** `5`.

**Pre-existing: reproduces identically on published 0.4.1**, so it is not caused
by any recent work.

**Scope:** it is specifically *data encoding + 2 or more constructors + a `bool`
field*. A single-constructor `data struct` with a `bool` field is fine (`5`), and
the `runtime` encoding of the multi-ctor version is fine (`5`). Constructor
position does not matter — `bool` in the first or the second constructor both
crash. A generic `data struct G<T>` instantiated at `bool` crashes the same way.

A boolean flag beside other constructors (`Active{ enabled: bool }`) is an
entirely ordinary datum shape, and the message gives a user no idea what to
change.

### BUG 44 — MEDIUM: `Optional<…>` as a `runtime struct` field, or as a generic instantiation, crashes — FIXED (2026-07-31)

Two related backend crashes, both loud:

```pebble
runtime struct S { C{ f: Optional<int> } }
// EXPORT THREW: simple var decl without init expr
```

```pebble
data struct G<T> { C{ f: T } }
const s: G<Optional<int>> = G.C{ f: Some{ value: n } };
// EXPORT THREW: filed cannot be encoded as data
```

The second message also has a typo — "filed" should be "field".

`data struct S { C{ f: Optional<int> } }` (non-generic, data-encoded) is correct
and returns `5`, so this is the `runtime` encoding and the generic-instantiation
paths specifically.

### What the sweep found to be correct

Worth recording so the next audit does not redo it. All of these round-trip
correctly by evaluation, in both `data` and `runtime` encodings unless noted:
`int`, `bytes`, `bool` (single-ctor), `List<int>`, `List<bytes>`,
`List<List<int>>`, `Optional<int>` (data), `Optional<List<int>>` (data), a nested
struct field, and `List<struct>` — plus the generic `G<T>` instantiation of each
of those except `bool` and `Optional<…>`, and the multi-constructor dispatch form
of each except the two noted above.

### Suggested test

Port `bug-repros/audit-field-matrix.mjs` into the suite as a generated
`describe.each` over (field type × encoding × arity), asserting the **evaluated**
value rather than an empty diagnostics array. That single matrix would have
caught BUGs 27, 41, 42, 43 and 44. The reason this class keeps surviving is that
no existing test constructs a struct with a non-trivial field type and *runs* it.

---

## BUGs 45–47 — second-axis sweep: contract shapes and prelude types as fields (2026-07-31)

After BUGs 42–44 were fixed, the field-type matrix came back **50/52** (the two
non-passes are a bad `LinearMap` *literal* in the harness, not a compiler
defect — Pebble has no map-literal syntax; maps are built by casting
`std.builtins.unMapData(…)`). So I ran a different axis: the shapes a real
validator uses — contracts, states, redeemers, and prelude types as struct
fields (`bug-repros/audit-axis2-contracts.mjs`).

**All the contract-shape cases pass**: typed struct redeemers, a two-state
stateful contract with a struct datum, `mint` + `spend` in one contract,
`param x: T;` with `this.x`, a generic struct as a redeemer type, and a recursive
struct as a datum type. Also correct by evaluation: `Value` in a *runtime*
struct, `Optional<struct>`, `List<Optional<int>>`, mixed `bool`+`bytes`+`List`
payloads, and 3-constructor dispatch with the payload in the third constructor
(both encodings).

Three defects fell out. **All three reproduce identically on published 0.4.1**,
so none is caused by the recent work, and — unlike 27/41/42 — **none is silent**:
each fails loudly at compile time.

> **STATUS: BUGs 45/46/47 FIXED (2026-07-31).**
>
> - **45** — the ToData side had no `Value` branch (`_inlineToData` /
>   `_toDataUplcFunc` fell through to a throw with a misleading
>   "TirFromDataExpr" prefix); `IRNative.valueData` (the `unValueData`
>   mirror) is now emitted. The `Value` row is part of the
>   `compiler.structFieldRoundTrip.test.ts` matrix (single/multi-ctor and
>   generic, both encodings; runtime encoding was already fine).
> - **46** — `parseCaseExpr` consumed the trailing `;`, which belongs to
>   the ENCLOSING statement; on one line the statement parser then choked
>   on whatever followed, while multi-line was saved by automatic line
>   termination. The case parser no longer eats it. (Two suite tests used
>   the accidental `( case … ; )` form — a `;` INSIDE parentheses that was
>   only ever valid because of the swallow — and were updated.)
> - **47** — the cast path resolved the target by name against
>   `program.types`, where generic templates never live; generic
>   applications (`as LinearMap<bytes,bytes>`, `as Box<int>`) now route
>   through the type compilers like qualified names. Additionally
>   `LinearMap<K,V> -> LinearMap<K',V'>` re-typing lowers as the identity
>   (the runtime rep is `list (pair data data)` for every K/V) — so the
>   documented `unMapData(…) as LinearMap<…>` idiom now reaches codegen;
>   previously BOTH the direct form and the aliased workaround threw at
>   export ("Cannot convert from list_pair_data<data,data> …" — the alias
>   form was only clean at `check`).
>
> Coverage: `compiler.auditBugs.0_4_3.test.ts` + the matrix `Value` rows.

### BUG 45 — HIGH: `Value` as a `data struct` field cannot be decoded — FIXED (2026-07-31)

```pebble
data struct S { C{ v: Value, n: int } }

export function main( n: int ): int {
    const s: S = S.C{ v: std.value.zero, n: n };
    return case s is C{ v, n: m } => m ;
}
```

**Observed:** `check()` is **CLEAN**, then
`EXPORT THREW: TirFromDataExpr: cannot convert from Data to type Value`.
**Expected:** `5`.

The clean-check-then-backend-throw split is the notable part: the type system
accepts a struct it cannot actually encode, so the error surfaces with no source
location and an internal-sounding message.

**Scope:** the `runtime` encoding of the same struct works (`5`), and a `Value`
as a plain local works (`5`). It is specifically `Value` as a field of a
data-encoded struct — including the multi-constructor form.

`Value` is a prelude type and a plausible datum field (an escrowed amount, a
price). Either implement the `Data` round-trip for it or reject it at
declaration with a located diagnostic, rather than at export.

### BUG 46 — LOW: `case` as a `const`/`let` initializer is newline-sensitive — FIXED (2026-07-31)

Identical code, differing only in line breaks:

```pebble
// PARSES
const sh: Sh = Sh.C{ r: n };
const x = case sh is C{ r } => r is S{ s } => s ;
return n;
```

```pebble
// ERROR 1012: "Unexpected token."
const sh: Sh = Sh.C{ r: n }; const x = case sh is C{ r } => r is S{ s } => s ; return n;
```

Wrapping the `case` in parentheses fixes the one-line form, and `case` in
**return** position is unaffected either way. So the arm-list parser is
terminating on a newline rather than on the `;`, which makes formatting
semantically significant where it should not be — and "Unexpected token" gives no
hint that parentheses are the fix.

### BUG 47 — LOW: a generic prelude type is not usable in cast position — FIXED (2026-07-31)

```pebble
const m = std.builtins.unMapData( redeemer ) as LinearMap<bytes,bytes>;
// ERROR 256: "'LinearMap' is not defined"

type M2 = LinearMap<bytes,bytes>;
const m = std.builtins.unMapData( redeemer ) as M2;   // CLEAN
```

`LinearMap<…>` is fine as a **struct field** declaration and fine behind an
alias; only the direct cast fails, and it fails with "is not defined", which
points at the wrong thing. This is the same family as the old BUG 21 (prelude
types not usable in cast position), which was fixed for `TxOutRef` — the generic
prelude types appear to have been missed.

---

## Third-axis sweep: feature INTERACTIONS (2026-07-31) — 16/19, no new defects

BUGs 45–47 verified fixed on the local build. Both earlier sweeps are clean:
the field-type matrix is **50/50** (the `LinearMap` row was removed — Pebble has
no map-literal syntax, so it was a harness artefact, and `LinearMap` as a field /
alias / cast is covered by the axis-2 sweep instead), and the contract-shape
sweep is **16/16** (its three earlier "failures" were also harness syntax errors:
contract params are `param x: T;` inside the body, and `assert` needs the `case`
bound to a `const` first — both corrected in the script).

So I ran a third axis: **combinations of the features that landed independently
this week** — generic structs, recursive structs, function types/HOFs, interfaces
with `self`, constraint dispatch, namespaces, imports
(`bug-repros/audit-axis3-interactions.mjs`). Their interactions are what no test
covers, since each landed on its own.

**Result: 16/19, and no new defects.** Verified working by evaluation:

- **generics × recursion** — generic recursive lists and trees with recursive
  generic functions, both encodings, instantiated at a struct and at `List<int>`.
- **generics × HOFs** — a user-written `foldL<A,B>` over a *generic recursive*
  structure, a HOF returning a generic struct, a generic HOF taking a HOF.
- **interfaces × generics** — a generic function bounded by a *user* interface
  dispatching the real method, and two impls where dispatch picks correctly.
- **cross-module** — imported generic struct, imported recursive struct,
  imported generic HOF, imported interface + impl. All correct.

The three non-passes are **not** interaction bugs:

1. **`type Box<int> implements Sh` → `ERROR 100: "Not implemented: generic types
   interface implementations"`.** A declared gap with a clean, located
   diagnostic — loud and honest, not a defect. Worth listing as a known
   limitation if interfaces are mentioned in the M1.A writeup.
2 & 3. **Constructing a struct through a fully-qualified namespace path**
   (`M.S.C{ v: n }`) → `ERROR 1012 "Unexpected token."` — see BUG 48. This is
   *not* generics- or recursion-related: it fails identically for a plain
   non-generic struct, and identically on published 0.4.1.

### BUG 48 — LOW: a struct constructor is not reachable through a qualified namespace path — FIXED (2026-07-31)

> **FIXED.** The literal parser only knew the two-segment
> `Type.Constructor{ … }` form; a longer path fell through to the
> property-access chain and died on the `{`. The parser now consumes a full
> dotted path (last segment = constructor, previous = type, rest =
> namespace path, so `A.B.S.C{ … }` works too), and the literal compiler
> resolves the type through the namespaces' public scopes with local
> (non-walking) lookups — the same visibility rule as qualified type
> annotations (audit BUG 37). An unknown namespace head errors with
> "'X' is not defined" instead of "Unexpected token". Tests in
> `compiler.auditBugs.0_4_3.test.ts`.

```pebble
namespace M { data struct S { C{ v: int } } }
export function main( n: int ): int {
    const s: M.S = M.S.C{ v: n };          // ERROR 1012 "Unexpected token."
    return case s is C{ v } => v ;
}
```

`M.S` as a **type annotation** is fine, and the `using` form works for plain,
generic and recursive structs alike:

```pebble
using { S } = M;
const s: S = S.C{ v: n };                   // CLEAN → 5
```

Pre-existing (identical on 0.4.1), loud, and with a one-line workaround, so this
is a usability wart rather than a risk — but the message names neither the cause
nor the `using` workaround.

---

## Docs: 4 of 5 on-chain examples do not compile with 0.4.1

Not compiler bugs, but they fail in the same place a new user starts. Extracted
from `plu-ts-docs` (`pebble-docs`) and compiled with published `pebble-cli` 0.4.1:

| Doc page | Contract | Result |
|---|---|---|
| `examples/Hello World.md` | `HelloWorld` | `ERROR 2339: Property 'signatories' does not exist on type 'Tx'` |
| `examples/Vesting.md` | `Vesting` | same `ERROR 2339` |
| `examples/Simple order book DEX.md` | `SimpleOrderBook` | `ERROR 294: 'state' is not available in this contract method 'context'` |
| `examples/Simple minting policy.md` | `OneShot` | `ERROR 1005: "'when' expected"` (uses the `match { Some{…}: … }` form) |
| `examples/Simple minting policy.md` | `AllowAnyMint` | passes (4 lines, empty body) |

The correct field is `requiredSigners`, not `signatories`
(`preludeTypesSrc.ts:306`).

None of these snippets are wrapped in `<RunnableExample>`, so
`compiler.docExamples.test.ts` does not cover them — its header states the
exclusion explicitly ("if a doc example cannot be expressed as runnable
top-level Pebble … it stays as a static code block … and gets no test entry
here"), which is exactly the region that rotted.

**Fix:** a CI step that compiles every documented on-chain snippet, so prelude
renames like `signatories` → `requiredSigners` break the build instead of the
docs.

---

## Suggested order of work

### Original ordering (all of these are now done)

1. **BUG 30** first — until `export()` stops swallowing diagnostics, no green
   test proves anything about the fixes below.
2. **BUG 27** — one-line fix, silent wrong on-chain behaviour, plus an
   evaluated-result regression test for multi-ctor `runtime struct` (currently
   zero coverage).
3. **BUG 28 / 29** — both are "check the arms you already parsed" in
   `_compileCaseExpr`; BUG 34's join helper is the shared piece.
4. **BUG 31** — turn the three raw throws into located diagnostics (cheap),
   separately from implementing generic types (not cheap).
5. **BUG 32** — the real blocker for a usable stdlib; defer signature lowering to
   monomorphization.
6. Docs CI, then BUGs 33/35/36/37/38 as surface polish.

### Done as of 2026-07-31 (local 0.4.3)

Superseded — kept for history. Generic structs, recursive structs and BUG 40 all
landed and were verified *by evaluation*, not just a clean `check()`
(`bug-repros/audit-0.4.3-m1a.mjs`):

- **generic structs** — `data` and `runtime`, construct/read round-trip,
  `Result<T,E>` on both branches, two instantiations coexisting, nested
  `Box<Box<int>>`, generic struct as a function parameter.
- **recursive structs** — lists, trees, mutually recursive pairs, reads past the
  first element, *and recursive functions over them* (`sum` → 18, `depth` → 3,
  generic `len<T>` → 2).
- **BUG 40** — HOF parameters, a user-written `map<A,B>` (→ 15), a generic HOF
  over a generic struct (→ 12), HOF-returning-HOF (→ 20).
- no regressions: BUGs 27/28/34/39 still behave, and all four
  `the-cardano-masterpiece` contracts recompile byte-identically.

Generic *enums* were investigated and are a non-issue: Pebble enums are
payload-less C-style int enums with nothing to be generic over (`enum E<T>` does
not parse; `AstCompiler.ts:1428` hardcodes `isGeneric = false` for `EnumDecl`).

---

## M1.A TODO — resolution log (2026-07-31)

All compiler items from the outstanding list are done; the two judgment calls
are recorded below so the milestone writeup can quote them.

### 1. BUG 41 — DONE
Fixed (see the BUG 41 section above): list-field data encoder nil/wrap fix +
nested-compilation `CompilationCtx` isolation. Regression matrix in
`compiler.structFieldRoundTrip.test.ts` (field type × encoding, asserted by
evaluation). Found and filed BUG 42 along the way (pre-existing, OPEN).

### 2. Generic type aliases — DONE
`type Al<T> = …` registers on the generic registry per encoding; `Al<int>`
instantiates through `substituteTypeParams` wrapped in a `TirAliasType`.
Covers identity/container/struct aliases, multi-param, signatures, exports,
wrong-arity and duplicate-param diagnostics. Tests:
`compiler.genericAliases.test.ts`.

### 3. `self` parameter inference in interface impls — DONE
An unannotated first parameter named `self`/`this` in a
`type X implements I { m( self ) … }` block IS the receiver and is typed with
the implementing type in place (`_collectInterfaceImplSigs`). The two
formerly-`test.failing` cases in `compiler.show.test.ts` /
`compiler.interfaceConstraints.test.ts` now pass, so user interface impls
compile and constrained generics resolve the user's dictionary entry.

### 4. Constraint-based dispatch at monomorphization — DONE
`.toData()` is a universal method on every data-encodable type
(`getPropAccessReturnType` + a `TirToDataExpr` lowering in
`expressifyMethodCall`, mirroring `.show()`); user
`type X implements ToData` impls dispatch through the method table and WIN
over the builtin. A `<T implements ToData>` body can therefore use
`x.toData()` and every instantiation resolves it — including rejection of a
recursive `runtime struct` at the data boundary. Tests in
`compiler.interfaceConstraints.test.ts` ("constraint-based dispatch…").

### 5. The "full inference" claim — DECISION (scoped wording)
Parameter-type inference is NOT implemented and is not planned for M1.A:
`function f( x ): int` requires an annotation on `x`. What Pebble 0.4.3
actually provides — and what the writeup should claim — is:

> **Type inference in Pebble 0.4.3**: bidirectional checking with local
> inference — `const`/`let` types are inferred from initializers, function
> RETURN types are inferred from bodies (including nested `if`/`match`/loop
> returns), lambda parameter types are inferred from the expected callback
> signature, and generic type arguments are inferred at call sites by
> structural unification of the argument types (containers, functions and
> generic structs/aliases, e.g. `unbox( b )` on `Box<int>` binds `T = int`).
> Function PARAMETER annotations are always required; there is no global
> Hindley–Milner-style inference.

### 6. Publish / CLI unpin — dropped from this list by the maintainer.

### 7. Housekeeping — DONE
- The orphaned `packages/onchain` / `packages/offchain` trees (tests for a
  deleted plu-ts API, could never load) are REMOVED from the repo; the root
  test run is green.
- The doc examples in `pebble-docs` are fixed (`signatories` →
  `requiredSigners`, `match`-statement `when` syntax, `state`-in-fallback
  moved into the state block, `purpose` → `policy` in mint context, contract
  params read via `this.`, `Address.payment`, exact-mint via
  `std.value.zero`), and `scripts/compile-onchain-snippets.mjs` now compiles
  EVERY documented on-chain contract snippet as part of `npm run build`
  (12 snippets checked; `<!-- no-compile -->` marks intentional fragments,
  `// name.pebble` first-lines enable multi-file example pages).
- **`export * from` decision**: stays unimplemented for M1.A. Named exports
  and named re-imports cover the library API surface; `export * from` keeps
  its clear "not supported" diagnostic (loud, not silent). Revisit only if a
  real library hits it.

### 8. Example contracts — dropped from this list by the maintainer.

---

## BUGs 49–64 — found writing the Jacquard L2 kernel against 0.6.0-dev0 (2026-11-16)

> **STATUS (fixed 2026-11-16, local build, not committed).** Thirteen of these
> were hit while writing a ~3,500-line multi-file project (twelve contracts
> sharing five libraries); most were first worked around in the contracts.
> Three more (61–63) turned up while root-causing those. All sixteen are fixed
> in the compiler, and the contracts are back to the code one would write
> first. Regression coverage is in
> `packages/pebble/src/compiler/__tests__/compiler.jacquardBugs.0_6_0.test.ts`
> (112 tests; every one asserts the EVALUATED result, the exact diagnostic, or
> the shape of the term a pass leaves). Run against the unmodified compiler
> (`f846d866`), 89 of them fail, one never ends (BUG 51), and the 22 that pass
> are the controls ("X still works", "Y is still refused") and a few shapes
> that already worked. Full suite green (1303 passed). The examples, the four
> masterpiece contracts and the UPLC-CAPE exports compile to the same bytes as
> before.
>
> **One fix changes an encoding: BUG 60** (a boolean as data). Read it before
> merging.

| # | Severity | One-liner | Status |
|---|---|---|---|
| 49 | MEDIUM | the `else` arm of a `case` expression cannot read a variable or call a function: backend crash | FIXED 2026-11-16 |
| 50 | LOW | `Some{}` (no field bound) as a `case` pattern: backend crash | FIXED 2026-11-16 |
| 51 | CRITICAL | `match` with an `else:` arm: wrong value, a value of the wrong type, or a loop that never ends | FIXED 2026-11-16 |
| 52 | HIGH | `find` on a list of ints or bytes returns an `Optional` nothing can read | FIXED 2026-11-16 |
| 53 | MEDIUM | `using { … } = std.<namespace>` inside a function or a method: backend crash | FIXED 2026-11-16 |
| 54 | MEDIUM | map literals (`{}`, `{ #01: 10 }`) are documented and not implemented | FIXED 2026-11-16 |
| 55 | LOW | `Optional<T>.toData()` does not exist, although `ToData` is documented for it | FIXED 2026-11-16 |
| 56 | MEDIUM | a function or constant is visible only below its declaration | FIXED 2026-11-16 |
| 57 | LOW | `bytes + bytes` is refused, although documented as concatenation | FIXED 2026-11-16 |
| 58 | LOW | `const RawConstr{ index, fields } = unConstrData( d )`, as documented, is "Invaild destructuring" | FIXED 2026-11-16 |
| 59 | LOW | warning 6134 on a `const` that two statements read | FIXED 2026-11-16 |
| 60 | HIGH | a boolean as data is `Constr 0` when `true`: the opposite of the docs and of the ledger | FIXED 2026-11-16 (⚠ encoding change) |
| 61 | CRITICAL | two modules that each declare a function of the same name call each other's | FIXED 2026-11-16 |
| 62 | MEDIUM | a method of an alias, called on a variable annotated with the alias: backend crash | FIXED 2026-11-16 |
| 63 | LOW | a namespace's functions cannot use the functions and constants of their own module | FIXED 2026-11-16 |
| 64 | HIGH | `xs.head()` and `xs.tail()` inside an `if` run when the `if` is not taken: a valid script fails on an empty list it never reads | FIXED 2026-11-16 |

Not a compiler bug, reported here because it changes hashes: see
"`serialiseData` and maps" at the end of this section.

---

### BUG 49 — MEDIUM: the `else` arm of a `case` expression cannot read its surroundings — FIXED (2026-11-16)

> **FIXED.** `expressifyVars` rewrote the body of every NAMED arm of a
> `TirCaseExpr` (in a child context that knows the pattern's fields) and
> returned without touching `wildcardCase.body`. The `else` arm reached IR
> generation with its variable accesses unresolved and its method calls
> unlowered. It is now expressified like the others, in a child context of its
> own (it binds nothing).

```pebble
function g( x: int ): int { return x + 1; }
function pick( o: Optional<int> ): int {
    return case o
        is Some{ value } => value
        else g( 5 )            // "variable 'g' is missing in [o]"
        ;
}
```

The same root gave `else std.value.zero.toData()` its own message, "property
access cannot be translated to IR (missed expressify)". An `else` arm that was
a literal worked, which is why the arm looked supported.

---

### BUG 50 — LOW: `Some{}` as a `case` pattern — FIXED (2026-11-16)

> **FIXED.** `TirCaseExpr._sopStructToIR` (SoP `Optional` branch) looked up the
> `Some` pattern's `value` field unconditionally and threw "case pattern not
> expressified." when the pattern bound nothing. A pattern with no field now
> takes the payload as an unused lambda parameter.

```pebble
function isSome( o: Optional<int> ): boolean {
    return case o
        is Some{} => true      // backend: "case pattern not expressified."
        is None{} => false
        ;
}
```

`is Some{ value } => true` worked, at the price of a variable nobody reads.

---

### BUG 51 — CRITICAL: `match` with an `else:` arm miscompiles — FIXED (2026-11-16)

> **FIXED.** `TirMatchStmt` keeps its `else:` arm apart from `cases`
> (`wildcardCase`), and five analyses walked `cases` only:
> `TirMatchStmt.definitelyTerminates`, `definitelyFails`, the two traversals of
> `determineReassignedVariablesAndReturn` (and its own copy of
> `definitelyFails`), `prependUpdatesToUserContinues`
> (`expressifyForStmt`) and the "which arm goes on" search in `expressify`.
> So a variable assigned in the `else:` arm was not part of the state the
> `match` passes on, a `return` there was not a return of the function, and a
> `continue` there skipped the loop's update. `TirMatchStmt.arms()` now returns
> every arm, and all of them iterate it.

```pebble
struct S { A { x: int } B {} C {} }
function f( s: S, n: int ): int {
    let z = 0;
    match( s ) {
        when A{ x }: { z = x; }
        else: { z = n * 2; }      // never reaches the code after the match
    }
    return z + 1;
}
```

On the unmodified compiler, of the six regression cases: two fail at run time
with a value of the wrong type (`multiplyInteger :: invalid arguments`), one
returns nothing, one **never terminates** (`continue` in the `else:` arm of a
`match` inside a `for`: the update is skipped), and the two where every arm
returns pass. Nothing is reported at compile time.

---

### BUG 52 — HIGH: `find` on a list of native elements — FIXED (2026-11-16)

> **FIXED.** A SoP `Optional`'s `Some` holds RAW DATA; every consumer
> (`case`, `match`, `const Some{ value } = …`) decodes it on extraction. The
> finder (`_findSopOptional`) is type-blind: its `Some{ head }` holds the
> element as the list holds it, which is data for `List<TxIn>` and a native
> value for `List<int>` / `List<bytes>`. For those every consumer died decoding
> a non-data value. `xs.find` and `std.list.find` are now typed by the element
> (`tir/expressions/findSopOptional.ts`): a native element is encoded before it
> becomes the payload, as `std.list.at` already did. For elements that are data
> the term is the bare native exactly as before (same bytes).

```pebble
const xs: List<int> = [ 1, 2, 3 ];
match( xs.find( x => x == 3 ) ) {       // "unIData :: not data value"
    when Some{ value }: { … }
    when None{}: { … }
}
```

Compiles clean, fails on chain; `case`, a destructuring `const Some{ … }` and
`List<bytes>` (`unBData`) fail the same way.

---

### BUG 53 — MEDIUM: `using` a std namespace inside a body — FIXED (2026-11-16)

> **FIXED.** Same root as BUG 61: see there. `bindNamespaceMember` declared the
> member under the local name AS ITS OWN NAME (`{ ...variable, name: localName }`),
> so every use pointed at a name the program does not define
> (`__pebble__std__crypto__blake2b_256` is what it defines). The scope now maps
> the local name to the member's own name; renames (`{ blake2b_256: hash }`) and
> constants (`using { zero } = std.value`) work the same way.

```pebble
contract C {
    spend check( point: bytes ) {
        using { g1Uncompress, g1Compress } = std.crypto.bls12_381;
        assert g1Compress( g1Uncompress( point ) ) == point;
        // backend: "variable 'g1Compress' not found in the context"
    }
}
```

The docs' own `using { lookup, prepend } = std.linearMap;` example fails this
way inside a function.

---

### BUG 54 — MEDIUM: map literals are documented and not implemented — FIXED (2026-11-16)

> **FIXED (implemented).** "Builtin Values and Literals" and the `LinearMap`
> page document `{}` and `{ #01: 10, #02: 20 }`; the parser accepted identifier
> keys only and the compiler knew struct literals only (error 252). Now:
> - the parser reads a key as an expression; a literal with any key that is
>   not a bare identifier is a `LitMapExpr`;
> - it compiles to its entries prepended, last first, to the empty map, through
>   `std.linearMap.prepend` — no new kind of TIR expression, so every pass
>   after the AST compiler is untouched;
> - `{}` typed as a `LinearMap` is the empty constant list of pairs;
> - with no expected type, the first entry gives the map's.
>
> **A bare identifier is never a key.** `{ a: 1 }` is how a struct's fields are
> written; reading `a` as a variable in some literals would give one text two
> meanings. It is refused with error 30212, which says to write `{ (a): 1 }`.
> New diagnostics: 30211 (a map literal where another type is expected) and
> 30212.

```pebble
const empty: LinearMap<bytes, int> = {};                  // ERROR 252
const m: LinearMap<bytes, int> = { #01: 10, #02: 20 };    // "Identifier expected"
```

The docs need one sentence for the bare-identifier rule.

---

### BUG 55 — LOW: `Optional<T>.toData()` — FIXED (2026-11-16)

> **FIXED.** The rule that gives every type its `.toData()` asked
> `hasDataEncoding()`, which is `false` for the SoP representation of
> `Optional<T>` (every local `Optional` is one). The type is the same as the
> data-encoded one and the lowering for it existed (`_inlineToData`, which tags
> the payload without re-encoding it). `getPropAccessReturnType` now offers
> `toData` on a SoP `Optional` whose payload has a data encoding.

```pebble
const some: Optional<int> = Some{ value: 3 };
some.toData();     // ERROR 2339 "Property 'toData' does not exist on type 'Optional<int>'"
```

"Builtin Interfaces" lists `Optional<T>` in the `ToData` table.

---

### BUG 56 — MEDIUM: declarations are visible only below themselves — FIXED (2026-11-16)

> **FIXED.** `_collectAllTopLevelSignatures` did not collect signatures: it
> compiled each function and constant in source order, body included, and
> declared its name afterwards. A body saw only what was declared above it; an
> exported function calling a private helper below it was "not defined".
>
> Functions and constants of a module (or of a namespace) are now declared
> first (`AstScope.pendingValues`) and compiled by whichever comes first: their
> own statement, or the first use of their name (`AstScope.resolveValue`).
> Order no longer matters, for unannotated functions and constants too.
>
> A declaration found "compiling" by a use is being used in its own
> definition. A function calling itself never gets there (its name resolves to
> its own scope); two declarations defined in terms of each other do, and are
> refused with the new error 30210 instead of "'isEven' is not defined" — they
> have no closed term to compile to, and before this they could not even be
> written.

```pebble
export function main( n: int ): int { return helper( n ) + K; }   // 'helper' is not defined
function helper( x: int ): int { return x * 2; }
const K = 3;
```

---

### BUG 57 — LOW: `bytes + bytes` — FIXED (2026-11-16)

> **FIXED.** `TirAddExpr` lowers ints, bytes and `Value`s; `_compileAddExpr`
> typed ints and `Value`s only. One rule (`addRightOperandType`) now says what
> `+` adds — ints, bytes (and strings: `appendString`), `Value`s — and `+=`
> asks the same rule: it accepted ints only, so `total += value` on a `Value`
> was refused while `total = total + value` compiled.

```pebble
const cat = #dead + #beef;     // ERROR 2322 "Type 'bytes' is not assignable to type 'int'"
```

The `bytes` page says `concat` is "the same as `a + other`".

---

### BUG 58 — LOW: `RawConstr{ index, fields }` — FIXED (2026-11-16)

> **FIXED.** What `unConstrData` returns is a builtin pair, not a struct, and
> named destructuring knew structs and `Optional`s. It is now destructured by
> its two properties (`tir/types/utils/pairConstructorOf.ts`), in every form:
> `RawConstr{ index, fields }`, renamed, one property only, without the name,
> and with a property destructured further (`fields: [ a, b ]`). A
> `LinearMapEntry` goes through the same code, which fixes
> `for( const { key, value: P{ x } } of m )` on the way ("expected simple var
> decl in entry deconstruction").

```pebble
const RawConstr{ index, fields } = std.builtins.unConstrData( d );   // ERROR 1356
```

The form appears four times in the docs.

---

### BUG 59 — LOW: warning 6134 on a `const` that two statements read — FIXED (2026-11-16)

> **FIXED.** A letted value is computed where all its reads meet. `everyWayReads`
> applied that to the branches of an `if` and to what follows it, but not to
> the expression a statement evaluates itself. A read an assert's condition MAY
> get to (an argument of a `Value` method) and a read in the next statement
> meet at the assert; the analysis looked at each alone and found neither
> certain. The condition of an `assert` and of an `if`, and what a `match`
> matches, now count as parts. The regression tests also EVALUATE the three
> shapes to check the value really is computed there.

```pebble
} else if( pay == outboxCred ) {
    const total = toValue( value );        // WARNING 6134
    assert o.value.contains( total );
    custodyOut = custodyOut.union( total );
}
```

---

### BUG 60 — HIGH: a boolean as data is the other way round — FIXED (2026-11-16) ⚠ ENCODING CHANGE

> **FIXED, by changing the encoding.** `_boolToData` / `_boolFromData` used
> `true = Constr 0 []`, `false = Constr 1 []`. The docs ("Datum and Redeemer
> Flow", rule 5) say the opposite, and so does the ledger (PlutusTx `Bool`:
> `False` is the first constructor). Three things followed:
> - **a boolean of the ledger's was read inverted**: `IntervalBoundary.isInclusive`
>   is a `boolean` field of the prelude, and
>   `tx.validityInterval.from.isInclusive` was `false` for a closed bound. (The
>   `std.interval` helpers were special-cased in 0.5.0 to read the constructor
>   index themselves, with a comment calling the rest "pebble's own bool data
>   convention".)
> - off-chain code written from the docs produced datums and redeemers whose
>   booleans the script read inverted;
> - no boolean could be exchanged with a script of any other language.
>
> Now `false = Constr 0 []` and `true = Constr 1 []`, in the four places the
> convention lived: `TirToDataExpr`, `TirFromDataExpr`, the typed fuzzers'
> boolean samples and the debugger's rendering.
>
> **What breaks:** a contract with a `boolean` in a datum, a redeemer or any
> value it serialises has a new hash, and reads the booleans of existing UTxOs
> inverted. Nothing in the test suite or in the examples pinned the old
> encoding (all still pass, same bytes). If the old convention has to stay, the
> change is four small hunks to revert — and then the docs and
> `isInclusive` need the fix instead.

```pebble
struct Flags { a: boolean, b: boolean }
serialiseData( Flags.Flags{ a: true, b: false }.toData() )
// was 9f d87980 d87a80 ff        now 9f d87a80 d87980 ff
```

---

### BUG 61 — CRITICAL: functions of two modules with the same name — FIXED (2026-11-16)

> **FIXED.** `program.functions` is one map for the whole program. A top-level
> function was registered under its module-unique name AND under its bare
> source name, and the module's scope declared the value under the bare name;
> expressify then resolved every access through that one map. The last module
> to declare a `helper` owned the name: **the calls of every other module ran
> its function.** Constants had been given unique names already; functions had
> not.
>
> A function is now registered under its unique name only, and scopes map the
> name the source uses to it (`defineValue( infos, astName )`): top-level
> declarations, imports (the `as` alias no longer needs its own entry in the
> global map), `using`, and generic templates (`program.genericTemplates` was
> keyed by the bare name too). `_compileFuncExpr` no longer looks a signature
> up by name in the global map. `export( "main" )` takes the function the ENTRY
> module calls `main` — one it declares, or one it imports — instead of the
> first `main` any module declares.

```pebble
// a.pebble                                      // b.pebble
function helper( x: int ): int { return x + 1; }  function helper( x: int ): int { return x * 2; }
export function a( x: int ): int {                export function b( x: int ): int {
    return helper( x );                               return helper( x );
}                                                 }
// main: a( 5 ) * 1000 + b( 5 )   →  10010 (expected 6010): a ran b's helper
```

Silent, no diagnostic, and it depends on import order. The eight regression
cases cover private/private, entry/library, imported/private, two aliases,
generics, an unannotated function taking another module's signature, and the
two `export` cases.

---

### BUG 62 — MEDIUM: a method of an alias on an annotated variable — FIXED (2026-11-16)

> **FIXED.** `expressifyMethodCall` chose the method from the type of the
> receiver AFTER expressifying it. `expressifyVars` replaces a variable with
> the expression it was declared with, and `TirLettedExpr.type` is that
> expression's type: `const a: Amount = n;` is `n`, an `int`, with none of the
> methods `Amount` declares. The method is now the one the receiver's static
> type has — the type the call was checked with.

```pebble
type Amount = int;
type Amount implements { double( self ): int { return self * 2; } }
export function main( n: int ): int {
    const a: Amount = n;
    return a.double();     // backend: "not implemented::expressifyMethodCall for type 'int'"
}
```

`( n as Amount ).double()` and a parameter of type `Amount` worked.

---

### BUG 63 — LOW: a namespace cannot use its module's values — FIXED (2026-11-16)

> **FIXED.** A namespace's functions were compiled with its types, in the types
> pass, before any value of the module is declared: `inc` below was "not
> defined" whether declared above or below the namespace. They are now declared
> in the types pass and compiled with the values of the scope the namespace is
> in (or by their first use, `Ns.member` and `using` included). Order does not
> matter in either direction; mutual recursion through a namespace gets error
> 30210.

```pebble
function inc( x: int ): int { return x + 1; }
namespace M {
    function twiceInc( x: int ): int { return inc( x ) * 2; }   // 'inc' is not defined
}
```

---

### BUG 64 — HIGH: the head and the tail of a list, read in a branch — FIXED (2026-11-16)

> **FIXED.** `introduceCaseForDualHeadTailAndReturnRoot` replaces a
> `headList( L )` and a `tailList( L )` of the same list with one
> `case L of cons h t`. It put the case around the WHOLE body of the function
> holding them, on the reasoning that the case fails on an empty list exactly
> where the builtins did. That holds only where a builtin was certain to run.
> With both calls inside an `if`, the list was destructured on every way
> through the body, and the script failed on an empty list that the program
> never read.
>
> The case now goes around a term that cannot be evaluated without evaluating
> one of the calls: the body when a call is reached unconditionally (what the
> pass always did, so those scripts are unchanged), otherwise the smallest term
> holding all the calls when one of them is certain there (both in one arm).
> Calls that are all behind different branches stay builtins.

```pebble
let due: List<int> = [ 3 ];
let acc = 0;
for( const o of [ 5, 1, 2, 7 ] ) {
    if( o == n ) {
        const t = due.head();
        due = due.tail();
        acc = acc + t;
    }
}
// n = 2: the branch is taken once. At o = 7 `due` is empty and nothing reads
// it — "case: constructor tag 1 out of range (1 branches)"
```

It took a loop to see it (the list has to become empty while the body keeps
running), which is the shape of "consume one item of a list per matching
output". The failure reports the `if` statement, not the read.

---

### Seen, and left alone

- **`...rest` in a struct pattern** (`const P{ x, ...others } = p;`) parses,
  and the name is never declared (`'others' is not defined`), for every struct.
  It is not documented and has no obvious type; a design decision, not a fix.
- **`case x as T is A{} => …` does not parse** ("A 'case' expression must have
  at least one clause"): what is matched ends before `as`, as it ends before
  `is`. `case ( x as T ) is …` works. Only the message could say so.
- **A `const` can run before an `assert` written above it** when the `const`
  is read later. Documented in 0.6.0; only the reported place of a failure
  changes.
- **`trace someBytes;` decodes the bytes as UTF-8** and fails on anything else;
  `trace someBytes.show();` is the way. By design.

### Not the compiler: `serialiseData` and maps

`@harmoniclabs/plutus-data` (`dataToCbor`, 2.0.1 and the published 2.1.0)
encodes a non-empty `Data` map with an INDEFINITE length (`bf … ff`):
`src/toCbor.ts`, `new CborMap( …, { indefinite: data.map.length > 0 } )`.
`plutus-machine` uses `dataToCbor` for the `serialiseData` builtin. A node
encodes a map with a DEFINITE length; only lists and constructor fields are
indefinite there. What says so:

- **CIP-42** does not fix the length form itself: its CDDL
  (`{ * plutus_data => plutus_data }`) admits both. It defines the builtin as
  Plutus' existing `encodeData`, which it links.
- **`encodeData`** (`plutus-core/src/PlutusCore/Data.hs`), at the commit the CIP
  links and on master today: `Map es -> CBOR.encodeMapLen (fromIntegral $
  length es) <> …`, next to `List ds -> encode ds` (the indefinite one).
- **The Plutus Core specification** (appendix on the CBOR encoding of `data`):
  `E(Map l) = head(5, length(l)) · …`, `E(List l) = indef(4) · … · 255`.
- **Plutus' own test of the builtin**
  (`untyped-plutus-core/test/Evaluation/Builtins/Definition.hs`):
  `serialiseData( Map [(I 3, B ""), (B "hello", I -100)] )` is
  `a2 03 40 45 68656c6c6f 38 63`. `plutus-data` and `plutus-machine` give
  `bf 03 40 45 68656c6c6f 38 63 ff` for the same value.

(The DECODER accepts both forms, so a datum written with an indefinite map is
fine on chain; it is what `serialiseData` writes back that is definite.)

So a script that hashes serialised data containing a map computes one hash
under `pebble test` / buildooor and another on chain:

```pebble
const v = std.value.zero.insert( #aabb, #01, 5 );
trace std.builtins.serialiseData( v.toData() ).show();
// local machine:  bf42aabbbf410105ffff      a real node:  a142aabba1410105
```

Not touched (it is another package). Until it is fixed, a test that passes
here says nothing about a hash over a map.

### Not the compiler: `equalsData` on lists, and `multiScalarMul` — FIXED (2026-11-16)

Two more defects of the JavaScript CEK machine's dependencies, found the same
way. Neither is in the compiler; both change what a test of a contract can
see. Both are fixed where they are (not committed when this was written).

- **`equalsData` took a list for a longer one it is a prefix of.**
  `@harmoniclabs/plutus-data` 2.0.1, `src/Data.ts`, `eqData`: constructors and
  maps compared their lengths, lists did not
  (`a.list.every( ( elem, idx ) => eqData( elem, b.list[ idx ] ) )`). So
  `equalsData( List [], List [ I 1 ] )` was `True` on the local machine and
  `False` on a node, where it is `(==)` on `Data` (Plutus,
  `Default/Builtins.hs`: `equalsDataDenotation = (==)`; `Data` derives `Eq`).
  A script that checks an output by building the datum it expects accepted,
  locally, any datum whose lists are cut short — and a shortcut struct is a
  list of its fields. `a == b` on two `List<…>` values was not affected: the
  compiler emits its own loop for it. Fixed in `eqData`
  (`src/__tests__/Data.eqData.test.ts`, 6 tests).
- **`bls12_381_G1_multiScalarMul` and its G2 twin always failed on a list that
  is not empty.** `@harmoniclabs/plutus-machine` 3.1.0 called `msm` of
  `@noble/curves`, while its points are made by the copy of the same library
  vendored in `@harmoniclabs/crypto`: `msm` checks `instanceof` and threw
  `invalid point at index 0`. The sum is now built with the operations every
  other BLS builtin uses, and the second curve library is no longer a
  dependency.

### Not the compiler: what a script costs, and five results (2026-11-16)

Checking the multi-scalar multiplication against the Plutus conformance suite
(its 2026-01 state, 991 cases, 724 of them with the budget the evaluation must
spend) showed that the machine agreed with it on 899 of 935 results and on 396
of 724 budgets. It agrees on all of both now. None of this is in the compiler,
but every cost measured for a Pebble contract came out of this machine.

`@harmoniclabs/plutus-machine` (`src/__tests__/plutus_conformance_2026.test.ts`
holds the suite to results and budgets; `aiken_crosscheck.test.ts` now also
asserts the budget Aiken reports for a real script, met to the unit):

| What | Before |
|---|---|
| sizes of integers and byte strings | counted in bytes; Plutus counts 64-bit words. Every cost that grows with a size grew eight times as fast (`blake2b_256` of 64 bytes: 736,089 steps for 268,153), and costs that compare two sizes took the wrong branch: `divideInteger -503 -1777777777` cost 85,848 for 131,930, an **under**estimate |
| size of a string | its UTF-8 bytes, for its characters |
| `multiplyInteger`, `verifyEd25519Signature` | the cost shapes of Plutus V1/V2 (sum of the sizes; size of the signature) under V3 parameters, where they are the product of the sizes and the size of the message. A V1 or V2 cost model keeps the old shapes |
| division, quotient, remainder, modulo | the term in the square of the divisor's size was not squared |
| `integerToByteString`, `replicateByte`, `dropList`, shifts, rotations | a width, a length or a count was costed on the size of the number and not on what it asks for |
| `andByteString`, `orByteString`, `xorByteString` | costed on the operands after padding or truncating |
| `sliceByteString` | cost nothing when the slice was empty |
| `unValueData`, `listToArray`, `writeBits` | costed on a size where Plutus counts nodes, elements, positions |
| a cost beyond 64 bits | did not stop at the largest one |
| `xorByteString` with padding | padded with ones: wrong result |
| `findFirstSetBit` | wrong for anything but an all-zero input |
| `rotateByteString` | wrong beyond two bytes, and for a count that needs more than 53 bits |

`@harmoniclabs/uplc`, the text parser (`UPLC.Term.parseUPLCText.bls.test.ts`,
`…value.test.ts`): a list of BLS12-381 constants lost everything after its
first element; a `value` constant was kept as the list written, unsorted,
with repeated keys, zero quantities, keys of any length; a byte string with no
`#` was read as an empty one.

`@harmoniclabs/crypto` (`secp256k1.plutus.test.ts`, run on the sources and on
`dist`): the **built** package refused every ECDSA secp256k1 signature. It
compiles to ES5, where a class that extends `Error` builds plain `Error`s, and
the vendored `verify` tells "not DER, try the compact form" by `instanceof`.
The package's tests run from the sources and never saw it. The signature is
now read as `r ‖ s` and nothing else, a key that is not on the curve or an
`r`, `s` at or above the group's order is an error as on a node (it was
`false`), and so is a Schnorr key that is no x coordinate.

The costs measured for the Jacquard contracts came down with the fixes, the
more so the more a transaction hashes and multiplies field elements: the
data-mode commitment with the Groth16 and KZG checks went from 4.48 to 4.04
billion steps over 1 blob, from 6.21 to 5.28 over 4 and from 8.73 to 7.03 over
8, and 12 blobs fit a transaction (8.83 billion) where they did not.

### Not the compiler: buildooor and the ledger's balance

`TxBuilder` (buildooor 0.3.0) computed the change as `inputs + mint - outputs -
fee` (plus certificate deposits and refunds). Two terms of the ledger's value
conservation were missing: a treasury donation (`paymentToTreasury`) on the
produced side, and rewards withdrawn (a `withdrawal` with a non-zero amount) on
the consumed side. Either transaction was refused with `ValueNotConservedUTxO`.
Slashing a bond donates half of it, which is how it showed.

Fixed in buildooor (`balanceWithdrawalsAndDonation`, with
`TxBuilder.build.withdrawals_donation.test.ts`, 9 tests).

---

## BUGs 65–70 — found adding the data-L2 mode to the Jacquard kernel (2026-11-16)

> **Scope.** The same project as BUGs 49–64, one feature later. The line that
> started it is `claimed == old` on two `Optional<int>` parameters; 66 to 69
> were found following its root cause through the compiler, and 70 writing a
> KZG check.
>
> **Resolved.** All six are fixed at the root. Regression coverage is in the
> same file, `compiler.jacquardBugs.0_6_0.test.ts` (34 more tests, 146 in all;
> each asserts the evaluated result or the exact diagnostic). Run against the
> compiler before these fixes (`553b6ed1`), 26 of the 34 fail and the 8 that
> pass are the controls. Full suite green (1337 passed). The examples and the
> eleven Jacquard contracts that compiled before compile to the same bytes.
>
> **Not committed yet** when this was written.

| # | Severity | One-liner | Status |
|---|---|---|---|
| 65 | HIGH | an `Optional` read out of a datum and one made in a function are two types with one name: refused, crashing or wrong everywhere but as a call argument | FIXED 2026-11-16 |
| 66 | MEDIUM | `==` on an `Optional` made in a function, or on any type with no equality: backend crash | FIXED 2026-11-16 |
| 67 | MEDIUM | `List<Optional<T>>` as an annotation gets an element type no list can hold: backend crash | FIXED 2026-11-16 |
| 68 | MEDIUM | the `else` arm of a `case` expression is not type-checked | FIXED 2026-11-16 |
| 69 | MEDIUM | a variable narrowed by `is` or a `case` arm cannot be used as the type it has | FIXED 2026-11-16 |
| 70 | LOW | warning 6134 on a value that cannot fail: `n % R`, with `R` a module constant | FIXED 2026-11-16 |

### BUG 65 — HIGH: the two encodings of `Optional<T>` — FIXED (2026-11-16)

> **FIXED.** An `Optional<T>` is data when it comes out of a datum (`Constr 0
> [x]`) and a constructor term when a function makes it (`TirDataOptT`,
> `TirSopOptT`). Both print as `Optional<T>`. Two things were wrong.
>
> 1. In `canAssignTo`, the rule for a data optional as the TARGET was a copy of
>    the rule above it, for a SoP target, with its two cases not swapped: a SoP
>    optional was "assignable as it is" to a data one (it is not the same value
>    at run time), and a data optional "needs a cast" to a data one.
> 2. The conversion between the two (`isOptionalEncodingBridge`) was inserted
>    for call arguments only.
>
> The rule is now its mirror image, and every place a value flows into a typed
> slot converts through one helper (`AstCompiler/utils/fitToType.ts`): `return`,
> an annotated `const`/`let`, an assignment, the second arm of `?:`, the arms of
> a `case` (with a type to aim at, joined without one, the `else` arm too), a
> struct field, a list element, a call argument, and the operands of `==`.

```pebble
struct Holder { Holder { maybe: Optional<int> } }

function f( d: data ): Optional<int> {
    const Holder{ maybe } = d as Holder;
    return maybe;     // ERROR 2322 "Type 'Optional<int>' is not assignable to type 'Optional<int>'"
}
```

What each site did before, with `maybe` out of a datum and `made` built in the
function:

| Source | Before |
|---|---|
| `return maybe;` from a function declared `Optional<int>` | ERROR 2322, both types printed `Optional<int>` |
| `const x: Optional<int> = maybe;` &nbsp; `x = maybe;` | the same |
| `let y = maybe; y = made;` | backend: `Cannot convert from Optional<int> to Optional<int>` |
| `c ? maybe : made` | compiled; `c ? made : maybe` was ERROR 2322 |
| `[ maybe, made ]` | ERROR 2322 |
| `made == maybe` | ERROR 2322 |
| `maybe == made` | **compiled, and failed at run time**: `equalsData :: not data` |
| `f( maybe )` | converted (the one site that did) |

### BUG 66 — MEDIUM: `==` with no term behind it — FIXED (2026-11-16)

> **FIXED.** `_compileEqualExpr` accepted any two operands of assignable types
> and `IRNative.equals` threw `invalid type for std equality` for a SoP
> optional, a runtime struct, a function, a BLS12-381 element and an array —
> a backend error with no source position. Every `Optional` made in a function
> or received as a parameter is a SoP optional, so `a == b` on two parameters
> of type `Optional<int>` crashed, as did `xs.find( … ) == x` and `m.lookup( k )
> != none`.
>
> - A SoP optional has an equality now (`getEqSopOpt`): its `Some` holds the
>   payload's data encoding whatever the payload is, so one term compares any
>   two — by constructor, then `equalsData` on the payloads.
> - `hasStdEquality` (`tir/types/utils`) lists exactly the types
>   `IRNative.equals` has a term for; the front end asks it and reports error
>   2365 (`Operator '==' cannot be applied to types …`) for the others.
> - The left operand was compiled with the type the comparison is wanted as
>   (`boolean`), which refused a struct literal there: `if( P.P{ … } == p )`
>   was "Named object litteral is not assignable to boolean".

```pebble
function same( a: Optional<int>, b: Optional<int> ): boolean {
    return a == b;       // backend error: invalid type for std equality
}
```

### BUG 67 — MEDIUM: `List<Optional<T>>` as an annotation — FIXED (2026-11-16)

> **FIXED.** `List` is a registered generic name, so `List<Optional<int>>`
> reaches the named-generic branch of `_compileSopEncodedConcreteType`, which
> compiled every type argument as SoP. The branch for the native list above it
> compiles the argument as data, with the comment that says why: a list holds
> low-level UPLC values, never constructor terms. In the named branch an
> `Optional` among the arguments of `List` and `LinearMap` is now the data one.
> The other arguments resolve as they did, so a `List<G1>` is still a list of
> points (a type with no data encoding must not be resolved as data).

```pebble
const s: Optional<int> = Some{ value: 7 };
const xs: List<Optional<int>> = [ s, s ];      // backend error: invalid constant
const none: List<Optional<int>> = [];
none.prepend( s );                             // backend error: SoP encoded optional cannot be represented as uplc const
```

A list of optionals out of a datum could not be passed to a function declared
to take one either: "Type 'List<Optional<int>>' is not assignable to type
'List<Optional<int>>'".

### BUG 68 — MEDIUM: the `else` arm of a `case` — FIXED (2026-11-16)

> **FIXED.** `_compileCaseWildcardMatcher` compiled the arm's body and never
> compared its type with the expression's (BUG 29 added that check for the
> other arms). It is an arm like the others now.

```pebble
const n: int = case o is Some{ value } => value else #aabb;   // compiled; `n` is bytes when `o` is None
```

### BUG 69 — MEDIUM: a narrowed variable loses its type — FIXED (2026-11-16)

> **FIXED.** Inside `if( o is Some )`, the arm of a `case`, or `o is Some ? … :
> …`, the variable's type is a view of its struct holding some of the
> constructors (`narrowTo`). Two things did not know that a view is still the
> struct.
>
> 1. For an `Optional`, the view is a plain struct type named `Optional`: no
>    rule made it assignable to `Optional<T>`, it had no `toData`, and no
>    equality. `canAssignTo` now treats it as the optional it is, in the
>    encoding it has (`narrowedOptionalView`), and so do the conversion to data
>    and `==`.
> 2. Two views of one struct did not join: `joinTypes` now gives the view that
>    holds the constructors of both (`unionWith`).

```pebble
function valueOf( o: Optional<int> ): int { return case o is Some{ value } => value is None{} => 0; }

if( o is Some ) { n = valueOf( o ); }          // ERROR 2322 "Type 'Optional' is not assignable to type 'Optional<int>'"
const w = case v is A{} => v is B{} => v;      // ERROR 2322 "Type 'AB' is not assignable to type 'AB'"
```

### BUG 70 — LOW: warning 6134 on `n % R` — FIXED (2026-11-16)

> **FIXED.** Warning 6134 ("computed only where it is read, and some ways
> after it do not read it") is for a value whose computation may fail. A
> division counted as one unless its divisor was a number other than 0 written
> on the spot (`isNonZeroIntLiteral`). The order of a field is a `const` at the
> top of a file, and every `x % R` was "may fail": each `const` holding a field
> element drew the warning, on code with nothing to fix.
>
> `FailureAnalysis.isNonZeroConstant` follows a module's `const` to its value:
> a constant that is a number other than 0, directly or through another one,
> imported ones included. A constant that is 0, a parameter and a local
> variable still count as they did, also a local named like a module constant.

```pebble
const R = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001;

function main( n: int ): int {
    const m = n % R;        // WARNING 6134: 'm' is computed only where it is read…
    if( n > 100 ) return 0;
    return m;
}
```

---

## BUGs 71–75 — methods the checker offers and the backend does not have (2026-11-16)

> **Scope.** Bringing the Jacquard kernel up to the current data-L2 mode, a
> list built by prepending in a loop had to be put back in order:
> `cited.reverse()` type-checked and crashed the backend. Every method the
> checker offers on a list, a map and a byte string was then tried once
> (41 calls): 36 compiled and gave the right value, the others are below.
>
> **Resolved.** All five are fixed at the root, with 14 tests in
> `compiler.jacquardBugs.0_6_0.test.ts` (160 in all). On the compiler before
> these fixes 12 of the 14 fail and the 2 that pass are controls. Full suite
> green (1351 passed).
>
> **Not committed yet** when this was written.

| # | Severity | One-liner | Status |
|---|---|---|---|
| 71 | MEDIUM | `xs.reverse()` on a list or a map: accepted, then `not implemented::expressifyMethodCall` | FIXED 2026-11-16 |
| 72 | MEDIUM | `b.toInt()`, `b as int`, `std.bytes.toInt( b )`: accepted, then `unknown (negative) native … _bytesToIntBE` | FIXED 2026-11-16 |
| 73 | MEDIUM | `==` on two entries of a map, and `map.includes( entry )`: `unknown (negative) native … _equalPairData` | FIXED 2026-11-16 |
| 74 | MEDIUM | `map.find( … )`: `TirToDataExpr: cannot convert to Data from type #pair_data` | FIXED 2026-11-16 |
| 75 | LOW | `bytes.decodeUtf8()` had no backend, `string.encodeUtf8()` could not be written, and a string was offered the methods of `bytes`, which fail on it at run time | FIXED 2026-11-16 |

All five are backend errors with no source position, on code the checker
accepted.

### BUG 71 — MEDIUM: `reverse()` — FIXED (2026-11-16)

> **FIXED.** `getListMethods` and `getLinearMapMethods` declare `reverse`;
> `expressifyListMethodCall` ended on a commented-out `// TODO` listing it. The
> function `std.list.reverse( xs )` existed and worked. The method is now the
> same term (`tir/expressions/reverseList.ts`, used by both), and a map has it
> through the list of pairs it is.

```pebble
let acc: List<int> = [];
for( const x of xs ) { acc = acc.prepend( f( x ) ); }
const inOrder = acc.reverse();      // backend error: not implemented::expressifyMethodCall … 'reverse'
```

### BUG 72 — MEDIUM: bytes to integer — FIXED (2026-11-16)

> **FIXED.** `IRNativeTag._bytesToIntBE` is what `b.toInt()`, `b as int` and
> `std.bytes.toInt( b )` compile to, and `nativeToIR` had its case commented
> out (`// case IRNativeTag._bytesToIntBE: ;`). It is `byteStringToInteger
> True`, the mirror of the `_intToBytesBE` beside it. Contracts reached the
> builtin directly (`std.builtins.byteStringToInteger( true, b )`), which is
> why nothing showed.

### BUG 73 — MEDIUM: equality of two map entries — FIXED (2026-11-16)

> **FIXED.** The same in `nativeToIR` for `IRNativeTag._equalPairData`, which
> `TirNativeFunc._equals` returns for a pair of data and for a map entry: `e ==
> f` and `map.includes( e )` crashed. Two pairs are equal when both halves are
> (`equalsData` on each, the second only if the first holds).

### BUG 74 — MEDIUM: `find()` on a map — FIXED (2026-11-16)

> **FIXED.** `find` wraps what it finds in `Some`, whose payload is data: for a
> list of integers the element is encoded first (BUG 53). For a map the
> element is a pair, which has no data form, and asking for one threw. But the
> consumers of an `Optional<entry>` already take the payload as the pair it is
> (`_inlineFromData`: "LinearMapEntry is Pair<Data,Data> at runtime — no
> conversion needed"), so the finder now leaves a pair as it finds it
> (`findSopOptional.ts`, `elementsAreData`).

```pebble
const best = case prices.find( e => e.value > floor )      // backend error: cannot convert to Data from type #pair_data
    is Some{ value } => value.key
    is None{} => #;
```

### BUG 75 — LOW: a string and its bytes — FIXED (2026-11-16)

> **FIXED.** Three things about the type `string` (what `decodeUtf8` gives; a
> quoted literal is `bytes`).
>
> 1. `bytes.decodeUtf8()` was declared and `expressifyMethodCall` had no case
>    for it: `not implemented::expressifyMethodCall for type 'bytes'`.
> 2. The table `stringMethods` (`encodeUtf8`) was never read: a string was
>    given `bytesMethods` instead, so `s.encodeUtf8()` was error 2339 and the
>    only way from a string to its bytes was `std.builtins.encodeUtf8( s )`.
> 3. With the methods of `bytes`, `s.length()` or `s.slice( … )` on a string
>    compiled to `lengthOfByteString`, `sliceByteString` applied to a string,
>    which fail at run time. They are refused now (error 2339): a string has
>    the one method that gives its bytes, and the rest is asked of those. The
>    member list the editor shows (`SourceTypeMap.stringMembers`) says the same.

---

## BUGs 76–77 — found writing the Jacquard DA scripts (2026-11-16)

> **Resolved.** Both fixed at the root, with 6 tests in
> `compiler.jacquardBugs.0_6_0.test.ts` (166 in all). Full suite green (1357
> passed). **Not committed yet** when this was written.

| # | Severity | One-liner | Status |
|---|---|---|---|
| 76 | MEDIUM | a `case` arm whose body is `c ? a : b` swallows the next arm: "Statement expected", reported lines below | FIXED 2026-11-16 |
| 77 | LOW | warning 6134 on a value read in a list written out for a multi-scalar multiplication | FIXED 2026-11-16 |

### BUG 76 — MEDIUM: a conditional as the body of a `case` arm — FIXED (2026-11-16)

> **FIXED.** Inside a `case`, `is` separates the arms and binds looser than
> `?:` (`_caseArmIsLowPrec`). The parser read the else branch of a conditional
> down to the comma, as outside a `case`, so with an arm after it the branch
> took that arm's `is` for a test of its own last operand: `b is Rect{ … }`.
> What followed (`=>`) then made no sense, and the error was reported where the
> statement list next broke — in the case that showed it, the closing brace of
> the next function. The else branch now stops where its arm does. In
> parentheses nothing changes: `( c ? p : q ) is Some` and `( c ? p : q is Some )`
> are what they say.

```pebble
return case shape
    is Square{ side } => big ? side * side : side
    is Rect{ w, h } => w * h          // ERROR 1368 "Statement expected.", some lines further down
    ;
```

### BUG 77 — LOW: warning 6134 and a list written out — FIXED (2026-11-16)

> **FIXED.** The analysis behind warning 6134 does not count a read inside a
> list written out (`[ a, v ]`) as one that computes `v`, and it is right not
> to: `[ a, v ].head()` is `a`, and `v` is never computed (there is a control
> for it). But a list written out as the scalars or the points of
> `g1MultiScalarMul` is used whole, and a `const` holding one of them — a field
> element reduced with an assert on its range — drew the warning on code with
> nothing to fix. The two multi-scalar multiplications are now known to use
> every element of a list written out for them
> (`loopResultIsForced.ts`, `WHOLE_LIST_BUILTINS`).

```pebble
const v = evaluated( coeffs, x );                    // asserts each coefficient is a field element
const left = g1MultiScalarMul( [ 1, R - v ], … );    // WARNING 6134: 'v' is computed only where it is read…
```

## BUGs 78–81 — one function, compiled several times (2026-11-16)

> **Scope.** The registry script of the Jacquard DA layer came out at 22,089
> bytes: more than a transaction holds. It verifies a Merkle Patricia Forestry
> proof in five places, and the proof function was in the script once per
> call — a function called once cost 3,471 bytes, twice 6,547, four times
> 12,705. Four faults of the backend, each of which alone makes it compile a
> function more than once.
>
> **Resolved.** All four are fixed at the root, with 33 tests in
> `compiler.jacquardBugs.0_6_0.sharing.test.ts`; on the compiler before these
> fixes 30 of them fail (the three that pass are two controls and the test of
> the new debug check itself). Full suite green (1390 passed), also with
> `PEBBLE_DBG_HASHES=1`. The same function now costs 1,135
> bytes called once, 1,158 twice, 1,180 four times; the registry is 4,175
> bytes; the fourteen scripts of the Jacquard kernel went from 33,332 bytes
> to 30,300 (the largest from 14,164 to 12,053), and all their tests pass.
>
> **Not committed yet** when this was written.

| # | Severity | One-liner | Status |
|---|---|---|---|
| 78 | HIGH | a pass that rewrites a term gives each copy of it variables of its own: the copies are no longer one term, and a function is compiled once per call | FIXED 2026-11-16 |
| 79 | HIGH | a term goes on remembering the hash it had before what it holds was replaced: terms that differ pass for equal, and equal ones for different | FIXED 2026-11-16 |
| 80 | HIGH | the walk of the tree skips the other branches of a `case` once a term was replaced inside one: a pass that replaces something everywhere does it in one method only | FIXED 2026-11-16 |
| 81 | HIGH | a function that hashes passes for expensive work and is bound again in every branch it is called from: a copy of its body per branch | FIXED 2026-11-16 |

None of the four gives a wrong script by itself: the scripts were right, and
several times too large. 79 and 80 are worse than that in what they allow —
see each.

### How the backend shares a term

A term is in the tree once per use: a function called in four places is four
copies of one term. `handleLetted` and `handleHoisted` recognize the copies by
their **hash** — a Merkle hash over the tree, in which a variable is hashed by
identity — and bind the term once for all of them. Everything below is a way
for two copies of one term to stop having the same hash, or for a term to be
bound once per place although it has one.

### BUG 78 — HIGH: every copy of a term gets variables of its own — FIXED (2026-11-16)

> **FIXED.** A pass that introduces a variable now asks for the one that
> belongs to what it is rewriting (`derivedSymbol`, a table of the
> compilation keyed by the hash of the term before the rewrite), so equal
> terms are rewritten into equal terms. `TirHoistedExpr.toIR` already said
> why that matters ("converting the same function once per call site would
> produce hash-DIFFERENT (alpha-equivalent) copies") and solved it for the
> conversion to IR by converting once and cloning; the passes that run after
> it undid that. The places:
>
> - a test of a list (`xs.isEmpty()`, `xs.length() == 0`, `strictChooseList`)
>   becomes a `case` whose branch binds the head and the tail: `Symbol("_h")`
>   and `Symbol("_t")` at each of the three sites of
>   `rewriteNativesAppliedToConstantsAndReturnRoot`. Nothing differs until
>   `rewriteHeadTailInCaseCons` makes the branch READ them;
> - the `case` introduced where a function reads both the head and the tail
>   of a list (`introduceCaseForDualHeadTailAndReturnRoot`);
> - the function that drops `n` elements, built again wherever `n` elements
>   are dropped, for an `n` with no template (5, 6, 7, 9, …);
> - `λ recBody. recBody recBody`, which each recursive function is applied
>   through: one variable for all of them now, as for any other template.

```pebble
function total( xs: List<int>, acc: int ): int {
    if( xs.isEmpty() ) return acc;                    // -> case xs of cons _h _t -> … ; nil -> acc
    return total( xs.tail(), acc + xs.head() );       //    … _t … _h …
}
// total( a, 0 )                                              36 bytes
// total( a, 0 ) + total( b, 1 )                              71 bytes   (now 45)
// total( a, 0 ) + total( b, 1 ) + total( c, 2 ) + total( d, 3 )   137 bytes   (now 62)
```

A function with no list test in it was shared, which is why this went
unnoticed: it takes a rewrite that binds something, and then a read of it.

### BUG 79 — HIGH: the hash of a term that no longer exists — FIXED (2026-11-16)

> **FIXED.** Every node remembers its hash once computed, and has a
> `markHashAsInvalid` that forgets it and tells the node it is in. Nothing
> called it: the setters of a node's children did, until the hashes were
> removed and put back (`0b3ce7a6 add back IR hashes`, 2025-10) without those
> calls. A node whose child was replaced kept the hash of the term it had
> been — for the rest of the compilation.
>
> `handleLetted` reads equal hashes as "identical free-var SYMBOLS, bound by
> the same binder chain" and binds one value for all the terms that have one.
> With hashes that are never forgotten that reads: all the terms that WERE
> equal when someone first asked. Two copies rewritten differently — one
> inside a `case` on a list, where `headList( xs )` becomes the variable of
> the branch, one outside — stayed "the same term", and one of the two values
> was bound for both. And which terms had been asked depended on what ran
> before: the copies of a builtin's template, hashed when the compiler loads,
> were recognized whatever was done to them; the copies of a user's function,
> hashed late, were not (BUG 78 showed there and not elsewhere).
>
> Fixed where it was lost and in what depended on it:
>
> - every setter of a child forgets the hash of its node and of the nodes it
>   is in (`invalidateHashesFrom`: a loop, not a recursion as deep as the
>   tree, that stops at the first node remembering nothing);
> - `removeUnusedVars` edits the parameters of a function in place: the hash
>   says how many there are;
> - a copy remembers what its original remembers — but `IRFunc.clone()` and
>   `IRNative.clone()` did not, so a copy of a term that remembered its hash
>   held a function that did not: a change inside the function stopped there
>   and never reached the copy;
> - `IRHoisted`'s constructor unwraps a hoisted term given another one, its
>   setter did not: a node holding `hoisted( hoisted( x ) )` was copied as
>   `hoisted( x )` with the hash of the former.
>
> **`PEBBLE_DBG_HASHES=1`** checks after every pass that no node remembers
> the hash of a term it no longer is, and makes every node remember one for
> the next pass (`_debug_assertFreshHashes`). The whole suite passes under
> it; one test compiles a contract under it for good.

```ts
const app = new IRApp( new IRVar( x ), IRConst.int( 1 ) );
const fn = new IRFunc( [ x ], new IRDelayed( app ) );
fn.hash;                                              // 1f1fc386…
_modifyChildFromTo( app, app.arg, IRConst.int( 2 ) );
fn.hash;                                              // 1f1fc386…: of the function it was (now 71da7559…)
```

Fixing this alone makes scripts LARGER (the kernel's by 6%): the stale
hashes were hiding BUG 78 and BUG 80 for every term hashed early.

### BUG 80 — HIGH: the walk of the tree skips what it has not visited — FIXED (2026-11-16)

> **FIXED.** `iterTree` visits a term before the terms it holds; when the
> callback replaces the term it was given, the walk forgets the terms of the
> same parent still waiting and visits the parent again. It forgot more than
> those: every waiting term marked "a later child of its parent", whoever the
> parent. When the term replaced was the last one waiting below its own
> parent — the builtin at the head of an application, visited after the
> arguments — what was waiting next belonged to a term further up: the other
> branches of a `case`, the other fields of a `constr`. They were dropped,
> and the walk went back to the replaced term's parent only. It now drops
> what the parent was holding, and nothing else.
>
> Passes that replace a term everywhere did it in one place:
>
> - `_makeAllNegativeNativesHoisted` wraps every builtin: in a contract of
>   three methods it wrapped the ones of the last method;
> - `replaceNativesAndReturnRoot` lowers the compiler's own builtins
>   (`_length`, `_strictAnd`, …): the ones it skipped reached the end of the
>   compilation and failed there (`getNRequiredForces … input was: -<tag>`).
>   The repeated sweeps of `compileIRToUPLC`, and their comment ("this shows
>   up in contracts with enough methods for bodies to be shared"), are what
>   was built around that;
> - `handleLetted` removes a `force` around a builtin that is bound already
>   forced; one it skipped forces the builtin twice, which fails when the
>   script runs (the comment there records it as found on-chain);
> - `replaceClosedLettedWithHoisted`.
>
> With BUG 79 fixed it is also a size bug: the three copies of a function
> were two terms, one with its builtins wrapped and two without
> (`compiler.masterpieceBugs.0_3_5.sharedFunctions.test.ts`, which the stale
> hashes had been passing, caught it).

### BUG 81 — HIGH: a function that hashes is bound in every branch — FIXED (2026-11-16)

> **FIXED.** A closed value read in several branches of a `case` is bound
> once above them — unless it is expensive work (a hash, `serialiseData`),
> which no method that does not read it should pay for: that one is bound in
> each branch that reads it. `containsExpensiveWork` looked for a hash
> ANYWHERE in the value, also in the body of a function nobody is calling
> there. So every function that hashes was expensive work, and its body was
> written again in each branch of each `case` it was called from, down to
> the innermost. In the registry `combine` — `blake2b_256( a + b )` — had 128
> bindings for 192 calls, and the proof function two copies of 2,822 terms
> each. It now asks what EVALUATING the value does: a function does nothing
> where it is built, a delayed term nothing until forced; applied to all its
> parameters, forced, or as the branch of a `case`, their body runs and
> counts. A hash computed once (`const DIGEST = sha2_256( … )`) is still
> bound only where it is read (a control checks the cost of a method that
> does not read it).

```pebble
function combine( a: bytes, b: bytes ): bytes { return std.crypto.blake2b_256( a + b ); }
// called from 1, 2, 4 and 6 methods of a contract: +0, +1, +2 copies… now one, and a call each
```

### The snapshots of `compiler.contractRedeemerEncodingParity.test.ts`

Three scripts are pinned byte for byte there, to notice a change of the
redeemer's wire format. They changed (216, 166 and 182 bytes; now 210, 166
and 180): builtins are wrapped in every method now. Before recording them
again the scripts recorded before were run against the new ones on 5,040
contexts — 21 redeemers of every shape, 6 minted amounts, 5 numbers of
inputs, the datums of the state — and gave the same verdict on each.

## BUGs 82–84 — found writing the step scripts of the Jacquard reference ledger (2026-11-17)

> **Resolved.** All three fixed at the root, with 13 tests in
> `compiler.jacquardBugs.0_6_0.steps.test.ts`. Full suite green (1403 passed).
> **Not committed yet** when this was written.

The step scripts re-execute one transition of an L2's ledger on L1: a state
threaded through a few dozen functions, a cache of the keys opened so far, and
values read off whatever data somebody put in a transaction. They are the first
code here that keeps its working state in runtime structs.

| # | Severity | One-liner | Status |
|---|---|---|---|
| 82 | MEDIUM | `List<T>` with `T` a runtime struct is accepted, and the back end fails on the first literal: "SoP struct cannot be represented as uplc constants", no source location | FIXED 2026-11-17 |
| 83 | MEDIUM | `xs as List<T>` between two lists: accepted by the checker, "Cannot convert from List<data> to List<Asset>" in the back end | FIXED 2026-11-17 |
| 84 | HIGH | a runtime struct with a single-constructor runtime struct in a field: any read of it fails with "simple var decl without init expr" | FIXED 2026-11-17 |

### BUG 82 — MEDIUM: a `List` of runtime structs — FIXED (2026-11-17)

> **FIXED.** A UPLC list holds constants: integers, byte strings, data. A
> runtime struct is a constructor term, and no list holds one. The type
> compiler resolved the element type of a `List` written with a name
> (`List<Entry>`) as it does any other type argument, so a runtime struct
> came out as itself and the type was accepted — in a variable's annotation
> and in a signature. The first literal of such a list (`[]`) then asked the
> element type for its constant type and the back end threw, with nothing to
> say where. It is error 30213 now, at the type argument, and names the two
> ways out: declare the struct a `data struct`, or keep the values in a
> recursive runtime struct (`Nil {} / Cons { head, tail }`), which is a list
> of constructor terms and compiles to `case` (a control builds and sums one).
> The same for the values of a `LinearMap`.
>
> Three cases of `compiler.testStmt.property.skip.test.ts` used
> `List<runtime struct>` as their example of a parameter type with no
> fuzzer. They take a function now, which nothing samples either.

```pebble
runtime struct Entry { key: bytes, value: int }
const none: List<Entry> = [];        // backend error: SoP struct cannot be represented as uplc constants.
```

### BUG 83 — MEDIUM: a cast between two lists — FIXED (2026-11-17)

> **FIXED.** `canCastTo` takes `List<A> as List<B>` whenever `A` casts to `B`,
> and `TirTypeConversionExpr.toIR` had no case for a list at all: every such
> cast failed in the back end with "Cannot convert from List<data> to
> List<Asset>". A list holds its elements as data when they are data, a data
> struct or an optional out of one, and as the plain value otherwise. Between
> two lists of the first kind the cast is now the identity — which makes
> `std.builtins.unListData( d ) as List<Asset>` the way to give the elements
> of a list read off some data their type — and between a list of data and a
> list of plain values each element is decoded or encoded (`_mkMapList`). The
> checker no longer takes what the back end has no way to do: a list of
> integers as a list of byte strings is error "cannot be converted" where it
> is written.

```pebble
const assets = std.builtins.unListData( value ) as List<Asset>;   // backend error: Cannot convert from List<data> to List<Asset>
```

### BUG 84 — HIGH: a runtime struct in a field of a runtime struct — FIXED (2026-11-17)

> **FIXED.** A variable of a single-constructor runtime struct is taken apart
> once, by a `case` whose pattern binds every field; a field that is itself a
> single-constructor runtime struct is taken apart again inside
> (`getNestedDestructsInSingleSopDestructPattern`). The helper that builds
> those patterns, `getConstrDestructPattern`, was given what the nested
> pattern takes apart — the field — and put it as the initializer of EVERY
> field of the pattern, leaving the pattern itself with none. The outer
> pattern passes no initializer, so it was unaffected; the nested one, the
> only caller that passes one, never worked: `expressify` refused the
> declaration with "simple var decl without init expr", for any function
> that so much as read another field of the outer struct. The initializer
> now goes where it belongs. A recursive runtime struct in a field (several
> constructors, taken apart by `case`) was never affected, and a control
> keeps it so.

```pebble
runtime struct Fx { acc: bytes, count: int }
runtime struct Work { ok: boolean, leaves: int, fx: Fx }
const w = Work{ ok: true, leaves: n, fx: Fx{ acc: #aa, count: 2 } };
return w.leaves;        // backend error: simple var decl without init expr
```

## BUG 85 — found adding programmable tokens to the Jacquard kernel (2026-11-17)

### BUG 85 — LOW: the parameter of `x => ...` cannot be captured by a lambda inside — FIXED (2026-11-17)

> **FIXED.** A parameter is `const` unless it is written `let`
> (`parseParameters`). The parser built the parameter of the bare form,
> `x => ...`, on another path, with no flag at all — and whatever is not
> `const` is a mutable `let` to the capture check. So
> `xs.every( t => ys.some( i => i == t ) )` was refused with error 30207,
> "Lambdas can only capture 'const' bindings; 't' is a mutable 'let'", while
> the same line with `( t ) =>` compiled. The bare parameter is flagged
> `const` now, as the form has no way to say otherwise; assigning to it is an
> error, as for any other `const`. Three tests in
> `compiler.jacquardBugs.0_6_0.steps.test.ts`. **Not committed yet** when
> this was written.

```pebble
// refused: 't' is a mutable 'let'
prog_tokens.every( t => tx.refInputs.some( i => i.resolved.value.amountOf( registry, t.policy ) == 1 ) )
```

### Not the compiler: `serialiseData` of a map, off chain and on a node (2026-11-17)

Found when the Jacquard kernel was first run against a real node, and fixed
before anything of it relied on the difference.

A script that hashes `serialiseData( d )` hashes the ledger's own encoding of
`d` (`PlutusCore.Data.encodeData`): a list, and a constructor's fields, as an
array of indefinite length; a **map as a map of definite length**. The
machine in `@harmoniclabs/plutus-machine` gave the builtin `dataToCbor` of
`@harmoniclabs/plutus-data`, which writes a non-empty map with an indefinite
length (`bf .. ff`): the same data to any CBOR reader, other bytes to a hash.
So a script that hashes data with a map in it — a `Value`, an AssocMap in a
datum — computed, in `pebble test`, in buildooor's evaluation and in the
emulators built on it, a hash that no node computes. Data without a map
serialised alike; the Jacquard formats hold none, by rule, for an older
reason.

The builtin now has an encoder of its own, written to the ledger's
(`src/BnCEK/impl/serialiseData.ts`: definite maps, indefinite non-empty lists,
64-byte chunks for long byte strings and big integers, the three constructor
tag ranges), with tests of every case and of the builtin as a script sees it
(`src/BnCEK/impl/__tests__/CEK.serialiseData.test.ts`, 7 tests; full suite
1589 passed). `dataToCbor` itself is unchanged: it is what datums built off
chain are written with, and whether its default should follow is a separate
decision. **Not committed yet** when this was written; the copy of the
machine installed under buildooor was patched with the same change.

### Not the compiler: an integer constant above 2^31, and the script that reaches L1 (2026-11-16)

Found right after BUGs 78–81, and first taken for a fifth one: the registry's
`assert stake >= MIN_BOND;` (`MIN_BOND = 10_000_000_000`, 10,000 ada) accepted
a bond of 5,000 ada, on a script whose final IR was right.

The compiler's output was right too. What ran was not it: `loadContract`
reads the `.flat`, applies the script's parameters and writes it again, and
`@harmoniclabs/uplc` **2.0.6** writes an integer constant from 2^31 up to 2^53
with 32-bit operators — `10000000000` goes out as `1410065408`
(`10^10 mod 2^32`), `8640000000` as `50065408`, `4294967296` as `0`. Smaller
and larger constants are fine, which is why nothing in the Jacquard kernel had
tripped on it (its largest constant in that range is 21 days in milliseconds,
just under 2^31). The script that reaches L1 is the re-encoded one: a
different script from the one compiled, with nothing to say so. The source map
no longer matches it either, which is how it showed: failures of those two
scripts had no source location.

uplc 2.0.7 has the fix ("fix big int encodings") and the compiler package
resolves it. buildooor — through which every off-chain script handling goes —
depended on `^2.0.6` and had 2.0.6 installed. Its checkout now requires
`^2.0.7` (package.json, lockfile, installed copy), with a test that fails on
2.0.6 (`src/__tests__/uplc.integerConstants.test.ts`, 12 of its 27 cases), and
the plutus-machine checkout likewise. Both **uncommitted**. Twenty-odd other
checkouts on this machine still have 2.0.6 or older installed.

The same stale install had `@harmoniclabs/cbor` 2.0.1, which encodes an
integer above 2^64 correctly but dumps it to the console with a warning every
time (its constructor discarded the big-number form it had just derived);
2.0.2 fixed it, and buildooor now requires that too.

### Not the compiler: three things a node does that the builder did not (2026-11-18)

Found when the Jacquard node first ran against a real cardano-node (a local
devnet): every one of them is invisible to `pebble test` and to an in-memory
ledger built on buildooor, because both sides of the comparison were the
builder's own.

**Required signers are a set.** The ledger keeps a transaction's required
signers as `Set (KeyHash 'Witness)` and gives a script
`txInfoSignatories = Set.toList ...`: ascending by key hash, each once,
whatever order the body lists them in. buildooor wrote them in the caller's
order and evaluated scripts with that order. A script that looks its key up
with `includes` pays for where the key is in the list, so when the caller
listed the key first and it sorts last, the budget buildooor put in the
redeemer was a few thousand steps short of what the node needed: the
transaction was refused on chain ("overspent by 29,055 steps and 1 memory
unit"), with nothing wrong in the script. `TxBuilder` now writes them sorted
and `getTxInfos` shows them sorted whatever a body has
(`src/__tests__/TxBuilder.build.signers_and_empties.test.ts`).

**No empty fields.** `mints: []` was written as a mint of nothing (`09 00`) and
`withdrawals: []` as an empty map (`05 a0`). Conway's body has neither — each
is a non-empty map — and a node refuses the first as not well formed and reads
the second as a transaction of an earlier era. Empty mints, certificates,
withdrawals and required signers are left out of the body (same test).

**`verifyEd25519Signature` answers.** With a key of 32 bytes and a signature of
64 the builtin never fails: it is libsodium's verification, and a signature
whose first half is no point of the curve is `False`
(`PlutusCore.Crypto.Ed25519.verifyEd25519Signature_V2`). The machine's answer
comes from `@harmoniclabs/crypto`, and buildooor had 0.3.0 installed, which
throws there ("point isn't on curve"): the machine failed a script a node runs
to the end, and off-chain code that mirrors a script crashed on bytes anyone
can put on L1 (a forced transaction's signature). 0.3.2 has the node's
answers. It is not published yet: buildooor's checkout requires `^0.3.2` and
the installed copies — under buildooor and under both of this repository's
`node_modules` — are the crypto checkout's build
(`buildooor/src/__tests__/crypto.ed25519.node_semantics.test.ts`: the function
and the builtin). One more stale install, like uplc 2.0.6 above.

All **uncommitted** in the buildooor checkout when this was written.

## BUG 86 — found running the Jacquard validity verifier on a real node (2026-11-18)

### BUG 86 — CRITICAL: `bls12_381_G1/G2_compress`, `_uncompress` and `_hashToGroup` under each other's numbers — FIXED (2026-11-18)

A builtin goes on chain as a seven-bit number. Plutus declares the BLS
builtins of each group in the order add, neg, scalarMul, equal, hashToGroup,
compress, uncompress, and **encodes** them in another:

| | G1 | G2 |
| --- | --- | --- |
| `compress` | 58 | 65 |
| `uncompress` | 59 | 66 |
| `hashToGroup` | 60 | 67 |

(`encodeBuiltin` in `plutus-core/plutus-core/src/PlutusCore/Default/Builtins.hs`;
the conformance suite's two reference machines have the same table.)
`IRNativeTag` here and `UPLCBuiltinTag` in `@harmoniclabs/uplc` both had the
declaration order — hashToGroup 58, compress 59, uncompress 60, and 65, 66,
67 — and a non-negative `IRNativeTag` is handed to `Builtin` as it is
(`IRNative.toUPLC`). So a script whose source says `g1Uncompress( p )` was
written with tag 60, which a node reads as `bls12_381_G1_hashToGroup`: a
builtin of two arguments, given one. What the node then says is not about the
builtin at all:

```
Could not unlift a value: Not a constant
Caused by: bls12_381_millerLoop (bls12_381_G1_hashToGroup #a133e8…) (bls12_381_G2_hashToGroup #8bcca9…)
```

`compress` (59) ran as `uncompress` on a node, and `hashToGroup` (58) as
`compress`.

**Nothing off chain can see it.** The machine of `@harmoniclabs/plutus-machine`
dispatches on the same enum, the textual conformance suite names builtins and
never numbers them, and `pebble test`, an emulator built on buildooor and the
cost measurements all agree with each other and with the source. Every test
of every script that verifies a Groth16 proof, a KZG opening or a BLS
signature passed; the first transaction to run one on a cardano-node was
refused ("the transaction failed unexpectedly").

**Fix.** The six numbers, in both enums (`IRNativeTag.ts` here;
`UPLCBuiltinTag.ts` in the uplc checkout, 2.0.8). Nothing else depended on
them: every use is by name, and the machine looks the enum up at run time.
All 101 tags were then held against the reference machine's table; these six
were the only ones off.

**Tests.** `src/IR/IRNodes/IRNative/__tests__/IRNativeTag.flatTags.test.ts`
(the two enums agree by name on every builtin; the six numbers; the bytes the
compiler writes for `g1Uncompress` and `g2HashToGroup`), and in uplc
`src/UPLCTerms/Builtin/__tests__/UPLC.Builtin.plutusTags.test.ts` (every
builtin against Plutus' table, encoded and decoded).

**What it means for scripts compiled before.** A script that uses one of the
six and was compiled with an earlier build is another script on chain than
its source: recompile, and expect a new script hash. uplc 2.0.8 is not
published: the installed copies under this repository, buildooor and
plutus-machine are the uplc checkout's build, and their `package.json` ask for
`^2.0.8` — **uncommitted** in all four checkouts when this was written.

## BUG 87, 88 — found answering a data-availability challenge on a real node (2026-11-18)

### BUG 87 — HIGH (not the compiler: `@harmoniclabs/plutus-machine`): `divideInteger` and `modInteger` cost a constant where a node, from protocol version 11, charges a quadratic — FIXED (2026-11-18)

Until protocol version 10 the four division builtins cost a **constant** when
the first argument has fewer 64-bit words than the second
(`const_above_diagonal`: dividing a number by a larger one is trivial), and a
quadratic in the two sizes otherwise. From **version 11** Plutus V3 runs the
builtins' "variant E", whose cost model gives `divideInteger` and `modInteger`
another shape, `above_and_below_diagonal`: the quadratic of the **larger** size
and the smaller one, always, the constant unused. `quotientInteger` and
`remainderInteger` keep the constant. (V1 and V2 scripts change the same way,
"variant D".) The NUMBERS of the cost model do not say which shape applies —
the protocol parameters carry the same eight numbers for the builtin either
way — the protocol version does:

| | version 9, 10 | version 11, 12 |
| --- | --- | --- |
| `x mod m`, `x` of 1 word, `m` of 4 | 85,848 | 141,224 |
| `x mod m`, `x` of 8 words, `m` of 4 | 186,119 | 186,119 |

(`plutus-ledger-api` `MachineParameters.hs` for which variant a language runs
at which version; `plutus-core/cost-model/data/builtinCostModelC.json` and
`…E.json` for the two shapes; `CostingFun/Core.hs`,
`ModelTwoArgumentsAboveAndBelowDiagonal`, for what the new one computes.)

The machine had the old shape at every version. So a script that reduces a
small number modulo a large one — a field element that happens to be zero,
modulo the 255-bit order of BLS12-381's scalar field — was costed 55,376 steps
short for each such `mod`, and the transaction that declared the result was
refused by a node: "The machine terminated part way through evaluation due to
overspending the budget".

**How it was found.** Jacquard DA answers a challenge on a chunk of a blob by
evaluating the chunk's polynomial on L1, by Horner's rule, modulo that order:
64 times `( v * x + c ) % R`. For a chunk with data every numerator has eight
words; for a chunk that is all zeros (every fourth chunk of a small blob) each
is 0. The devnet's node took the answers for chunks with data and refused the
ones for all-zero chunks — which an honest operator could then not have
answered at all, and would have been slashed for. What the ledger itself
computes for the same signed transactions
(`cardano-cli conway transaction calculate-plutus-script-cost online`):

| answer for | the builder declared | the ledger computes |
| --- | ---: | ---: |
| a chunk with data | 2,498,962,969 | 2,498,962,969 |
| an all-zero chunk | 2,491,781,370 | 2,495,380,810 |

The difference, 3,599,440, is 65 × 55,376: the 64 steps of Horner's rule and
one more `mod` of a zero product. After the fix the builder declares
2,495,380,810.

**Why no test here could see it.** The Plutus conformance suite the machine is
held to (`plutus_conformance_2026`, 724 budgets) has the budgets of version
10's shapes, and no case in which the first argument of a division is the
smaller. The two reference machines kept beside it (`plutuz`, `uplc-turbo`,
January 2026) have the old shape too, and agreed with this machine to the unit
on the failing program. Only a ledger at version 11 says otherwise.

**Fix.** `plutus-machine`: `Quadratic2InMaxMin` (`costFunctions.ts`);
`costModelV3ToBuiltinCosts` and its V1, V2 and V4 siblings take the protocol
version (major) and give `divideInteger` and `modInteger` the new shape from
11 on; `new Machine( costs, budget, { majorProtocolVersion } )`, with
`LATEST_PROTOCOL_VERSION` (11) when it is not said. `buildooor`: the
`TxBuilder` passes the version its protocol parameters name
(`protocolVersion`), so a builder for a network still at version 10 keeps the
constant.

**Tests.** `plutus-machine/src/__tests__/divisionCosts.pv11.test.ts` (the
ledger's 141,224; both shapes at versions 9 to 12; quotient and remainder
unchanged; memory unchanged). The conformance test and the Aiken cross-check
now say which version their budgets are of (10). On a node: Jacquard DA's
`challenge` track answers an all-zero chunk
(`da-poc/live/tracks/challenge.ts`), and `da-poc/scripts/probe-answers.ts`
prints the builder's budget beside the node's verdict for any chunk.

**Not addressed.** A V1 or V2 cost model has the division parameters of its
own shape (`multiplied_sizes`); the machine costs V1/V2 division with V3's
default quadratic at every version, as before. And version 11 also bounds
integers (±2^262143) and byte strings (65,536 bytes) in the builtins that
take them, and measures a string by its bytes in `appendString`,
`equalsString` and `encodeUtf8`: the machine does neither.

**What it means for measurements made before.** Any cost measured with the
machine for a script that divides or reduces a number by a larger one was too
low for a network at version 11; everything else is unchanged. plutus-machine
3.1.0 is not published: the copies under buildooor and this repository are the
checkout's build — **uncommitted** when this was written.

### BUG 88 — LOW (not the compiler: `@harmoniclabs/uplc`, `@harmoniclabs/plutus-data`): the text of a program does not read back as the program — FIXED (2026-11-18)

Three things, found while trying to run the failing script of BUG 87 through
another machine from its printed text:

- **`showUPLC` and `prettyUPLC` gave two binders the same name.** The alphabet
  binders are named from had `J` twice, so the binders at depth 35 and at depth
  50 were both `J`; a variable under both that meant the outer one was read
  back as the inner one. Any real validator has more than fifty nested
  binders: printed and parsed again it was another program (the challenge
  script failed with an explicit error 22 million steps before its end).
  Beyond depth 2,600 the scheme ran out of letters altogether (`undefined…`).
- **Constants were not written as Plutus writes them**: the type of booleans
  as `boolean`, and a data constant without its parentheses
  (`(con data Constr 1 [])`). This package's parser reads both spellings; the
  Plutus tools and the reference machines read neither.
- **`DataMap.toString` wrote the key twice**, `(key,key)`
  (`@harmoniclabs/plutus-data`): a script context printed for a reader showed
  the lovelace of every output as a copy of the empty policy id, and a data
  constant with a map read back as another value. The test that covers it
  (`Data.toString.test.ts`, "some ctx") had been silenced with ten others by a
  `describe.only` left in the file.

**Fix.** uplc: every letter once, and a name of its own for every depth (one
letter, then two, then three); `bool`; a data constant in parentheses, bare
inside a list or a pair as the syntax has it. plutus-data: `(key,value)`, and
the `.only` removed.

**Tests.** `uplc/src/UPLCTerm/__tests__/UPLC.Term.showUPLC.roundtrip.test.ts`
(3,000 distinct names; a term of sixty and of two hundred binders reads back
to the same bytes, through `showUPLC` and through `prettyUPLC`; the constants'
spelling; a data constant with maps and lists reads back);
`plutus-data/src/__tests__/Data.toString.test.ts` (27 tests run where 16 did).
Three assertions in plutus-machine's `evalAsync.test.ts` spelled the old
`(con boolean …)` and were updated.
