<p align="center">
  <img width="70%" src="./assets/header.png" align="center"/>
  <p align="center">A simple, yet rock solid, functional language with an imperative bias, targeting UPLC</p>

  <p align="center">
    <img src="https://img.shields.io/github/commit-activity/m/HarmonicLabs/plu-ts?style=for-the-badge" />
    <a href="https://twitter.com/hlabs_tech">
      <img src="https://img.shields.io/twitter/follow/hlabs_tech?style=for-the-badge&logo=twitter" />
    </a>
    <a href="https://twitter.com/MicheleHarmonic">
      <img src="https://img.shields.io/twitter/follow/MicheleHarmonic?style=for-the-badge&logo=twitter" />
    </a>
  </p>
</p>

## what is pebble?

Pebble is a smart-contract language for Cardano with **TypeScript-shaped
syntax** — `const`, `if`, C-style `for` loops, structs, generics, modules —
compiled to Untyped Plutus Core (UPLC) by a whole-program optimizing
compiler. You write imperative-looking code; the compiler lowers loops to
tail recursion, places every computation exactly once, and emits compact
scripts that use the newest on-chain features (UPLC 1.2 `case`/`constr`,
the protocol-version-11 builtins).

What you get out of the box:

- a **type system** built for validators: data-encoded and
  sum-of-products structs, generics with monomorphization, exhaustive
  `match`, flow-sensitive narrowing, and the full script-context prelude
  (`ScriptContext`, `Tx`, `Value`, `Interval`, …);
- a **standard library** covering the common dApp patterns —
  `tx.signedBy`, `tx.findInput`, `tx.valuePaidTo`, `Value` arithmetic,
  interval helpers, lists and linear maps;
- a **built-in test framework**: `pebble test` runs unit and property
  tests on the real CEK machine, with typed fuzzers for every parameter
  type, user-defined `via` fuzzers, failing-input shrinking, and per-test
  cpu/mem budgets;
- **competitive output**: Pebble holds the lowest CPU numbers in the
  [UPLC-CAPE](https://github.com/IntersectMBO/UPLC-CAPE)
  `two_party_escrow` real-world benchmark and the `factorial` open
  benchmark (where it leads memory too) — see
  [BENCHMARKS.md](./BENCHMARKS.md) and the
  [live report](https://intersectmbo.github.io/UPLC-CAPE/).

## Benchmarks

Pebble is benchmarked against Aiken, Plinth, Plutarch, Scalus and OpShin in
IntersectMBO's [UPLC-CAPE](https://github.com/IntersectMBO/UPLC-CAPE) suite:
results and methodology in **[BENCHMARKS.md](./BENCHMARKS.md)**, rendered
charts on the [live report](https://intersectmbo.github.io/UPLC-CAPE/).

## Install

command line

```bash
npm install -g @harmoniclabs/pebble
```

or as library (in your project root dir)

```bash
npm install @harmoniclabs/pebble
```

## Get started

Have a look at the [`pebble` documentation](https://pluts.harmoniclabs.tech) where you can find some [example projects](https://pluts.harmoniclabs.tech/examples/Hello%20World) to help you get started.

## Sponsors ❤️

the [sponsors.md](./sponsors.md) file contains a list of supporters of this project.

Every one of them is special and is contributing to making this software available for everyone.

## Project Catalyst

a collection of all proposals made in the past is in the [```catalyst-proposals.md```](./catalyst-proposals.md) file
