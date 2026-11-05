# Changelog

All notable changes to the **pebble compiler** (`@harmoniclabs/pebble`) are documented in this file.

## v0.6.0

Milestone 3: the REPL and sourcemaps. `pebble repl` works with the files of the
project it starts in, and a failing script now says where it failed in the Pebble
source, in `pebble test`, in buildooor and in any tool using
`@harmoniclabs/plutus-machine` 3.1.0.

### REPL

- `pebble repl` (pebble-cli) reads the project of the working directory: the nearest
  `pebble.config.json` (or `--config`) gives the options, and imports resolve from the
  working directory. It writes nothing.

  ```text
  pebble> import { factorial } from "./src/factorial.pebble";
  pebble> factorial(5)
  120
  cpu: 2766005 | mem: 11221
  ```

- Each line runs as one program: the declarations entered so far, then the line.
  `const`, `let`, `function`, `struct`, `import` and `contract` are kept for the lines
  after; redeclaring a name replaces it (a `let` is shadowed, so its type may change).
  Functions and contracts can use the session's constants. A statement that changes a
  `let` (`total += x`, a loop) is kept, so later lines see the change. A line that
  fails changes nothing.
- Values show with their Pebble type: `P{ x: 1, y: 2 }`, `[1, 2, 3]`, `#abcd`.
  Declarations show nothing, but are computed on their line, so `const z = 1 / 0;`
  fails there.
- Errors point at what was typed: every diagnostic of the line, with the line underlined;
  a failing `assert` or builtin shows where it failed (also inside a function entered
  earlier, or in an imported file) and the open calls.
- `test name() { ... }` runs at once and reports PASS or FAIL with the location. A
  contract is type-checked; its methods need a script context, and naming the contract in
  an expression explains that they run under `pebble test`.
- A line can spend the mainnet per-transaction limit, 10,000,000,000 cpu and 16,500,000
  mem: an endless loop stops with "out of budget" instead of hanging the REPL.
- Commands `:help`, `:list` (the declarations kept), `:reset` and `:quit`. Ctrl+C
  drops the input being typed; twice on an empty line (or Ctrl+D) exits. History is kept
  in `~/.pebble_repl_history` (`PEBBLE_REPL_HISTORY` moves it; empty turns it off).
- Piped input runs every line in order (it used to stop after the first): the output
  reads as a session, and the exit code is 1 if a line failed.
- `ReplSession` is the REPL without a terminal, for other tools: `eval( line )` returns
  the value, the diagnostics and failure with positions in the line, the logs, the
  budget and the tests' results.

### Sourcemaps

- `pebble compile` and `pebble export` write a source map next to the script,
  `out/out.flat.map` (and `<output>.map` with `-o`). The script itself does not
  change: maps on or off, the bytes are identical (checked on every example, the
  four masterpiece contracts and the UPLC-CAPE exports).
- `pebble test` prints the location of a failure and the open calls:

  ```text
    FAIL  small_input  [cpu: 1190152, mem: 6404]
          error: explicit error from uplc
          at check (src/index.pebble:6:5)
          at entry (src/index.pebble:11:15)
          at test small_input (src/index.test.pebble:4:26)
  ```

  `--json` gains `location` and `stack` next to `error`; `TestIterationResult.error`
  gains `location` and `stack`.
- Locations are right where optimizations would mislead a simpler resolver: two
  asserts merged into one `error` report the one whose condition was false; an
  `if( x ) fail;` whose `error` branch is pruned reports the `if`; a helper the
  optimizer copied into its caller still gets its own frame, pointing at the call.
- Options: `sourceMap` (default `true`) and `sourceMapContent` (include the source
  texts, for tools that print the failing line). `Compiler.compileWithSourceMap()`
  and `Compiler.exportWithSourceMap()` return the program and its map without
  writing files.
- The map format belongs to `@harmoniclabs/plutus-machine` (version 1, see its
  README); buildooor 0.3.0 reads it (`sourceMaps` option).

### `removeTraces` works, and the source map keeps the traces

- ⚠ Output change: `removeTraces` was never read, so every build kept its traces. It now
  removes `trace` statements and the messages of `assert` and `fail`, and it is `true` in
  the production options. A contract with traces compiled with it gets smaller and cheaper,
  and gets a new hash: the UPLC-CAPE `two_party_escrow` (11 assert messages) goes from 1354 to
  853 bytes. Set `removeTraces: false` to keep them in the script (the examples do).
- The traces are removed before anything is optimized: the program is byte for byte the one
  the source without them compiles to, so a value computed only for a trace is not computed,
  and the optimizer is free to drop a branch that only failed with a message.
- The source map keeps them (`traces`, `tracePoints`; see the plutus-machine README): where each
  would have run, its message, or, for a message computed from values, its source text and a
  small program computing it. `pebble test`, `pebble debug`, the VS Code debugger, buildooor
  (failing scripts) and `evaluateWithSourceMap` print them back where they would have run, in
  order with the traces the program kept; a computed message is computed on the side, from the
  values the program holds there (`trace acc;` after a loop prints `acc` once the loop has
  computed it), and says so when one is missing.
- `pebble compile` and `pebble export` say how many traces they removed, and name those the
  optimizer left no place for (a helper reduced to a builtin has no call left to trace).

### Debugger

- `pebble debug` (pebble-cli) records one evaluation, a test (`--test <name>`) or a
  script evaluation buildooor saved (`--eval <file>`, see buildooor's
  `saveFailedEvaluations`), and prints it statement by statement, each call under the
  statement that makes it, with the values the statements declare; the failing statement
  lists every variable in scope:

  ```text
  spend #0 470f22571c405a0a30678ebb863279b31ffd2845dd0b9e17dd9688c2: 5 steps, failed at step 5

  accept  src/index.pebble
    #1   42  const { tx, spendingRef, state: { deadline } } = context;  deadline = 1000000000
    #2   44  const sellerPkh = this.seller                     sellerPkh = #008b47844d92812f…
    #3   45  assert tx.requiredSigners.includes( sellerPkh );
    #4   49  const Finite{ n: txLatest } = tx.validityInterval.to.boundary  txLatest = 1000001000
    #5   50  assert txLatest <= deadline;                      <- failed
               buyer = #0d6a577e9441ad8e…
               seller = #008b47844d92812f…
               price = 10000000
               tx = Tx{ inputs: [TxIn{ … }, TxIn{ … }], refInputs: [], outputs: [TxOut{ … }, TxOut{ … }], fee: 216849, … 12 more }
               spendingRef = <not evaluated>
               deadline = 1000000000
               sellerPkh = #008b47844d92812f…
               txLatest = 1000001000
  failed: explicit error from uplc (cpu 10514744, mem 39056)
  ```

  `--step N` prints one step in full (the open calls, every variable with its whole value),
  `--json` the run as JSON for tools and AI agents, `--all` the variables at every step. It
  exits 0 whenever the evaluation could be shown, passed or failed.
