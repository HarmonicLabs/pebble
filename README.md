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
- a **REPL**: `pebble repl` evaluates expressions, declarations and tests
  against your project's files, and shows each value with its cpu/mem cost;
- **source maps and a debugger**: a failing script says which line of the
  Pebble source failed (in `pebble test` and in buildooor), and
  `pebble debug` shows a test or a failed transaction statement by
  statement with the variables' values (`--json` for tools and AI
  agents); the VS Code extension steps through it forwards and backwards;
- **traces that cost nothing on chain**: `removeTraces` compiles the script
  as if its traces were not there, and the source map keeps them, so tests,
  the debugger and buildooor still print them;
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

command line (the `pebble` command)

```bash
npm install -g @harmoniclabs/pebble-cli
```

or as library (in your project root dir)

```bash
npm install @harmoniclabs/pebble
```

## Try it in the REPL

The REPL runs Pebble line by line, with the files of the project you start it in:

```bash
npm install -g @harmoniclabs/pebble-cli
git clone https://github.com/HarmonicLabs/pebble.git
cd pebble/examples/uplc-cape
pebble repl
```

```text
Pebble REPL 0.6.0, project .../pebble/examples/uplc-cape
Type :help for help.
pebble> import { factorial } from "./src/factorial.pebble";
pebble> factorial(5)
120
cpu: 2766005 | mem: 11221
pebble> import { fibonacci } from "./src/fibonacci.pebble";
pebble> fibonacci(10)
55
cpu: 6289504 | mem: 25047
pebble> const n = factorial(4);
pebble> fibonacci(n)
46368
cpu: 16831474 | mem: 64745
pebble> :quit
```

Each line runs as one program, made of the declarations entered so far and
the line, on the same machine as `pebble test`. The cost shown is that
program's, so `fibonacci(n)` includes computing `n`.

- Expressions show their value, in Pebble syntax (`P{ x: 1, y: 2 }`,
  `[1, 2, 3]`, `#abcd`).
- `const`, `let`, `function`, `struct`, `import` and `contract` are kept for
  the lines after. Redeclaring a name replaces it.
- Statements run: `if`, `for`, `while`, `trace`, `assert`, `fail`, `x = ...`.
  What they change in a `let` is kept.
- `test name() { ... }` runs at once.
- Contracts are type-checked. Their methods need a script context, so they
  run under `pebble test`.
- Functions, contracts and tests can use constants and other declarations,
  not `let`s.
- A line that fails changes nothing. Errors point at what you typed.
- A line can spend what a mainnet transaction can: 10,000,000,000 cpu and
  16,500,000 mem. An endless loop stops there.

Commands: `:help`, `:list` (the declarations kept), `:reset`, `:quit`
(also Ctrl+D, or Ctrl+C twice). Lines can be piped in (`pebble repl <
session.txt`): the output reads as a session, and the exit code is 1 if a line
failed. The REPL reads the nearest `pebble.config.json` (or `--config`), and
writes nothing.

## Get started

Have a look at the [`pebble` documentation](https://pluts.harmoniclabs.tech) where you can find some [example projects](https://pluts.harmoniclabs.tech/examples/Hello%20World) to help you get started.

## Sponsors ❤️

the [sponsors.md](./sponsors.md) file contains a list of supporters of this project.

Every one of them is special and is contributing to making this software available for everyone.

## Project Catalyst

a collection of all proposals made in the past is in the [```catalyst-proposals.md```](./catalyst-proposals.md) file
