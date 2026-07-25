# Changelog

All notable changes to the **pebble compiler** (`@harmoniclabs/pebble`) are documented in this file.

## v0.4.1

- **New `std.value.zero`** — the empty native `Value`. There is no UPLC
  constant of the builtin Value type, so it is built at runtime from an
  empty map (`unValueData( mapData( mkNilPairData( () ) ) )`) and HOISTED:
  however many times a contract mentions it the script builds it once, and
  scripts that never mention it don't contain it. Carries the full `Value`
  method table (`.lovelaces()`, `.amountOf(..)`, `.union(..)`, ...) and
  works as the identity for `+` / `union` and as a loop-accumulator seed.

- A namespace member that is a VALUE can now be dotted further —
  `std.value.zero.lovelaces()` — instead of being rejected as an
  incomplete namespace path.

- **⚠ SECURITY: a loop whose checks were its only purpose was DELETED.**
  When a loop's single reassigned variable was dead after the loop, its
  result was bound as a letted constant nothing referenced — and letteds
  only materialize at their references, so the whole loop, asserts
  included, never reached the compiled script. A validator's "for every
  owned item, require the holder's signature" loop compiled to nothing
  (masterpiece BUG 26: anyone could edit anyone's plot; the reduced repro
  compiled to a 36-byte always-accept script). Such loops now keep the SoP
  lowering, where the loop call is a `case` scrutinee and is therefore
  always evaluated. Perf-neutral; affected scripts get bigger because the
  missing checks are back. **Recompile and redeploy any contract with a
  loop whose checks are its only effect.** Covered by 13 tests in
  `compiler.masterpieceBugs.0_4_0.effectOnlyLoop.test.ts` (`for`/`while`/
  `for-of`, sequential and nested loops, per-iteration and no-over-run
  checks, a structural check, and the `find`-destructure symptom).

## v0.4.0

Planned as 0.3.7; promoted to 0.4.0 for scope: cross-contract type
access, a long list of miscompilation fixes, one breaking encoding
change, and an optimizer campaign that cut the benchmark contracts'
CPU, memory and size by 2-3x (see "Performance").

### Features

- **`export contract C { ... }` is now legal.** Exports the contract's
  TYPE-level symbols (derived from method signatures only): `import { C }`
  enables `od as C` and `od as C.State`. Non-exported contracts stay
  opaque. Covered by `compiler.contractExports.test.ts`.

- **New `redeemerof` type operator.** `redeemerof C` is the union of the
  contract's direct methods; `redeemerof C.State` is that state's
  spend-method union. Works in casts, matches, annotations, behind
  namespaces, and can be named with `type X = redeemerof C;`. Contextual
  keyword — a user type named `redeemerof` keeps working. Misuse gets
  diagnostics 30201-30206.