- The steps follow the source, not the machine: the compiled program computes a `const` where
  it is used, merges asserts, hoists what does not depend on the call. Evaluation is pure, so
  each call lists the statements whose terms ran, sorted as written; a call the optimizer
  computed ahead of its caller still shows under the statement that makes it; a loop runs one
  frame per iteration (condition, body, update); a failing run ends at the statement that
  failed.
- Variables carry their source names and types, and the value they have at that statement
  (after reassignments, in that iteration), decoded with the type (`TxOutRef{ id: #…, index: 0 }`,
  `Some{ value: 7 }`, `true` for a boolean read from data); `<not evaluated>` when the run never
  needed the value, `<optimized out>` when the compiler removed the variable. A contract
  method's `const { tx } = context;` shows `tx`.
- The debug information stays in memory: `out.flat.map` does not change, and neither does
  the program. `Compiler.compileWithDebugInfo()` returns it with the program and its map;
  `Compiler.debugTest()` and `Compiler.debugScript()` return a `DebugRun` (steps, frames,
  `variablesAt`, `declaredAt`, `stackAt`, `next` / `prev`); `formatDebugRun`,
  `formatDebugStep`, `debugRunToJson`, `decodeValue` and `formatValue` format it.
- The VS Code extension (pebble-lsp) uses the same runs: a debugger that steps forwards and
  backwards.

### Diagnostics

- New warning 6133: a `const` whose value could fail and that is never used. A value that is
  not used is never computed, so `const ok = checkSigned( tx, owner );` checks nothing: the
  asserts in `checkSigned` never run. The warning covers a `fail`, a division, and calls to
  the functions and `type` methods of the program's own code that assert, fail or divide,
  themselves or through the functions they call.
- Warnings no longer stop a compilation. `pebble compile` failed on any diagnostic, so a
  program with only a warning (an `is` that is always true, a `!` on a value that is not
  optional) did not compile. Warnings are printed and the script is written.
- `pebble compile` and `pebble export` printed each error twice, then crashed with an uncaught
  exception and its stack trace. They print each error once, then `compilation failed: N
  errors`, and exit with code 1.
- A call written as a statement (`check( tx );`, `xs.length();`) gets error 1395, which says
  why it is not allowed: its value would never be computed. It used to get "'=' expected." and
  then "Statement expected.". An assignment to a field or an element (`p.x = 5;`, `xs[0] = 1;`,
  `p.x++;`) gets error 2364: only variables can be assigned.
- `++` or `--` inside an expression (`return x++;`) crashed the parser with a JavaScript
  error. It now gets "Assignments are statements, not expressions.".
- `for( const x: int of xs )` gets "The left-hand side of a 'for...of' statement cannot use a
  type annotation." at the type. It used to get the initializer error, at the end of the loop
  header.
- A block still open at the end of the file gets "'}' expected.", not "Statement expected.".
- A statement that already has its own error no longer gets "Statement expected." as well,
  and a declaration whose initializer has an error no longer gets "Variable declaration must
  have an initializer".
- Six error codes each belonged to two messages, and only the first message of each pair was
  shown (254, 282, 283, 293, 1365, 1385). The second message of each pair has its own code now
  (297 to 300, 1393, 1394), and generating the messages fails on a duplicate code.

### Fixes

