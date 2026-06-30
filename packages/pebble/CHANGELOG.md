# Changelog

All notable changes to the **pebble compiler** (`@harmoniclabs/pebble`) are documented in this file.

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