- **Import cycles are allowed for type/contract exchange** (the "each
  validates the other's UTxOs" pattern): files in a cycle get a
  types-only pre-pass. Importing a VALUE across an unfinished cycle is
  diagnostic 6056. Covered by `compiler.circularImports.test.ts`.

- **⚠ BREAKING: one merged redeemer union per contract's direct
  methods**, tagged in order *spend, mint, withdraw, certify, propose,
  vote*; method names must be unique across purposes (diagnostic 30200).
  Contracts with a SINGLE direct-method purpose (the common case) stay
  byte-identical to 0.3.6; contracts mixing purposes change their
  redeemer encoding and must be redeployed. Per-state redeemers
  unchanged.

- **New rule: lambdas can only capture `const` bindings** (diagnostic
  30207). Closures cannot observe later `let` reassignments on-chain, so
  such code silently misread; loop bodies are unaffected.

- Fixed `pebble run` breaking on `import { X } from "..."`.

### Fixes

Miscompilations reported from `the-cardano-masterpiece` against 0.3.6,
each covered by a `compiler.masterpieceBugs.*` regression test:

- **⚠ Redeemer field extractors could run in OTHER dispatch arms**
  (`force headList []` from a sibling method): letted placement climbed
  out of `Case` branches; it now stops at branch boundaries. Recompile
  contracts with multiple methods per purpose.

- **⚠ Extractors shared by several arms still ran in every arm** (their
  LCA sat above the dispatch): non-closed shared letteds are now
  duplicated into each referencing branch.

- **⚠ Single-use letted values could escape their dispatch arm** (BUG 23:
  editing one method miscompiled an untouched one): the one placement
  climb without the branch stop now has it.

- **⚠ Repeated same-constructor destructures corrupted earlier bindings**
  (two `const Some{ value: x } = ...` in one method remapped the first
  binding to the second): user patterns now key SSA renames by binding
  name, not struct field name. Could silently validate with the wrong
  subject — recompile.

- **⚠ PERF: `const`s referenced inside lambdas re-evaluated per call**
  (measured up to 58.8B CPU on-chain): total `const` values now float
  out of closures and evaluate once; const integer arithmetic — including
  division by a non-zero constant (BUG 24) — is comptime-evaluated for
  the totality check. Placement changes compiled bytes: recompiling with
  0.4.0 can change script hashes; data encodings are unaffected.

- **⚠ `Value ==` failed on values with negative quantities (burns)**:
  now lowered as `equalsData(valueData a, valueData b)` — exact,
  order-independent, total. `contains` keeps its per-spec semantics.

- **⚠ Bare fallback `spend` is now reachable for ill-formed datums**: the
  state dispatch guards the decode instead of crashing before the
  fallback could run.

- **IR rewrite pass could silently replace the program with a dead
  fragment** (stale queued nodes of already-replaced subtrees).

- **Custom natives could survive to the forcing pass**
  (`getNRequiredForces ... -48`): the drain loop now re-runs native
  lowering to a fixpoint.

- **Under-forced / double-forced shared builtin bindings** (three root
  causes); a structural audit test now verifies every compiled builtin
  carries exactly its required forces.

- **`lookup` on a typed `LinearMap` compared the key RAW**
  (`equalsData :: not data`): keys are now converted to data at the call
  site.

- **Prelude types usable in cast position** (`tagData as TxOutRef`
  previously "not defined").

- **Doc fix: single-state contract datum ABI** is (and always was) the
  wrapped `Constr 0 [fields]` form, not bare fields.

- **Note on the parameter ABI** (not a code change): contract `param`s
  are applied as their RUNTIME representation — native constants for
  scalars, plain data for data-encoded types. Do not wrap scalar params
  in `DataB`/`DataI` off-chain.

- Companion fixes in `@harmoniclabs/plutus-machine` (3.0.5): the CEK
  machine halts immediately on builtin errors, matching the node
  (scripts the node rejects no longer pass locally), and a `case` on an
  error value propagates the underlying message. Update the machine
  wherever tx evaluation happens off-chain.

### Performance

Optimizer campaign driven by CEK-level profiling of the
`the-cardano-masterpiece` contracts (full analysis in that repo's
`BENCHMARK_ANALYSIS.md`). Policy is
MEMORY-FIRST: machine steps carry memory cost, and real transactions hit
the memory limit before the CPU limit.

- **Decode-once field extraction**: property accesses on the same
  data-struct subject share one set of field extractors instead of
  re-decoding at every access site (scripts -15-22%, init CPU
  2.26B -> 1.39B).

- **`.length()`** is a recursive counter (~200k CPU per element) instead
  of `lengthOfArray(listToArray(xs))` (20-360M per call).

- **Letted grouping across loop continuations**: grouping no longer
  splits at delays, eliminating per-iteration re-evaluations (226 in the
  masterpiece contract, incl. duplicate sha256-of-14KB chains).

- **Expensive closed values bind per dispatch arm** instead of running at
  the script root on every execution (~350M saved per unrelated method).

- **List helper templates** (`find`, `lookup`, `some`, `every`,
  `filter`) use case binders instead of per-element
  `headList`/`tailList` (~180k per element per pass).

- **Late single-use inline pass** clears bindings minted by the UPLC
  optimization passes themselves (91 -> 14 residual).

- **Raw-data `amountOf`**: fresh-fromData subjects walk the raw
  `unMapData` pair-list instead of paying `unValueData`'s whole-map
  conversion (~7M per call). Not applied where the extra steps would
  raise memory.

- **Data round-trip elimination (IR peephole)**: always-safe
  decode-after-encode rewrites (`unX(X(v)) -> v`,
  `headList(mkCons(x, xs)) -> x`, `unConstrData(constrData(...))`).

## v0.3.6

Bug fixes (all reported against `0.3.5` from the `the-cardano-masterpiece`
project, each covered by a regression test under
`src/compiler/__tests__/compiler.masterpieceBugs.0_3_5*.test.ts`):

- **Multi-use functions are no longer inlined at every call site (script size
  multiplied).** Each call site converted its own copy of the function body to
  IR with fresh symbols; since IR hashing is symbol-identity based, the copies
  hashed differently and the hash-based sharing pass treated each as
  single-use, inlining a full copy of the body per call. The conversion is now
  memoized per function (symbol-preserving clones per site), so all call sites
  hash identically and the body is bound once. Measured on real contracts:
  17704 → 8107 and 7458 → 4292 bytes, with no source changes.

- **Qualified type names (`Ns.Type`, `Struct.Constructor`, `Contract.State`).**
  The type parser stopped at the first identifier, so `od as SC.First` parsed
  as `(od as SC).First` (ERROR 2339) and state/struct variants could not be
  named as types at all. Dotted type paths now parse (TS-style; type args bind
  to the last segment) and resolve as namespace members or as the struct/state
  union NARROWED to the named constructor — decoding checks the constructor's
  tag in the parent type, so casting the wrong variant fails at runtime
  instead of silently mis-decoding.

- **Context-destructured variables resolve inside nested struct/array
  literals.** After `const { tx, policy } = context;`, using `policy` as a
  field value of a (nested) struct literal failed with `'policy' is not
  defined` — the contract-body renamer did not recurse into container-literal
  elements/field values.

- **`let` accumulator assigned in `if` branches no longer crashes IR
  generation** (`variable 'k' is missing in […]`). When a reassigned variable
  was threaded through a previous branch's continuation under a fresh SSA
  name, the next branch's initial state still referenced the original name.

- **"only closed terms can be hoisted" crash with two-plus validators.**
  Case-arm field bindings (registered under raw method-parameter names)
  shadowed same-named parameters of hoisted helper functions across the whole
  scope chain, capturing the enclosing match's binders inside the hoisted
  body. Scope lookup is now innermost-out, and hoisted bodies convert in a
  fresh root scope. Covers both reported shapes: a struct-param function with
  a second `mint`, and a builtin-typed helper called from two state `spend`
  methods.

- **`export const` works across modules, and same-named consts in different
  modules no longer collide** (previously `not_implemented::…::const_redefinition_check`).
  Top-level constants are now keyed by a file-unique name (like functions) and
  registered in the module's exports.

- **`LinearMap<K, V>` is accepted in type positions** (struct fields, `type`
  alias targets, annotations). It was only registered under its internal tir
  key, so the source-level name never resolved outside inference. Also fixed
  two missing-`return` fall-throughs for `List`/`LinearMap` in the type
  parser's keyword path.

- **A global const defined from another const no longer crashes when used
  inside a free function** (`variable 'LINE_LENGTH' is missing`). Const-to-const
  references in top-level initializers are now resolved before hoisting.

- **Nested index expression with a loop variable no longer crashes**
  (`variable 'n' not found in the context`, e.g.
  `tx.refInputs[ idxs[n] ]` in a loop building accumulators). The sorted-array
  merge helper used by dependency tracking inserted mid-array elements at the
  front, corrupting `deps()` and leaking the loop variable into the threaded
  loop state.

## v0.3.5

- **`case`-arm field aliases no longer shadow same-named outer variables
  (silent miscompilation).** Deconstructing `is P{ field: alias } => …`
  registered the binding under the struct FIELD name instead of `alias`, so a
  parameter/variable in scope that happened to share the field's name read the
  field's value instead of its own. The rename is now keyed by the name the body actually references.

- **`pebble export --function-name <fn> --entry <file>` works without a config.**
  It previously threw `… config is missing "compilerVersion"` when no
  `pebble.config.json` was present.
  Same fix applied to `pebble compile`.

- **`std.crypto.bls12_381.multiScalarMul` (CIP-381) is now available** as a
  convenience alias for the G1 variant (`g1MultiScalarMul` / `g2MultiScalarMul`
  remain).

## v0.3.4

- **Fixed `invalid deBruijn index` crash on multi-purpose contracts.** A contract
  with a single `spend` doing indexed UTxO access (`tx.inputs[i]` / `tx.outputs[j]`)
  alongside two or more `mint` methods failed to compile. Such contracts now
  compile correctly.

## v0.3.3

- **Relational operators on `Value`.** `<`, `<=`, `>`, `>=` now work on the
  native `Value` type (previously rejected as "not assignable to int"), lowering
  to the `valueContains` builtin over the value **partial** order:
  `a <= b` → `valueContains(b,a)`, `a >= b` → `valueContains(a,b)`,
  `a < b` → `valueContains(a,b) ? false : valueContains(b,a)`, and `>` the
  mirror. Strict `<`/`>` are real partial-order comparisons (incomparable values
  are false in both directions), not `!(>=)`. (`==` `===` `!=` `!==` and `+`
  `-` / unary `-` were already supported.)

- **Loops no longer drop reassigned accumulators (silent miscompilation).** The
  variables threaded through a loop are `reassigned ∩ stmt.deps()`, filtered with
  `keepSortedStrArrInplace` — which needs both inputs sorted, but `stmt.deps()`
  was unsorted, so accumulators were spuriously dropped and frozen at their
  initial value (wrong result, no diagnostic). Sorting the deps fixes it. Covers
  both reported cases: a loop reassigning two-plus accumulators (only one
  threaded), and a loop whose single accumulator update binds the helper-call
  args to inner `let`s (accumulator frozen).

- **`boolean == boolean` now compiles.** Boolean equality lowered to the
  `_equalBoolean` native, which had no implementation ("unknown (negative)
  native … `_equalBoolean`"). Implemented as `if a then b else !b`.

- **`bool` is accepted as an alias for `boolean`.** Previously `bool` →
  `'bool' is not defined`.

- **`std.crypto.bls12_381.g1MultiScalarMul` / `g2MultiScalarMul` (CIP-381).**
  The MSM builtins are now surfaced in the stdlib (`(List<int>, List<G1|G2>)
  -> G1|G2`); `List<G1>`/`List<G2>` are now valid UPLC list element types. (The
  bundled JS test evaluator has an unrelated `instanceof` bug in its MSM point
  check, so the value is verified to compile, not evaluated in-process.)

- **Diagnostic printer no longer crashes on synthetic ranges.** `Source.lineAt`
  threw "pos out of range" for mock/internal ranges (which use `-1`), aborting
  the whole diagnostic pass and hiding every later error. Out-of-range positions
  are now clamped.

- **`pebble test` surfaces compile errors instead of reporting "0 total".** A
  test file that fails to compile produces no test descriptors, so `test()`
  returned `[]` without throwing and the CLI dropped the error. The CLI now
  prints the compile diagnostics (and exits non-zero).

## v0.3.2

Bug fixes (all reported against `0.3.x`, each now covered by a regression test
under `src/compiler/__tests__/compiler.bugReport*.test.ts`):

- **`match` statement parsing.** The subject of `match subject { … }` was parsed
  as a struct literal, swallowing the block `{`; struct-literal interpretation is
  now suppressed for the subject. Also, a `match` whose cases are all
  non-terminating now compiles (merged through a common SoP state, like `if`).

- **`case`-arm bodies allow relational operators unparenthesized.** `is A{ n } => n > 0`
  truncated at `n` because the arm body was parsed above relational precedence
  (to stop at the next `is`), which also excluded `>`, `<`, `==`, … `is` is now a
  low-precedence arm separator, so the body absorbs tighter operators. A binary
  `is` at the top of a body must still be parenthesized (`=> ( x is Foo )`).

- **`case` pattern binders are arm-scoped.** Two mutually-exclusive arms reusing
  a binder name (e.g. `is PubKey{ hash } => hash` / `is Script{ hash } => hash`)
  were rejected as "Duplicate identifier". Each arm now compiles its pattern in
  its own scope.

- **Sum-type struct as a contract-method parameter.** `spend run( a: Action )`
  crashed ("'Action' is not defined" / "pos out of range"). The synthetic
  redeemer/datum/state type is now registered in the contract's source scope, so
  its field types resolve.

- **`Optional<data>` encoding mismatch.** `context.optionalDatum` (data-encoded)
  couldn't be passed where an `Optional<data>` parameter (SoP-encoded) was
  expected. The two encodings are genuinely incompatible, so rather than allow it
  silently, a real conversion (the same one `as` performs) is now inserted at
  call-argument boundaries when only the `Optional` encoding differs.

- **Custom (negative-tag) IR natives in complex contracts.** Compilation could
  fail with "getNRequiredForces … input was: -NN". The constant-folding rewrite
  that runs after native replacement can itself introduce custom natives (e.g.
  `equalsInteger(x, 0)` → `_isZero(x)`); these are now lowered by a second
  replacement pass instead of surviving as bare `IRNative`s.

- **`bytes` ops resolve as methods.** Only `.length()`/`.slice()` worked;
  `.concat()`, `.indexAt()`, `.equals()`, the comparisons and `.toInt()` now
  resolve as methods too (type checker + lowering), in addition to their
  `std.bytes.*` namespace forms.

- **Same fold in two scopes no longer hangs the compiler.** Using one unrolled
  fold in two `test`s/functions looped forever in `_makeAllNegativeNativesHoisted`:
  a `tailList` that is the direct value of an `IRLetted` could never be wrapped
  (`IRLetted.set value` unwraps the hoisted), so it was re-wrapped indefinitely.
  Such already-letted natives are now skipped; compile time is linear in the
  number of folds again.
