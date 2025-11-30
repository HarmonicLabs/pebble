<p align="center">
  <img width="70%" src="./assets/header.png" align="center"/>
  <p align="center">A simple, yet rock solid, functional language with an imperative bias, targeting UPLC</p>

  <p align="center">
    <img src="https://img.shields.io/github/commit-activity/m/HarmonicLabs/pebble?style=for-the-badge" />
    <a href="https://twitter.com/hlabs_tech">
      <img src="https://img.shields.io/twitter/follow/hlabs_tech?style=for-the-badge&logo=twitter" />
    </a>
    <a href="https://twitter.com/MicheleHarmonic">
      <img src="https://img.shields.io/twitter/follow/MicheleHarmonic?style=for-the-badge&logo=twitter" />
    </a>
  </p>
</p>

## What is Pebble?

Pebble is a strongly-typed domain-specific language (DSL) for writing Cardano smart contracts. It compiles to UPLC (Untyped Plutus Lambda Calculus) - the low-level language that runs on the Cardano blockchain.

Key features:
- **TypeScript-like syntax** - Familiar syntax for JS/TS developers
- **Imperative constructs** - Supports loops (`for`, `while`) and mutable variables
- **Efficient compilation** - Produces optimized UPLC bytecode
- **Type safety** - Catch errors at compile time, not on-chain

## Install

### Using bun (recommended)

```bash
bun install -g @harmoniclabs/pebble-cli
```

> We suggest using [bun](https://bun.sh/) for installation as it offers performance improvements for the compiler.

### Using npm

```bash
npm install -g @harmoniclabs/pebble-cli
```

### As a library

```bash
npm install @harmoniclabs/pebble
```

## Get Started

1. Create a new project:
```bash
pebble init
```

2. Compile your contract:
```bash
pebble compile
```

3. Verify installation:
```bash
pebble --version
```

## Documentation

Full documentation is available at: **https://pluts.harmoniclabs.tech/**

## Community

- [Discord](https://discord.gg/CGKNcG7ade)
- [Twitter @pebble_lang](https://twitter.com/pebble_lang)
