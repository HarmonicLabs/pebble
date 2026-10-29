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
  entry per compiler, main track, as of 2026-10-29). Lower is better
  everywhere.
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
| Scalus 0.18.2 / 1.3.0 ¹ | 14,567,412 | 23,874 | 113 |
| Plutarch 1.11.0 (prepacked) ¹ | 16,459,951 | 30,485 | 118 |
| Aiken 1.1.19 / 1.1.24 (prepacked) ¹ | 22,530,209 | 49,432 | 124 |
| **Pebble 0.5.0** | **55,846,226** | **222,119** | **75** |
| Plinth 1.61.0.0 | 59,206,243 | 243,219 | 63 |
| OpShin 0.26.1 | 240,131,414 | 1,306,476 | 227 |

¹ These entries answer from a prepacked lookup table of the 26 expected
values (e.g. `sliceByteString` + `byteStringToInteger`) — a legitimate use
of the scenario's implementation freedom, but not an algorithmic
computation. Among the entries that *compute* fibonacci, Pebble's loop is
the fastest.

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
| **Pebble 0.5.0** | **163,663,780** | 574,564 | 1,357 |
| Plinth 1.67.0.0 | 163,913,498 | 486,978 | 1,572 |
| Plinth 1.71.0.0 | 164,585,498 | 491,178 | 1,574 |
| Plinth 1.65.0.0 | 168,230,952 | 536,866 | 1,312 |
| Scalus 1.3.0 | 212,801,989 | 537,615 | 1,325 |

Pebble takes the **lowest CPU of the suite** on its first
real-world-contract entry — 23% below Scalus 1.3.0 and just below the best
Plinth build — with a script within 4% of the smallest. (Figures use the
scenario's 30-minute deadline in milliseconds and exclusive upper bounds,
UPLC-CAPE #253 and #247.) The implementation
validates each endpoint in a single traversal of the outputs, compares
signatures and credentials as raw bytes, and reads lovelace through the
compiler's raw-value-map `amountOf` fast path (skipping `unValueData`'s
whole-map conversion); that fast path trades a little memory for CPU,
which is why Plinth keeps the memory lead here.

## Fixed-algorithm scenarios (naive recursion)

These constrain every compiler to the same textbook-recursive algorithm, so
they compare backend code generation only. The UPLC-CAPE maintainers
re-submitted Pebble's entries with Pebble 0.4.4 (UPLC-CAPE #257) and 0.5.0
(#268), which compile the same sources to the same programs. The figures
below follow #264 and #266, which brought the sources to the prescribed base
cases: Pebble's factorial now stops at `n <= 0` instead of `n <= 1`, and the
Scalus fibonacci entries no longer add an extra base case.

| scenario | Pebble 0.5.0 CPU | best other CPU | standing |
| --- | ---: | ---: | --- |
| `factorial_naive_recursion` | **26,979,195** | 28,019,280 (Scalus 1.3.0, Plinth 1.61–1.71) | **1st of 5 compilers**, 4% below the next |
| `fibonacci_naive_recursion` | **112,400,919,906** | 129,093,086,599 (Scalus 1.3.0, Plinth 1.61–1.71) | **1st of 5 compilers**, 13% below the next; 0.1.2 was at 154,053,890,937 |

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
