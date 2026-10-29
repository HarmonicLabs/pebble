# UPLC-CAPE submissions

Pebble sources for the [UPLC-CAPE](https://github.com/IntersectMBO/UPLC-CAPE)
benchmark submissions:

| scenario | source | approach |
| --- | --- | --- |
| `fibonacci` (open) | [src/fibonacci.pebble](src/fibonacci.pebble) | iterative pair accumulator, O(n) additions |
| `factorial` (open) | [src/factorial.pebble](src/factorial.pebble) | iterative accumulator, O(n) multiplications |
| `two_party_escrow` (open, real-world) | [src/two-party-escrow.pebble](src/two-party-escrow.pebble) | fully-applied `( data ) => void` validator, single pass over outputs |

The measured results and the comparison against the other compilers in the
suite live in the repo-level [BENCHMARKS.md](../../BENCHMARKS.md) and on the
live report at <https://intersectmbo.github.io/UPLC-CAPE/>.

## Reproducing the artifacts

```bash
npm i -g @harmoniclabs/pebble-cli@0.5.0
cd examples/uplc-cape

pebble export --function-name fibonacci        --entry ./src/fibonacci.pebble        && mv out/out.flat out/fibonacci.flat
pebble export --function-name factorial        --entry ./src/factorial.pebble        && mv out/out.flat out/factorial.flat
pebble export --function-name two_party_escrow --entry ./src/two-party-escrow.pebble && mv out/out.flat out/two_party_escrow.flat

pebble uplc pretty --canonical -i ./out/fibonacci.flat        -o ./out/fibonacci.uplc
pebble uplc pretty --canonical -i ./out/factorial.flat        -o ./out/factorial.uplc
pebble uplc pretty --canonical -i ./out/two_party_escrow.flat -o ./out/two_party_escrow.uplc
```

The `.uplc` files are what gets submitted; each submission's `metadata.json`
pins the exact commit of this repository the artifact was built from.

Measurements (`metrics.json`) are produced by the UPLC-CAPE `cape` CLI inside
the UPLC-CAPE repo:

```bash
cape submission measure submissions/<scenario>/Pebble_0.5.0_michele-nuzzi
cape submission verify  submissions/<scenario>/Pebble_0.5.0_michele-nuzzi
```

## PV11 note

Pebble 0.5.0 emits UPLC 1.2 `case`/`constr` (builtin casing) unconditionally,
so the artifacts require **protocol version 11 (van Rossem)** on-chain —
declared in each submission's `metadata.json` as `min_protocol_version: 11`.
The CAPE production evaluator (plutus-core 1.63, the cardano-node 11.0.1
line) executes them on the default track.
