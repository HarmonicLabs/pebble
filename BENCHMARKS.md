# Pebble × UPLC-CAPE benchmarks

[UPLC-CAPE](https://github.com/IntersectMBO/UPLC-CAPE) (Comparative Artifact
Performance Evaluation) is IntersectMBO's compiler-agnostic benchmark suite
for Untyped Plutus Core: every compiler submits a compiled artifact per
scenario, and one shared harness measures them all. The live report is at
**<https://intersectmbo.github.io/UPLC-CAPE/>**.

## Methodology

- **Metrics**: CPU units and memory units summed across each scenario's
  measurement vectors (a tallying CEK machine with the production cost
  model), plus flat-encoded script size in bytes.
- **Evaluator**: plutus-core **1.63**, the line shipped by cardano-node
  11.0.1 — mainnet since the **van Rossem hard fork (protocol version 11,
  2026-07-18)**. Builtin casing (`case`/`constr` over builtin values) and
  the batch-6 builtins run on the production track.
- **Competitor numbers** below are taken verbatim from the accepted
  submissions' `metrics.json` files in the UPLC-CAPE repository (best
  entry per compiler, main track). Lower is better everywhere.
- **Pebble artifacts** are compiled by Pebble **0.5.0** with default
  settings from [`examples/uplc-cape`](examples/uplc-cape); each submission
  pins the exact commit. The Pebble rows below are measured with the
  **official CAPE `measure` tool** (evaluator `PlutusTx.Eval-1.63.0.0`),
  every scenario test vector passing — the same tool that produces the
  numbers on the live report. Aggregates cover each scenario's measured
  (positive) vectors, matching the report's accounting.

## `fibonacci` (open optimization)

Sum over the 11 scenario inputs (n ∈ {0, 1, 2, 3, 5, 8, 10, 15, 20, 25, −1}).
Pebble's entry is a plain iterative pair accumulator — no lookup tables.

| submission | CPU units | memory units | size (B) |
| --- | ---: | ---: | ---: |
| Scalus 0.18.2 ¹ | 14,567,412 | 23,874 | 113 |
| **Pebble 0.5.0** | **55,846,226** | **222,119** | **75** |
| Plinth 1.67.0.0 | 59,334,107 | 243,219 | 63 |
| Aiken 1.1.19 (tailrec) | 67,838,022 | 256,986 | 77 |
| OpShin 1.0.0 | 240,131,414 | 1,306,476 | 227 |

¹ Scalus' entry answers from a byte-packed lookup table of all 26 expected
values (`sliceByteString` + `byteStringToInteger`) — a legitimate use of the
scenario's implementation freedom, but not an algorithmic computation.
Among the entries that *compute* fibonacci, Pebble's loop is the fastest.

## `factorial` (open optimization)

Sum over the 11 scenario inputs (n ∈ {0..5, 8, 10, 12, −5}).

| submission | CPU units | memory units | size (B) |
| --- | ---: | ---: | ---: |
| **Pebble 0.5.0** | **25,651,296** | **104,195** | **49** |
| Plutarch 1.11.0 (exbudget) | 37,001,975 | 137,290 | 65 |
| Scalus 0.17.0 | 37,481,975 | 140,290 | 40 |

Pebble's iterative loop is ~31% cheaper on CPU (and the cheapest on
memory) than the best previous entry.

## `two_party_escrow` (open optimization, real-world contract)

A fully-applied `(data) → unit` spending validator with deposit / accept /
refund endpoints, validated against the scenario's 47 positive and negative
test vectors. Aggregate over the 10 measured (positive) vectors, official
CAPE accounting:

| submission | CPU units | memory units | size (B) |
| --- | ---: | ---: | ---: |
| **Pebble 0.5.0** | **163,663,780** | 574,564 | 1,355 |
| Plinth 1.67.0.0 | 163,748,290 | 486,576 | 1,570 |
| Plinth 1.65.0.0 | 168,065,744 | 536,464 | 1,310 |
| Scalus 0.18.2 | 231,874,447 | 619,461 | 1,392 |

Pebble takes the **lowest CPU of the suite** on its first
real-world-contract entry — 29% ahead of Scalus and just past the best
Plinth build — with the second-smallest script. The implementation
validates each endpoint in a single traversal of the outputs, compares
signatures and credentials as raw bytes, and reads lovelace through the
compiler's raw-value-map `amountOf` fast path (skipping `unValueData`'s
whole-map conversion); that fast path trades a little memory for CPU,
which is why Plinth keeps the memory lead here.

## Fixed-algorithm scenarios (naive recursion)

Pebble has had entries in the two naive-recursion scenarios since 0.1.2 —
these constrain every compiler to the same textbook-recursive algorithm, so
they compare backend code generation only:

| scenario | Pebble 0.1.2 | best other | notes |
| --- | ---: | ---: | --- |
| `fibonacci_naive_recursion` CPU | 154,053,890,937 | 115,413,721,337 (Scalus 0.17+) | Pebble 2nd of 5 compilers at 0.1.2 |
| `factorial_naive_recursion` CPU | 30,365,890 | 28,019,280 (Plinth 1.61+) | within 8% of the lead at 0.1.2 |

The 0.1.2 entries predate the 0.4.x optimizer campaign (2–3× whole-program
improvements, compute-once placement, case-over-constant lowering); the
open-optimization entries above reflect the current compiler.

## Real-world cross-check: the Cardano Masterpiece

Outside CAPE, the repository's [mainnet
contract](examples/the-cardano-masterpiece) tracks a hand-ported Aiken
implementation of the same three validators
([BENCHMARK.md](examples/the-cardano-masterpiece/BENCHMARK.md)): Pebble's
scripts measure **89–98% of the Aiken port's size** — smaller on all three
contracts — while passing the same on-chain test suite.

## Reproducing

Sources, exact commands and pinned commits: [examples/uplc-cape](examples/uplc-cape).
Measurements: `cape submission measure <dir>` inside the UPLC-CAPE repo's
dev shell; correctness: `cape submission verify <dir>` (runs every
`cape-tests.json` vector, negative cases included).