- ⚠ Output change: consecutive asserts were merged into one condition that computed every
  condition, the last one first. With `assert x > 10 else "a"; assert x > 20 else "b";`,
  `f( 5 )` printed "b"; with three such asserts it printed all three messages, out of order;
  and every run paid for every condition. Each assert is now checked in turn, in source order,
  and fails on its own: only the first false one's message prints, and the conditions after it
  are not computed. Scripts with consecutive asserts change, most of them get smaller and
  cheaper (bytes: escrow 814 → 794, vesting 907 → 862, stewardship 5523 → 5313, masterpiece
  4410 → 4313; the marketplace grows, 3029 → 3099; the escrow's tests cost about a third less).
- A condition comparing with a constant is rebuilt by the optimizer (to share
  `lessThanInteger 10`), and the rebuilt condition lost its source information: its range,
  the assert it checks, the removed traces it prints. It keeps them now. When the comparison is
  turned around (`x < 20` checked as `20 <= x`, the branches swapped), the source map marks the
  assert's condition negated: plutus-machine's `asserts` entries take an optional `negated`,
  and trace points a `when` `4`.
- A value read by an assert's condition and after the assert was copied into each use, as for
  separate dispatch arms, so the path that validates could decode a field twice. A `case`
  branch whose other branches all fail (an assert, `if( c ) fail;`, a `match` whose other arms
  fail) is the only way on: a value computed before it is shared. It changes nothing on a run
  that does not fail; on a run where the value fails as well as the assert, the failure is the
  value's.
- A builtin used once inside a function was bound outside it, by the rule that computes a value
  once instead of on every call of a lambda: a binding and an application more, for a value
  that costs nothing to compute.
- ⚠ Security: a loop that reassigns one variable could be left out of the compiled script,
  along with every `assert` in it. This happened when the loop's result was overwritten
  before being read (`rest = xs;` after the loop), was read only by a `const` that is never
  used, or was read only in a branch (then the loop ran only when the branch was taken). The
  0.4.0 fix for masterpiece BUG 26 covered only a result that is never read. Now the loop is
  kept unless the statements after it certainly compute its result, or the loop cannot fail
  and certainly ends (a `for...of`, or a `for` counting to a bound its body does not change).
  No example's script changes.
- The pass removing unused variables lost arguments when a function did not get exactly one
  argument per parameter. A function returning a function (`[[(λa. λb. …) A] B]`, as letted
  and hoisted values are bound) lost `B` when `a` was unused, so the program was left a
  lambda where a value was expected. A function applied to its first arguments only lost the
  parameters still waiting for theirs. It showed in the message of a removed trace, compiled
  on its own (`trace decoded;` in a function without parameters failed with "cannot force
  Lambda"). The arguments of an application wrapping a `case` that applies a function were
  also read in the wrong order. No example's script changes.
- `fail "message";` never printed its message: it compiled to `trace( message, error )`, whose
  `error` argument fails before `trace` runs. The failure now waits for the message.
- A variable declared in a block that shadowed one of its function kept the outer value:
  `let x = 1; { let x = 5; return x; }` returned 1 (with another type, the outer value of
  the wrong type). Blocks are compiled inline, where both had the same name; a shadowing
  declaration now gets its own.
- `for( const x of [ 1, 2, 3 ] )` typed `x` as `T`: the list literal took the loop's
  `List<T>` hint as its type (`total += x` did not type-check, and a list of bytes literals
  failed in the backend).
- A source made of declarations alone failed with "ERROR 101: Contract is missing" in
  `Compiler.runRepl`, after printing every function the compiler knew; an assignment as
  its last statement became `return x = 5;` ("ERROR 2810"). The function list was printed
  by every compilation that reached that error.
- A second compilation in the same process (the language server, `pebble test` over several
  files, any tool) got a source map listing the first one's source again, with terms mapped to
  it: `_compTimeDropN` handed out its shared `drop` templates uncloned, and the first
  compilation's passes rewrote them in place (their hoisted `tailList` became that
  compilation's letted one, with its range).
- An assert whose comparison the optimizer flipped to drop its `error` branch (`y < 20`
  checked as `20 <= y`) was located at the term that failed: with `const y = x * 2;`, the `2`.
  A `case` that lost failing branches now records the failure they stood for (the source map's
  new optional `failures`), and a false assert condition is the failure whatever term fails;
  twin asserts report the assert statement (`24:5`), not its operand (`24:12`).
- `fail "message";` was a type error ("Type 'bytes' is not assignable to type
  'string'"): `fail` did not cast the string literal as `assert ... else` does.
- Statement ranges, used by diagnostics: declarations started at the end of the
  previous statement (on the line before); an `assert` covered only its `;`
  (or only the keyword, with `else`); `fail` and `trace` only their last token;
  `match` started after its keyword.
- `pebble export -o` and `pebble compile -o` copied `out.flat` before it was written
  (a 0-byte file): the compiler awaited none of its writes.
- `completeCompilerOptions` replaced the caller's `targetUplcVersion` with the
  default.
- A REPL line no longer writes `out/out.flat`.
- `pebble test` without `compilerVersion` in the config uses the running compiler,
  as `pebble compile` does.

## v0.5.0

Milestone 2 release: the built-in test framework is complete, and the
standard library grows the "common dApp patterns" layer.

### ⚠ BREAKING: shortcut structs are list-encoded

The FORM of a single-constructor struct declaration now picks its data
encoding:

```ts
struct ListEncoded { a: int }                                 // List [ I a ]
struct SingleConstrEncoded { SingleConstrEncoded { a: int } } // Constr 0 [ I a ]
```

- **The shortcut form is encoded as `listData( fields )`.** Up to 0.4.x it
  was `constrData( 0, fields )`. The list is one constructor tag smaller
  and cheaper to decode, and it is the encoding Plutus V4 uses for the
  product types of the ledger API (plutus-ledger-api >= 1.69).
- **The explicit single-constructor form is always `constrData( 0, fields )`**
  — use it where the value must match a `Constr 0` that something else
  produces or expects.
- Multi-constructor structs are unchanged.
- **A `contract`'s datum and redeemer are NOT affected**: the types derived
  from its `state`s and methods stay constructor-encoded, so a contract's
  on-chain interface only changes through the user-declared structs it
  uses as field types.
- **Migration.** Recompiling a contract that declares shortcut structs
  changes its script bytes (hence its address) and the encoding of those
  values. Set `"encodingStrategy": "legacy"` in `pebble.config.json` to
  keep the 0.4.x encoding — verified on the four mainnet
  `the-cardano-masterpiece` validators, which recompile byte-identically
  under `"legacy"` — or rewrite the affected structs in the explicit form.
- `encodingStrategy` is now `"minimal" | "legacy"`, default `"minimal"`
  (was `"default" | "minimal"`, default `"default"`). `"default"` is still
  accepted as the old spelling of `"legacy"`.
- **The list encoding now works on every lowering path.** It existed since
  0.4.x behind the `untagged` keyword, but only parameter field access,
  `case` and `is` honoured it; a list-encoded struct bound to a `const`,
  cast from `data`, destructured, used as a loop variable, nested in
  another struct, or instantiated from a generic was still decoded with
  `unConstrData` and failed at runtime
  (`unConstrData :: not a data constructor`). All of these are fixed and
  covered by `compiler.structEncodingForms.test.ts`, which asserts
  evaluated results.
- List-encoded structs get the same decode-once field extraction as
  constructor-encoded ones.
- A cast between two data structs of the same shape but different
  encoding is now a compile error (it was the identity at runtime, so it
  only moved the failure to the first field access).
- `untagged` is accepted on structs declared inside a `namespace`.
- Runtime (SoP) structs carry the encoding of their declaration for the
  conversions to and from `data`.

### Test framework (`pebble test`)

- **Typed default fuzzers for every practical parameter type.** Property
  tests now fuzz `bytes`, `string`, `data`, enums, `Optional<T>` (both
  encodings — SoP optionals and runtime structs are passed as UPLC 1.2
  `constr` terms), `List<T>`, `LinearMap<K,V>`, `Value`, data structs
  (driven off the struct's constructors and field types, recursion-safe)
  and runtime (SoP) structs, in addition to the existing `int`/`bool`.
  Generators are seeded, deterministic, and edge-biased (zero/±1/int
  bounds, empty/hash-length byte strings, empty/singleton collections).
- **`via <expr>` fuzzers are now executable.** The compiler synthesizes a
  `( seed: int ) => T` entry point from the `via` expression — either a
  function of that shape or a plain `T` value (a degenerate constant
  fuzzer, e.g. `via 42`) — and the runner CEK-evaluates it with a fresh
  seed each iteration. Fuzzed values must be constant-representable
  (SoP-typed fuzzer results are rejected with a located reason).
- **Shrinking.** When a property test fails, the runner greedily minimizes
  the failing input tuple (integers log-converge toward the smallest
  counterexample; byte strings, strings, lists and maps shrink
  structurally) and reports the minimal inputs alongside the original
  failure. Shrink evaluations do not count toward the reported budget.
- **CLI**: `pebble test --json` emits machine-readable results (budgets
  included); `--bail` stops at the first failing file; failing property
  reports show the minimal counterexample.

### Standard library

- **Value arithmetic**: `negate`, `equals`, `subtract`, `isZero`, `geq`,
  `leq` as `Value` methods and under `std.value`, plus the
  `std.value.singleton( policy, name, amount )` and
  `std.value.assetClass( policy, name )` constructors,
  `Value.amountOfAsset( ac )`, the `AssetClass` prelude struct and the
  `POSIXTime` alias.
- **Script-context helpers** (methods on the prelude types, mirrored under
  `std.tx` / `std.interval`): `Tx.signedBy( pkh )`,
  `Tx.findInput( ref )`, `Tx.outputsToCredential( c )`,
  `Tx.inputsFromCredential( c )`, `Tx.valuePaidTo( addr )`,
  `TxOut.inlineDatum()`, `Interval.lowerBoundFinite()`,
  `Interval.upperBoundFinite()`, `Interval.contains( t )`,
  `Interval.isEntirelyAfter( t )`, `Interval.isEntirelyBefore( t )`.
  The interval helpers read `isInclusive` with the LEDGER bool encoding
  (PlutusTx: `False = Constr 0`, `True = Constr 1`).
- **Lists**: `std.list.at` (returns `Optional<T>`), `concat`, `reverse`,
  `sum`, `count`.
- **LinearMap**: `std.linearMap.has`, `insert` (replace-or-prepend),
  `remove`.
- Fix: single-constructor prelude structs now carry their method table on
  the type itself (`methodNamesPtr`), enabling methods on `Tx`, `TxOut`
  and `Interval`.

### `targetPlutusVersion` compiler option

- New `pebble.config.json` / `CompilerOptions` field
  `targetPlutusVersion: "v3" | "experimental-v4"` (default `"v3"`,
  case-insensitive). The context type NAMES are always the same —
  `ScriptContext`, `Tx`, `TxIn`, `TxOut`, `Address`, `ScriptInfo`,
  `ScriptPurpose` — and this option decides **which ledger-API family
  defines them**. There are no suffixed variants and no mixing: exactly
  one family exists per compilation, so flipping the target re-types the
  same source against the other context shape.
- The plain `"v4"` spelling is **reserved until Plutus V4 is active on
  mainnet** (the Dijkstra hard fork) and rejected with guidance; the
  `experimental-` prefix makes the pre-release nature of the Dijkstra
  shapes explicit while CIP-0118 is still Proposed. When the fork lands,
  `"v4"` becomes the name and `"experimental-v4"` will keep working as
  an alias.
- **`contract` declarations compile under `"experimental-v4"`**: the
  purpose dispatch derives against whichever context family the target
  selects (the V4 `Withdraw` arm keeps the `credential` field name — an
  `AccountId` is a credential — so every pre-existing purpose keeps
  working), and `context.tx` is the V4 `Tx`.
- **New `guard` contract method keyword** for the Plutus V4 guarding
  purpose (CIP-0112 / CIP-0118):

  ```ts
  contract Batch {
      guard check() {
          const { guardIndex, topTxInfo } = context;
          match topTxInfo {
              when Some{ value: top }: { /* top-level: whole batch visible */ }
              when None{}: { /* executing inside a sub-transaction */ }
          }
      }
  }
  ```

  `context.guardIndex` and `context.topTxInfo` (`Optional<TopTxInfo>`)
  are available in guard methods. Guard methods are appended LAST in the
  merged direct-redeemer union, so adding a guard to an existing contract
  never changes the tags of its other methods. `guard` requires
  `targetPlutusVersion` `"experimental-v4"` (or newer): under `"v3"` it
  is rejected with a located diagnostic naming the option; inside a
  `state` it is a parse error (states only have spend methods).
- **New `top` / `nested` execution-level keywords for contract methods**
  (Plutus V4 nested transactions, CIP-0118): `top <purpose>` declares a
  method valid only in the top-level transaction, `nested <purpose>` one
  valid only inside a sub-transaction — `nested spend`, `top guard`,
  `nested mint`, ... A purpose keyword without a level keyword defaults
  to `top`. The derived contract body matches `tx.subTxIx` **before**
  the purpose (`None` → top-level methods, `Some` → nested methods), and
  a level with no methods is unconditionally `fail` — so **a contract
  written without any level keyword always fails when executed inside a
  sub-transaction**. Levels apply to state spend methods too, and the
  merged redeemer union / tag order is level-independent (a contract
  compiled under `"v3"` with `top` keywords is byte-identical to one
  without). Under `"v3"` `nested` is rejected with a located diagnostic
  naming the option; `top`/`nested` remain usable as identifiers (a state
  field named `top` still parses).

### Plutus V4 (Dijkstra) prelude types

- The full V4 script-context type family, mirroring
  **plutus-ledger-api 1.71.0.0** (1.68 introduced `PlutusLedgerApi.V4`
  and `dijkstraPV = 12`; 1.69 changed the encoding of its product types,
  see below; 1.71 renamed a field of `TopTxInfoSimplified`), under the SAME names as
  the V3 family: `ScriptContext` (4 fields, incl. the executing
  script's own hash), `Tx` (19 fields — no fee, no requiredSigners;
  adds `subTxIx`, `directDeposits`, `accountBalanceIntervals`,
  `guards`, `requiredTopLevelGuards`), `TxOut`/`TxIn`/`Address`,
  `POSIXTimeRange` (plain optional bounds), `AccountId`,
  `AccountBalanceInterval(s)`, the account-based `TxCert`,
  `ScriptPurpose` (script hash in every constructor, new `Guarding`),
  `ScriptInfo` (incl. `Guard` with the CIP-0118 `TopTxInfo` whole-batch
  view) and `TopTxInfo(Simplified)`.
- **V4 product types are list-encoded.** plutus-ledger-api 1.69 encodes
  every single-constructor type of the V4 ledger API as a plain `List` of
  fields instead of `Constr 0 fields`: `ScriptContext`, `Tx`, `TxIn`,
  `TxOut`, `Address`, `POSIXTimeRange`, `TopTxInfo`,
  `TopTxInfoSimplified`, and the products V4 shares with V3 by name —
  `TxOutRef` (also as governance action id), `Rational`,
  `ProtocolVersion`, `ConstitutionInfo`, `ProposalProcedure`,
  `AssetClass`. The shared ones are list-encoded under
  `"experimental-v4"` and stay `Constr 0` under `"v3"`;
  `std.value.assetClass` and `Value.amountOfAsset` follow the target.
  Sum types keep their constructor indices.
- **`TopTxInfoSimplified.redeemerHashes: List<ScriptHash>`** replaces
  `scriptPurposes: List<ScriptPurpose>` (plutus-ledger-api 1.71: the
  aggregated batch view keeps only the script hashes of the redeemers).
- **Validated against the ACTUAL library encodings, not the source
  reading**: `compiler.v4Prelude.test.ts` decodes golden fixtures
  generated by running plutus-ledger-api 1.71's own `toData` on sample
  values of every V4 type (55 fixtures, every constructor covered) back
  through the pebble types on the CEK machine. The generator is vendored
  at `scripts/v4-fixtures`.
- The Dijkstra hard fork has not happened and CIP-0118 is still
  Proposed, so these types may track upstream changes until the fork;
  they exist only under `targetPlutusVersion: "experimental-v4"` and the
  default V3 prelude is untouched.

### Fixed

- **⚠ `match` with an `else` arm on a data struct with 3+ constructors
  sent EVERY value to the `else` branch.** The case lowering placed one
  shared wildcard-body IR node into every unmatched branch slot; IR
  nodes are single-parent, mutated-in-place trees, so the sharing
  corrupted the dispatch and the whole `match` collapsed into the
  wildcard body at compile time (2-constructor structs used the
  wildcard once and were unaffected — which is why the escrow examples
  never hit it). Every wildcard placement now clones
  (`TirCaseExpr.ts`). Exhaustive matches were always correct, and the
  deployed mainnet contracts recompile byte-identically.
- Destructuring through an ALIAS of a data struct
  (`const PubKey{ hash } = accountId;` where `AccountId` aliases
  `Credential`) failed with "deconstruction of non-struct type"; the
  deconstruct paths now unalias first.

### UPLC-CAPE

- New `examples/uplc-cape` project with the open-optimization `fibonacci`
  and `factorial` submissions and the `two_party_escrow` real-world
  contract submission (see `BENCHMARKS.md`).

## v0.4.5

A single fix, but a consequential one: it removes the last known
compute-once hole, and takes compiled size and compile time down with it.

- **⚠ PERFORMANCE (compute-once, across `&&` — second path): a `const`
  whose references all sit INSIDE branches is no longer duplicated per
  branch.** v0.4.4's `&&` fix (below) covers values whose references surface
  in WAVES, which take the single-reference placement path. When every
  reference is already in the tree at once, placement instead takes the
  per-branch DUPLICATION block — and that had no `eagerFnScope` exemption,
  so a `&&` cascade (which lowers to SEQUENTIAL sibling cases, one "branch
  group" per conjunct) gave the value one binding PER CONJUNCT, all of them
  evaluated on the accept path. Whether a validator hit this came down to
  how its references happened to surface rather than to anything in its
  source, which is why two structurally equivalent GravityDex swap handlers
  sat at 0.93x and 7.2x of the reference implementation. A fn-scope-eager
  declaration evaluates once per call regardless of in-function dispatch,
  so it now skips that block entirely. On the affected validator the
  heaviest evaluation went **10.955B -> 0.891B cpu (12x)** and its artifact
  **11.9 kB -> 5.8 kB**. Guarded by a second case in
  `compiler.computeOnceAcrossBranches.test.ts`, which keeps every reference
  out of the first conjunct — that is what arms the duplication block.
- **Compile time drops with it.** The duplication was also inflating the IR
  tree, so removing it cut whole-project build time by an order of
  magnitude. The single validator that had resisted every earlier
  compile-time fix (65.9 min, previously assumed to be an unrelated
  bottleneck) turns out to have been this same defect, and now compiles in
  4.6 min.

Measured across the GravityDex audit corpus (26 validators, same harness and
seed as the 0.4.4 numbers):

| | 0.4.4 | 0.4.5 |
|---|---|---|
| a2t pool validator vs reference impl | 7.2x | **0.94x** |
| a2t family total | — | **88.0% cpu / 83.5% mem** |
| t2t family total | 93.5% / 85.6% | **90.0% / 82.8%** |
| script size vs aiken | 117% | **83%** (smaller on 9 of 10) |
| whole-project compile | ~66 min | **4.7 min** |

Behaviour is unchanged everywhere it was already correct: 844 compiler
tests, the masterpiece regression gate, the 74-case validator matrix and the
t2t / a2t / stable accept+reject harnesses all pass, with no redeemer
encoding drift.

## v0.4.4

Every bug from the GravityDex-port audit is fixed (regression coverage in
`compiler.gravityDexBugs.0_4_3.test.ts`; that file's bug numbering).

- **⚠ CRITICAL: integer constants in (2^30, 2^52) no longer corrupt.** The
  flat encoder in `@harmoniclabs/uplc` delegated naturals up to
  `MAX_SAFE_INTEGER` to 32-bit bitwise chunking, silently truncating every
  emitted integer constant with |value| in (2^30, 2^52) — e.g. 1e15 became
  1e15 mod 2^30. Fixed in `@harmoniclabs/uplc` 2.0.7 (now the minimum
  dependency); const-folded sums and folded int-list elements landing in
  the window are covered too.
- **⚠ Requires `@harmoniclabs/cbor` >= 2.0.2.** That release fixes two
  bignum defects reachable from Pebble through `data` constants: integers
  below -(2^64) could not be serialised AT ALL (`CborNegInt` stored the
  tag-3 payload in place of the value, so the encoder rejected its own
  object with "encoding invalid negative integer as CBOR"), and every
  integer above 2^64 fell into a warn-and-recover path that printed a
  "please report this issue" warning and dumped the object to the console
  on each occurrence.
- **⚠ CORRECTNESS: loop control flow at any nesting depth.** A new
  `LoopEscape` channel threads `break`/`continue` results through
  intermediate `if`/`match` layers, and `return` wrapping has a single
  owner (the nearest state layer, bubbling one level at a time):
  - `return` inside a loop body no longer crashes the backend, and at
    nesting depth ≥ 2 no longer SILENTLY returns the wrong value;
  - `break` under two or more `if` levels exits the loop instead of
    trapping ("constructor tag out of range");
  - `continue` now advances the iterator: a fresh copy of the loop's
    update statements is spliced before every user `continue`, fixing the
    for/for-of infinite loop it always caused, at any depth.
  (Also fixes a 0.4.3 regression where the loop-state type was mutated
  through the clone-interning of struct types, deleting its early-return
  constructor.)
- **`export function` is visible module-wide.** Statement hoisting now
  classifies through `export` wrappers, so exported declarations keep
  their group ordering; previously every exported declaration sank below
  all plain ones and a non-exported function could not reference an
  exported one declared first.
- **`n < (s + 1)` parses as a comparison.** The speculative generic-call
  interpretation of `<` rolls back any diagnostics it recorded while
  failing, instead of leaking a bogus "')' expected".
- **Bare struct literals resolve.** A struct declaration (and a struct
  import) now registers its constructors for bare literal construction —
  `const s = SW{ a: x };` works without a type annotation or `using`,
  including inside loop and `test` bodies.
- **`std.builtins.mkNilData()` evaluates.** The nullary Pebble builtin is
  now a delayed UPLC builtin applied to unit, matching the zero-arg
  calling convention; previously runtime failed with "cannot force
  builtin mkNilData that has already received all its arguments".
- Unknown properties on loop-bound map entries (`e.fst`) error with the
  same 2339 diagnostic as everywhere else (regression-covered).
- **⚠ CORRECTNESS: free-variable analysis is properly scoped.** The
  binding-placement machinery's `getUnboundedVars` collected bound binder
  symbols in one flat set over the whole value — since cloned IR reuses
  binder symbols, a cloned binder fragment anywhere masked genuinely FREE
  occurrences of the same symbol elsewhere; mis-detected "closed" values
  were hoisted to the program root with dangling references, crashing the
  final lowering with "Variable not found in scope chain" on large
  validators (GravityDex BUG 13 — const-bound closures passed to
  higher-order functions). The analysis is now path-scoped; the audit's
  failing token-pool configuration compiles clean.
- **⚠ CORRECTNESS: application regrouping bails on reused binder symbols.**
  A second, independent cause of the same "Variable not found in scope
  chain" crash: `groupIndependentApplications` keys arguments by parameter
  SYMBOL, and cloned IR reuses those symbols — so a collapsed application
  chain could hold the same symbol twice (silently dropping one argument
  from the symbol-keyed map) or hold one that also occurs free at the
  regrouping root (masking a real dependency, since free occurrences are
  subtracted). Either way bindings moved across their own references. Both
  configurations are now detected and the original chain kept, which is
  always sound. This is what unblocked `adaStateContract`.
- **⚠ PERFORMANCE (compute-once): a `const` captured by a loop no longer
  re-evaluates per iteration.** A binding whose value the compiler cannot
  prove total (any user-function call) and whose references sit inside a
  loop was inlined into the loop body — the GravityDex audit measured a
  fold paying a FULL `isqrt` per element (12.29M cpu each; 71× the
  reference implementation on the real swap path, pushing the protocol
  past its own fee cap). Such bindings are now placed ONCE, just above
  the loop's recursive node — faithful to the source's
  eager-at-declaration `const` semantics — and the same rescue applies at
  branch-root placements. Regression-guarded by an evaluated
  marginal-cost-per-element test (`compiler.computeOnce.test.ts`).
- **⚠ PERFORMANCE (compute-once, through closures): a `const` captured by
  a lambda passed to a higher-order function no longer re-evaluates per
  call.** The dominant real-world shape puts the recursion in the CALLEE
  (a predicate handed to a fold), so the loop-only rescue above never saw
  it and the value was buried inside the closure: measured 23.81M cpu per
  fold element. Placement now floats such a binding above the outermost
  lambda it does not depend on, governed by an evaluation-frequency
  automaton — a multi-arm dispatch edge blocks the lift (hoisting an
  arm-specific value above dispatch would run it on foreign arms) unless
  an enclosing loop above it justifies pre-loop evaluation. Now 1.15M
  per element.
- **⚠ PERFORMANCE (compute-once, across `&&`): a `const` referenced from
  several conjuncts of a boolean cascade no longer re-evaluates per
  conjunct.** A `&&` chain lowers to SEQUENTIAL sibling `IRCase`s (each
  conjunct cases on the previous one's result), so per-branch bindings of
  a shared value never nest — every conjunct re-bound and re-computed it.
  The GravityDex swap validator re-ran one oracle fold 44 times: a single
  script evaluation cost 28.35B cpu. Declarations at the unconditional
  top level of a function are now marked `eagerFnScope` (source evaluates
  them exactly once per call regardless of any in-function dispatch), and
  their placement ignores dispatch debt, settling in ONE binding. That
  eval now costs 1.67B; the validator's compiled size fell from 20.4 kB
  to 7.2 kB. Guarded by `compiler.computeOnceAcrossBranches.test.ts`,
  which asserts cost does not scale with conjunct count. The complementary
  guarantee — that no binding is floated onto a path the source would not
  have evaluated — is guarded by `compiler.lazyLambdaConst.test.ts`
  (a failing `const` inside an uninvoked lambda must not run).
- **Duplicate nested bindings of the same value are dropped.** Shared
  bindings surface in waves during placement, and a wave that could not
  reuse an existing binder created its own binding of the same value —
  when one nests inside another's scope, the inner one is pure waste
  (an `IRVar` resolves to the innermost binder, which binds the same
  value). Such re-bindings are now removed.
- **OPTIMIZATION: predicate closures eta-reduce to partial builtin
  applications.** `const isTarget = (e: int) => e == captured;` compiles
  to `equalsInteger captured` (commutative flip), and `\x -> f x` reduces
  to `f` when `x` is not free in `f` — no closure allocation, fewer
  captures for the binding-placement machinery. Guarded so nothing
  effectful ever moves from call time to build time
  (`etaReduceLambdasAndReturnRoot`).
- **⚠ PERFORMANCE: compile time was quadratic in program size.** Several
  IR passes drove their worklist with `pop()` + `unshift(...)`, and three
  helpers collected application spines with `args.unshift(arg)`. Both look
  like ordinary FIFO code and neither changes the emitted script by a single
  byte — but `Array.prototype.unshift` moves every element already in the
  array, so walking a tree cost O(nodes^2) in hidden memmove. Measured on a
  6.6 kB validator: 630k visits against a worklist peaking at 11.5k entries,
  i.e. **5.5 billion element moves in one pass call**. All of them now use an
  index-advanced queue (same visit order) or `push` + a single `reverse`.
  Measured on the GravityDex corpus, with byte-identical output: the two
  worst passes **181.1s -> 4.6s (39x)**, `stateContract` **4.7 -> 2.0 min**,
  and the largest validator **65.9 -> 6.3 min (10x)**. `getSortedLettedSet`
  also replaced a linear `indexOf` per term with a map lookup.
  Regression-guarded by `compiler.compileWorkBounds.test.ts`, which asserts
  on DETERMINISTIC operation counts (identical on every machine) and their
  scaling, never on wall-clock time.
- **PERFORMANCE: large-validator exports are significantly faster.** The
  binding-placement pass searched the WHOLE program once per shared
  binding (quadratic; measured 26% of a near-hour GravityDex export) —
  it now searches from the binding's anchor scope. Array-like IR proxies
  iterate their backing array directly (was ~9%). Measured: a real
  8.8 kB validator export dropped from 77.5 s to under 60 s with
  byte-identical output; the compiler's own suite runs ~2× faster.
- **Internal scope-chain errors identify the mis-placed binding.** A
  "Variable not found in scope chain" failure is always a compiler bug, and
  it used to surface with no indication of WHERE. It now reports the
  offending variable's IR ancestry (binder chain with parameter names), so
  the bad placement is identifiable from the error alone.
- **Const-bound struct literals no longer poison the enclosing function.**
  `const c = S { a: x, b: 2 };` inside any function resolves (same
  constructor-registration fix as the bare-literal item above); previously
  every later reference to the enclosing function failed with
  "is not defined" naming the function.

## v0.4.3

Generic and recursive struct declarations, for both the data and the runtime
(SoP) encodings; regression coverage in `compiler.genericStructs.test.ts`
and `compiler.recursiveStructs.test.ts`.

- **Generic structs.** `struct Box<T> { v: T }` declares a generic struct
  template; `Box<int>` in any type position instantiates it through the same
  machinery as the native `List`/`Optional`/`LinearMap` generics. Works for
  plain, `data` and `runtime` declarations, with any number of type
  parameters, nested applications (`Box<Box<int>>`, `Box<List<int>>`), and
  generic-struct fields referencing other generic structs. Instantiations
  are distinct types: `Pair<int, bytes>` is not assignable to
  `Pair<bytes, int>`. Generic structs can be exported and imported across
  files, and appear in generic function signatures
  (`function unbox<T>( b: Box<T> ): T`) — with the type arguments INFERRED
  at the call site (`unbox( b )` with `b: Box<int>` binds `T = int`; the
  unifier matches applied generic structs argument-wise, so it also
  terminates on recursive ones like `Tree<T>` and rejects inconsistent
  bindings). Wrong-arity applications
  (`Box<int, bytes>`) and duplicate type-parameter names are compile errors;
  methods on generic structs are rejected with a clear "not supported yet"
  diagnostic.
- **Recursive structs.** A struct's fields can now reference the struct
  itself, a struct declared later in the file, or form mutually-recursive
  groups — `struct IntList { Nil{} Cons{ value: int, next: IntList } }`
  previously failed with "`IntList` is not defined". Struct names are
  forward-declared before any field compiles, and every compile-time type
  walk (concreteness, cloning, decode-once field extraction, the show/data
  encoders) now terminates on self-referential types.
- **Generic + recursive combined.** `struct Tree<T> { Leaf{ value: T }
  Branch{ value: T, left: Tree<T>, right: Tree<T> } }` works for both
  encodings; instantiation preserves the recursive structure
  (`Tree<int>`'s branches are `Tree<int>` by reference).
- **Recursion across the data boundary.** Data-encoded recursion is fully
  supported — values decode lazily, one level per `case`, so building,
  matching and recursive traversal all evaluate on-chain. A recursive
  `runtime struct` is runtime-only: building, matching and field access
  work, but converting one to/from `data` (datum/redeemer boundary,
  `as data`) is a clear compile error steering to `data struct`, never a
  compiler hang.
- **Runtime structs as function parameters.** A runtime-only struct can now
  be passed to and returned from functions; previously the parameter type
  silently failed to resolve (only its data encoding was consulted). A
  runtime struct field typed with another runtime struct no longer silently
  drops the field.
- **Type-parameter fidelity.** Cloning a `TirTypeParam` no longer loses its
  identity symbol, which substitution relies on.
- **⚠ CORRECTNESS: `data struct` with a `List<…>` field no longer
  miscompiles.** Converting a list with non-data elements to `data` consed
  the mapped elements onto a nil of the wrong list type (a runtime
  `mkCons :: incongruent list types` trap in every data struct holding a
  `List<int>`-style field) and never wrapped the inline result in
  `listData`; additionally, constant list literals in struct fields ran a
  nested compilation inside the outer compile's context, corrupting the
  outer pipeline (backend crashes). Nested eager compiles now run isolated
  on a clone; regression matrix (field type × encoding, asserted by
  evaluation) in `compiler.structFieldRoundTrip.test.ts`.
- **Generic type aliases.** `type Al<T> = List<T>` (and aliases of generic
  structs, multi-param aliases, aliases in signatures, exported aliases)
  instantiate through the same machinery as generic structs, with arity and
  duplicate-param diagnostics.
- **User interface impls compile.** The `self` receiver of a
  `type X implements I { m( self ) … }` block is now typed with the
  implementing type, so user-defined impls (e.g. a custom `show` or
  `toData`) compile and override the built-in derivation — including when
  resolved as the dictionary of a constrained generic.
- **`.toData()` is a universal method.** Every data-encodable value
  converts with `x.toData()` (identity for already-data-encoded types), and
  a `<T implements ToData>` generic body can call it on `T`-typed values —
  each instantiation dispatches to the built-in conversion or the user's
  impl. Recursive `runtime struct`s remain rejected at the data boundary.
- **Re-exports.** `export * from "./lib.pebble"` and
  `export { x, y as z } from "./lib.pebble"` merge the referenced file's
  exported symbols into the re-exporting file's exports (chains work; per
  TS semantics the names are NOT brought into the local scope; missing
  members and collisions are clear errors). Tests in
  `compiler.reExports.test.ts`.
- **⚠ CORRECTNESS: `Optional` values follow one payload convention
  everywhere.** The named `Some{ value: … }` literal stored its payload
  raw while every consumer expected data — so a `Some` built in Pebble and
  matched with `case` trapped at runtime ("unIData :: not data value"),
  standalone or as a struct field. The literal now encodes the payload,
  and the optional data-conversion branches were aligned to the same
  convention. An optional field in a `runtime struct` also no longer
  crashes the compiler (a two-constructor optional was being flattened as
  a single-constructor struct), and generic data structs instantiated at
  `Optional<…>` construct correctly.
- **⚠ CORRECTNESS: cloning a `case` IR node no longer shares its
  scrutinee.** The shared node let one compilation's in-place pipeline
  mutations poison every other tree using the same (module-level) helper —
  the "only closed terms can be hoisted" backend crash on a `bool` field
  in a multi-constructor `data struct`, and a source of order-dependent
  miscompiles. Emitted bytecode can shift slightly as a result (the
  redeemer wire format is unchanged — verified by the executing parity
  tests before re-recording the pinned snapshot).
- **Struct-field round-trip matrix.** `compiler.structFieldRoundTrip.test.ts`
  now evaluates every common field type × both encodings × single-ctor /
  multi-ctor / generic instantiation — the class of silent field-encoding
  bugs (27, 41, 42, 43, 44, 45) is under permanent guard.
- **`Value` fields in data structs.** A native `Value` in a data-encoded
  struct round-trips (`valueData`/`unValueData`); previously the encoder
  had no Value branch and export died with an internal message after a
  clean `check`.
- **`case` expressions are no longer newline-sensitive.** The case parser
  consumed the semicolon that terminates the ENCLOSING statement, so
  `const x = case … ; return x;` on one line failed with "Unexpected
  token" while the multi-line form parsed — formatting changed semantics.
  (A stray `;` immediately before `)` inside a parenthesized case — only
  ever accepted because of that quirk — no longer parses.)
- **Namespace-qualified struct constructors.** `M.S.C{ v: n }` (and deeper
  paths like `A.B.S.C{ … }`) construct through the namespace, with the same
  local-visibility rule as qualified type annotations; previously only the
  two-segment `Type.Constructor{ … }` form parsed and the qualified form
  died with "Unexpected token".
- **Generic types in cast position.** `as LinearMap<bytes, bytes>` (and
  `as Box<int>` for user generics) resolves instead of "'LinearMap' is not
  defined", and re-typing a `LinearMap`'s keys/values lowers as the
  identity — making the documented
  `std.builtins.unMapData( d ) as LinearMap<…>` idiom work end to end (the
  aliased workaround previously threw at export too).

## v0.4.2

Type-system audit fixes, from an independent audit; regression coverage in
`compiler.auditBugs.0_4_1.test.ts`.

- **⚠ CORRECTNESS: SoP (`runtime struct`) multi-constructor literals ran
  the wrong `case` arm.** Every SoP struct literal was emitted as
  `IRConstr(0, …)` regardless of which constructor was named, so matching a
  non-first variant silently ran the first arm. Now uses the constructor's
  real index.
- **`case` expressions are checked like `match` statements**: a
  non-exhaustive `case` with no wildcard is now a compile error, and arms
  with incompatible types are rejected via a type join instead of silently
  taking the first arm's type.
- **`export()` surfaces diagnostics** instead of draining them and
  succeeding — it now throws on any ERROR (warnings tolerated), matching
  `compile()`/`run()`. This unmasked that the `Show` interface was unwired
  for structs, `Value`, and `trace` of a Show-able value — all now wired
  through `_showIR`.
- **Return-type inference recurses** into `if`/`match`/loop/block bodies, so
  a function whose returns are all nested (`if(..) return a else return b`)
  infers correctly instead of `void`.
- **Generic type declarations no longer crash the compiler**: generic
  structs/aliases/interfaces emit located "not supported yet" diagnostics,
  and a generic container in a generic signature (`function wrap<T>():
  List<T>`) now lowers symbolically and monomorphizes instead of throwing.
- **Parser**: interface method signatures may end with `;`; nested `match`
  patterns parse and `else:` is accepted, with nested *refinement* patterns
  giving one clear diagnostic pointing at the bind-then-`case` workaround;
  `export`/`private` on namespace members parse, and `export … from`
  re-export gives a clear "not supported yet" diagnostic.
- **Qualified type paths no longer leak**: `M.T` resolves only members of
  `M`, not any file-level type reachable by walking scopes.
- **`List.map` / `LinearMap.map` work with a lambda.** The callback's output
  type (`(A) => B`) is now inferred from the lambda instead of leaving `B`
  unresolved — previously `l.map( x => x + 1 )` failed with the maximally
  confusing "Type `(int) => T` is not assignable to type `(int) => T`" (a
  type not assignable to itself). Type-changing maps (`int -> bytes`,
  `int -> bool`) work too.
- **Higher-order functions can be declared.** A function type can now be
  written in a parameter annotation with TypeScript syntax —
  `function ap( f: (a: int) => int, x: int ): int { return f( x ); }` — so
  users can write their own `map`/`fold`/etc. Lambdas passed to a user
  higher-order function get exactly the same treatment as those passed to
  the built-in combinators: the `const`-only capture rule still applies, and
  a captured expensive `const` is still evaluated once (not per call).

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
