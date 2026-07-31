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

## Independent re-verification against 0.4.2 (2026-07-29)

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
| 40 | MEDIUM | No function-type syntax for a parameter annotation → higher-order functions cannot be declared | **OPEN** |

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

### Remaining, as of 2026-07-29

BUGs 27–38 are fixed or correctly scoped as deferred, and BUG 39 is fixed and
verified end to end. What is left:

1. **Generic struct declarations** — the M1.A milestone item, and still just a
   "not supported yet" diagnostic (BUG 31 removed the *crash*, not the gap).
   Worth knowing before starting: generic multi-constructor structs hit the same
   code path, so `Result<T,E>` comes free; and generic *enums* are a non-issue,
   since Pebble enums are payload-less C-style int enums with nothing to be
   generic over (`enum E<T>` does not parse, and `AstCompiler.ts:1428` hardcodes
   `isGeneric = false` for `EnumDecl`). Fold **generic type aliases** into the
   same change — separate throw site, presumably cheap once structs work.
2. **BUG 40** — no function-type syntax. Decide explicitly whether it ships with
   generic structs; without it there is still no user-written `map`.
3. **Recursive struct definitions** — `data struct L { Nil{} Cons{ h: int, t: L } }`
   fails with `'L' is not defined` / `ERROR 280 "cannot be encoded as data"`, so
   no user-defined lists or trees. Reads as part of "sum types" to a reviewer.
4. **`self` parameter inference in interface impls** — `ERROR 285` on every
   `type X implements I { m( self ) … }`, so no user interface impl compiles.
   Currently a documented `test.failing`.
5. **Constraint-based dispatch at monomorphization** (the deferred "Stage 4b") —
   `<T implements ToData>` grants nothing at instantiation.
6. Housekeeping: delete the duplicate `PBound` imports breaking two
   `packages/onchain` suites at load time (CI is red from the repo root), and fix
   the 4 broken doc examples plus the CI step that would have caught them.

Not compiler work, but the other half of M1.A and not tracked anywhere: the
Pebble repo still contains **one** `.pebble` file, a 67-line skeleton. The
acceptance criterion asks for ≥3 meaningful example contracts committed to this
repo with compile + on-chain execution evidence.
