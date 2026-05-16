# Switch pebble compilation target from Plutus V3 to Plutus V4

## Context

Pebble currently compiles to UPLC v1.1.0 (Plutus V3). Plutus V4 / UPLC v1.2.0
introduces three things we want:

1. **Native `Value`** (`ConstTyTag.value`, 12) and **native `Array`**
   (`ConstTyTag.array`, 13) — runtime-only built-in values with dedicated
   builtins (`insertCoin`, `lookupCoin`, `unionValue`, `valueContains`,
   `valueData`, `unValueData`, `scaleValue`, `listToArray`, `lengthOfArray`,
   `indexArray`, …). These are **never flat-encoded**; they only exist at
   runtime and are reached through builtins. The native `Value` should
   replace the AssocMap-of-AssocMap representation that pebble currently
   surfaces as `Value`. The old type is renamed to `ValueMap` and stays
   available.

2. **Case over constants.** In v4 the `Case` UPLC node accepts a constant
   scrutinee, not just `Constr`. The machine reinterprets the constant as
   an untagged constructor (`bool` → 0/1, `int N` → N, `unit` → 0,
   `pair (a, b)` → constr 0 [a, b], `list` → constr 1 [] for `[]` or
   constr 0 [head, tail] for cons). This collapses many `ifThenElse` /
   `fstPair`+`sndPair` / `nullList`+`headList`+`tailList` sequences into a
   single `Case`, saving both size and steps. **A missing trailing branch
   is semantically equivalent to an evaluation-failure branch** — we
   exploit this for size.

