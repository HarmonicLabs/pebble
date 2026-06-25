# Changelog

All notable changes to the **pebble compiler** (`@harmoniclabs/pebble`) are documented in this file.

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
