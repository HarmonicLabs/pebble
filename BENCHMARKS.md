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
  pins the exact commit. Until the 0.5.0 submission PRs are merged
  upstream, the Pebble rows are measured with the same test vectors on the
  local CEK machine (`@harmoniclabs/plutus-machine`, PV11 cost model) —
  the official numbers land with the PRs.

## `fibonacci` (open optimization)

Sum over the 11 scenario inputs (n ∈ {0, 1, 2, 3, 5, 8, 10, 15, 20, 25, −1}).
Pebble's entry is a plain iterative pair accumulator — no lookup tables.

| submission | CPU units | memory units | size (B) |
| --- | ---: | ---: | ---: |
| Scalus 0.18.2 ¹ | 14,567,412 | 23,874 | 113 |
| **Pebble 0.5.0** | **55,856,726** | **222,144** | **73** |
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
| **Pebble 0.5.0** | **25,680,360** | **104,214** | **47** |
| Plutarch 1.11.0 (exbudget) | 37,001,975 | 137,290 | 65 |
| Scalus 0.17.0 | 37,481,975 | 140,290 | 40 |

Pebble's iterative loop is ~31% cheaper on CPU than the best previous
entry.

## `two_party_escrow` (open optimization, real-world contract)

A fully-applied `(data) → unit` spending validator with deposit / accept /
refund endpoints, validated against the scenario's 47 positive and negative
test vectors. Sum over the 10 measured (positive) vectors.

| submission | CPU units | memory units | size (B) |
| --- | ---: | ---: | ---: |
| **Pebble 0.5.0** | **212,485,196** | **475,965** | 1,377 |
| Plinth 1.67.0.0 | 234,254,380 | 588,937 | 1,570 |
| Plinth 1.65.0.0 | 241,625,986 | 677,161 | 1,310 |
| Scalus 0.18.2 | 343,534,594 | 809,179 | 1,392 |

Pebble takes the **lowest CPU and memory** of the suite on its first
real-world-contract entry (−9% CPU vs the best Plinth build), with the
second-smallest script. The win comes from the compiler's compute-once
placement and from validating each endpoint in a single traversal of the
transaction outputs.

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