3. **New v4 builtins** (`expModInteger`, `dropList`,
   `listToArray`/`indexArray`/`lengthOfArray`, BLS `multiScalarMul`, the
   Value builtins above). The machine already evaluates them
   ([`BnCEK.ts`](packages/plutus/plutus-machine/src/BnCEK/BnCEK.ts#L598-L711))
   and v4 cost models are wired
   ([`Machine.ts:64-71`](packages/plutus/plutus-machine/src/Machine/Machine.ts#L64-L71)) —
   pebble just needs to expose them and bump the default version.

Decisions confirmed with the user:

- The ledger always passes `data` to scripts. Conversion to native `Value`
  happens via the `unValueData` builtin (replacing the manual
  data→AssocMap decoder previously used for the `value`/`mint` fields).
- Native `value` / `array` constants are never flat-encoded — no
  encoder/decoder changes are required.
- `defaultUplcVersion` is bumped to `1.2.0`. v3 stays explicitly
  selectable via `targetUplcVersion`.
- Lower **all** matches that can use Case-over-Const this pass (bool,
  int, pair, list), and prefer `Case`+`Constr` lowering universally.
  Omit trailing error branches.

## Scope of the migration

### A. UPLC version plumbing

- [`uplc/src/UPLCProgram/UPLCVersion.ts:24-30`](packages/plutus/uplc/src/UPLCProgram/UPLCVersion.ts#L24-L30) —
  add `isV4Friendly()` (`major === 1 ? minor >= 2 : major >= 2`). Keep
  `isV3Friendly()`.
- [`uplc/src/UPLCProgram/UPLCVersion.ts:48`](packages/plutus/uplc/src/UPLCProgram/UPLCVersion.ts#L48) —
  bump `defaultUplcVersion` to `new UPLCVersion(1, 2, 0)`.
- [`pebble/.../CompilerOptions.ts:144,156,168`](packages/plutus/pebble/packages/pebble/src/IR/toUPLC/CompilerOptions.ts#L144) —
  default option templates already reference `defaultUplcVersion`; no
  change beyond the bump above.
- [`pebble/.../compileIRToUPLC.ts:197-212`](packages/plutus/pebble/packages/pebble/src/IR/toUPLC/compileIRToUPLC.ts#L197) —
  the addMarker check should use `isV3Friendly()` (current literal
  comparison happens to work for 1.2 but is fragile).

### B. Rename `Value` → `ValueMap`

The old AssocMap-of-AssocMap stays; only its surface name changes.

- [`pebble/.../preludeTypesSrc.ts:155-167,177,269`](packages/plutus/pebble/packages/pebble/src/compiler/tir/program/stdScope/prelude/preludeTypesSrc.ts#L155) —
  rename the prelude `type Value = LinearMap<...>` alias to `ValueMap`
  and its `implements { ... }` block. **Do not** rename `TxOut.value` /
  `TxInfo.mint` field types yet — they will be retyped to the new native
  `Value` in step C.
- [`pebble/.../stdScope.ts:759-820`](packages/plutus/pebble/packages/pebble/src/compiler/tir/program/stdScope/stdScope.ts#L759) —
  rename `value_t` → `valueMap_t`, change the alias label `"Value"` →
  `"ValueMap"`, rename `valueLovelacesName` / `valueAmountOfName` to
  `valueMapLovelacesName` / `valueMapAmountOfName` and update
  [`stdScope.ts:37-38`](packages/plutus/pebble/packages/pebble/src/compiler/tir/program/stdScope/stdScope.ts#L37).
- [`pebble/.../expressifyVars.ts:44,539-546`](packages/plutus/pebble/packages/pebble/src/compiler/TirCompiler/expressify/expressifyVars.ts#L44) —
  update the import and the `valueAmountOfName` reference to the new
  `valueMapAmountOfName`.
- The IR-level natives `IRNative._amountOfValue` and
  `IRNative._sortedValueLovelaces` (and their hoisted forms in
  [`nativeToIR.ts:946-1249`](packages/plutus/pebble/packages/pebble/src/IR/toUPLC/subRoutines/replaceNatives/nativeToIR.ts#L946))
  operate on the AssocMap representation — they belong to `ValueMap`.
  No semantic change; only rename for clarity if desired (cheap, but
  optional this pass).

### C. New native `Value` type in pebble

A first-class pebble type that lowers to a UPLC term of `ConstTyTag.value`.

- Add `TirValueT` next to existing native types under
  [`pebble/.../compiler/tir/types/TirNativeType/native/`](packages/plutus/pebble/packages/pebble/src/compiler/tir/types/TirNativeType/native/).
  Pattern after the simpler natives (`TirIntT`, `TirBytesT`) — it carries
  no type parameters.
- Add a pebble keyword/identifier `Value` in stdScope
  ([`stdScope.ts`](packages/plutus/pebble/packages/pebble/src/compiler/tir/program/stdScope/stdScope.ts))
  bound to `TirValueT`, with `implements { ... }` methods routed to the
  new v4 builtins (see D). Methods to expose, mirroring the old API plus
  v4 capabilities:
  - `amountOf(policy: PolicyId, name: bytes): int` → `lookupCoin policy name self`
  - `lovelaces(): int` → `lookupCoin #"" #"" self`
  - `insert(policy: PolicyId, name: bytes, amount: int): Value` → `insertCoin`
  - `union(other: Value): Value` → `unionValue`
  - `contains(other: Value): bool` → `valueContains`
  - `scale(factor: int): Value` → `scaleValue`
  - `toData(): data` → `valueData`
- Update [`TirFromDataExpr.ts`](packages/plutus/pebble/packages/pebble/src/compiler/tir/expressions/TirFromDataExpr.ts) /
  `_fromDataUplcFunc`: when the target is `TirValueT`, emit
  `unValueData(dataExpr)` instead of the recursive AssocMap decoder.
- Update [`preludeTypesSrc.ts:177,269`](packages/plutus/pebble/packages/pebble/src/compiler/tir/program/stdScope/prelude/preludeTypesSrc.ts#L177) so
  that `TxOut.value` and `TxInfo.mint` are typed `Value` (native), not
  `ValueMap`. The data → struct lowering will then route the field
  through `unValueData` automatically via the rule above.

### D. Expose new v4 builtins in pebble stdlib

In [`populateStdNamespace.ts`](packages/plutus/pebble/packages/pebble/src/compiler/tir/program/stdScope/populateStdNamespace.ts)
and the corresponding `IRNativeTag` entries (mirroring the
`UPLCBuiltinTag` set 87–100 already in
[`UPLCBuiltinTag.ts:118-132`](packages/plutus/uplc/src/UPLCTerms/Builtin/UPLCBuiltinTag.ts#L118)):

- `expModInteger : (int, int, int) -> int`
- `dropList<T> : (int, list<T>) -> list<T>`
- `listToArray<T> : (list<T>) -> array<T>`
- `lengthOfArray<T> : (array<T>) -> int`
- `indexArray<T> : (array<T>, int) -> T`
- `bls12_381_G1_multiScalarMul`, `bls12_381_G2_multiScalarMul`
- `insertCoin, lookupCoin, unionValue, valueContains, valueData,
  unValueData, scaleValue` (most are wrapped by `Value.*` methods above
  but should also be exposed as `std.value.*` for parity with
  `std.list.*`, `std.linearMap.*`).

Add `IRNativeTag` entries + a hoisted form (where applicable) and the
`nativeToIR` lowering. For builtins that are pure 1-to-1 wrappers, the
lowering is a single-line `case IRNativeTag.X: return IRBuiltin(X)`.

Add a parallel pebble `Array<T>` type (`TirArrayT`) bound to
`ConstTyTag.array`; methods `length()`, `at(i)`, plus the conversion
`std.list.toArray` / `std.array.toList` (the latter via `case` over
list head/tail).

### E. Case-over-Constant lowering

Centralize in [`compileIRToUPLC.ts`](packages/plutus/pebble/packages/pebble/src/IR/toUPLC/compileIRToUPLC.ts)
(probably a new pre-translation pass invoked when
`options.targetUplcVersion.isV4Friendly()`). The IR already has
`IRCase` and `IRConstr`; the work is at the lowering of *boolean*,
*pair*, and *list* primitives.

1. **Bool**: `_boolFromData`, `strictIfThenElse` and any pebble-level
   `if/else` that lowers to `ifThenElse` should become
   `IRCase(scrutinee_as_con_bool, [thenBranch, elseBranch])` under v4.
   Note constants `true`/`false` already lower to `IRConst.bool(...)` so
   no extra wrap.
2. **Pair**: replace `fstPair` / `sndPair` paired uses with
   `IRCase(scrutinee_as_con_pair, [IRFunc([fst, snd], body)])`. This is
   the largest win for `unConstrData`-results and AssocMap pair access.
3. **List**: replace the `nullList` + `headList` + `tailList` pattern
   with `IRCase(scrutinee, [consBranch /* (h, t) -> ... */, nilBranch])`.
   When `nilBranch` would `error`, drop it: emit a single-branch case
   for size.
4. **Int / enum matches**: when a pebble `match` is exhaustive over a
   `int` discriminator (e.g., result of `unConstrData → fstPair`), emit
   `IRCase(con_integer_tag, [branch0, branch1, ...])` directly instead
   of building an `IRConstr` then `IRCase`-ing it.
5. **Trailing-error pruning**: any final branch that is structurally
   `IRError` (or a hoisted alias of `error`) is dropped from the
   `IRCase` branches list. Document the invariant in `IRCase`.

Boolean pattern matches today route through Scott-style booleans /
`ifThenElse` — the simplest implementation point is the lowering for
the existing `if` / `match Bool` in `expressifyVars.ts` and
`TirCaseExpr.ts`. A small visitor that runs after `expressify` and
before `compileIRToUPLC.toUPLC()` is sufficient; gate it on
`isV4Friendly()`.

For v3 targets, none of the above changes; we keep the existing
`ifThenElse`/`fstPair`/`nullList` lowerings so v1.1.0 output is
unchanged.

### F. Machine — V4 case-over-const gating

The machine already implements case-over-const unconditionally
([`Machine.ts:440-453`](packages/plutus/plutus-machine/src/Machine/Machine.ts#L440)
+ [`constantToUntaggedConstr.ts`](packages/plutus/plutus-machine/src/Machine/constantToUntaggedConstr.ts)).
For strict v3 conformance, gate the `CEKValueTag.Const` arm on the
program's UPLC version (thread the version into `Machine` /
`MachineContext` once, branch on `< 1.2.0`). This keeps existing
`case-5.uplc.expected = evaluation failure` passing at 1.1.0 while
allowing the same construct to succeed at 1.2.0 (new conformance fixtures).

Builtins 87–100 should likewise be rejected at 1.1.0. Add a single
`isV4Builtin(tag)` check in `eval`'s dispatch
([`BnCEK.ts:598-711`](packages/plutus/plutus-machine/src/BnCEK/BnCEK.ts#L598))
that errors when the program's version is `< 1.2.0`.

### G. Tests

- **uplc**: parser tests already accept `(con value ...)` and
  `(con array T ...)` via
  [`parseUPLCText.ts:444-679`](packages/plutus/uplc/src/UPLCTerm/parseUPLCText.ts#L444). Add
  round-trip tests for pretty-printer where applicable.
- **plutus-machine**: add `term/case/v4/` fixtures matching the
  existing case-1..9 set but at `1.2.0`, with `con bool`, `con integer`,
  `con (pair int int) (...)`, and `con (list integer) (...)`
  scrutinees. Keep the existing `1.1.0` fixtures (case-5 still
  `evaluation failure`) — the version gate from F makes both work.
- **pebble**: golden tests for the new lowering (snapshot the UPLC
  text). At minimum:
  - `if b { x } else { y }` → `(case b [x, y])`
  - destructure a pair returned by `unConstrData`
  - `Value.lovelaces()` on `TxOut.value`
  - `Value.amountOf(p, n)` on a minted-value snapshot
  - dropping a trailing-error branch (`std.list.head` on what should be
    non-empty)
- End-to-end: compile one of the example contracts under
  [`pebble/example-pebble-init`](packages/plutus/example-pebble-init/)
  twice (v3 / v4), run both against `plutus-machine`, assert identical
  results and check the v4 program is smaller / cheaper.

## Verification

```
# uplc + machine
cd packages/plutus/uplc           && npx jest
cd packages/plutus/plutus-machine && npx jest

# pebble compiler
cd packages/plutus/pebble/packages/pebble && npx jest

# end-to-end: compile a sample contract at both versions and compare
cd packages/plutus/example-pebble-init
# (use the pebble CLI's targetUplcVersion option to compile twice)
```

Manual sanity checks:

- `defaultUplcVersion.toString() === "1.2.0"`
- A program using `Value.amountOf` compiles without referencing the old
  `_amountOfValue` IR native (now only used by `ValueMap`).
- `case-5` at `1.1.0` still fails; the new `case-5-v4` at `1.2.0`
  returns the expected constant.

## Critical files (touch list)

- [`uplc/src/UPLCProgram/UPLCVersion.ts`](packages/plutus/uplc/src/UPLCProgram/UPLCVersion.ts) — `isV4Friendly`, default bump
- [`pebble/.../CompilerOptions.ts`](packages/plutus/pebble/packages/pebble/src/IR/toUPLC/CompilerOptions.ts) — picks up the new default
- [`pebble/.../compileIRToUPLC.ts`](packages/plutus/pebble/packages/pebble/src/IR/toUPLC/compileIRToUPLC.ts) — marker, pass invocation for Case-on-Const
- [`pebble/.../stdScope/prelude/preludeTypesSrc.ts`](packages/plutus/pebble/packages/pebble/src/compiler/tir/program/stdScope/prelude/preludeTypesSrc.ts) — `Value` → `ValueMap`, retype `TxOut.value` / `TxInfo.mint`
- [`pebble/.../stdScope/stdScope.ts`](packages/plutus/pebble/packages/pebble/src/compiler/tir/program/stdScope/stdScope.ts) — rename old API, introduce native `Value`, expose new builtin methods
- [`pebble/.../stdScope/populateStdNamespace.ts`](packages/plutus/pebble/packages/pebble/src/compiler/tir/program/stdScope/populateStdNamespace.ts) — add `std.value.*`, `std.array.*` and the new builtins
- [`pebble/.../compiler/tir/types/TirNativeType/native/`](packages/plutus/pebble/packages/pebble/src/compiler/tir/types/TirNativeType/native/) — new `TirValueT`, `TirArrayT`
- [`pebble/.../IR/IRNodes/IRNative/IRNativeTag.ts`](packages/plutus/pebble/packages/pebble/src/IR/IRNodes/IRNative/IRNativeTag.ts) + [`index.ts`](packages/plutus/pebble/packages/pebble/src/IR/IRNodes/IRNative/index.ts) — new tags, statics
- [`pebble/.../IR/toUPLC/subRoutines/replaceNatives/nativeToIR.ts`](packages/plutus/pebble/packages/pebble/src/IR/toUPLC/subRoutines/replaceNatives/nativeToIR.ts) — lowerings
- [`pebble/.../compiler/tir/expressions/TirFromDataExpr.ts`](packages/plutus/pebble/packages/pebble/src/compiler/tir/expressions/TirFromDataExpr.ts) — `TirValueT` → `unValueData`, `TirArrayT` → `listToArray ∘ unListData`
- [`pebble/.../compiler/TirCompiler/expressify/expressifyVars.ts`](packages/plutus/pebble/packages/pebble/src/compiler/TirCompiler/expressify/expressifyVars.ts) — rename `valueAmountOfName` references
- [`plutus-machine/src/Machine/Machine.ts`](packages/plutus/plutus-machine/src/Machine/Machine.ts) and [`BnCEK/BnCEK.ts`](packages/plutus/plutus-machine/src/BnCEK/BnCEK.ts) — version-gate case-on-const + v4 builtins
- New: `plutus-machine/src/__tests__/plutus_conformance/term/case/v4/` fixtures
