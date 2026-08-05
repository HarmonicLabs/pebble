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
