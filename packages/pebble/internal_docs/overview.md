# Pebble Compiler — Internal Overview

Pebble is a functional programming language with an imperative bias that compiles to UPLC (Untyped Plutus Core) for execution on the Cardano blockchain. This document provides a high-level overview of the compilation pipeline and project architecture.

## Compilation Pipeline

```
SOURCE CODE (.pebble files)
        │
        ▼
┌───────────────┐
│   TOKENIZER   │  Lexical analysis: source text → token stream
│  (iterator)   │  Handles comments, strings, numbers, keywords, operators
└───────┬───────┘
        │ Token stream (lazy, one-at-a-time)
        ▼
┌───────────────┐
│    PARSER     │  Syntax analysis: tokens → AST
│  (recursive   │  Recursive descent with operator precedence climbing
│   descent)    │  Produces syntactically correct tree
└───────┬───────┘
        │ PebbleAst (untyped, statement-based)
        ▼
┌───────────────┐
│ AST COMPILER  │  Semantic analysis: AST → TIR (TypedProgram)
│  (type check  │  Type inference, symbol resolution, scope management
│   + compile)  │  Module loading via IO API
└───────┬───────┘
        │ TypedProgram / TIR (typed, statement-based)
        ▼
┌───────────────┐
│ TIR COMPILER  │  Expressification: TIR → IR
│ (expressify)  │  Converts imperative statements to functional expressions
│               │  Loops → recursion, if → ternary/case, assignments → let-bindings
└───────┬───────┘
        │ IRTerm (untyped, expression-based)
        ▼
┌───────────────┐
│  IR → UPLC    │  Backend compilation with optimization passes
│  COMPILER     │  Constant folding, dead code elimination, hoisting,
│               │  native expansion, application grouping, recursive handling
└───────┬───────┘
        │ UPLCTerm
        ▼
┌───────────────┐
│ SERIALIZATION │  Flat CBOR encoding of the UPLC program
│               │  Produces final on-chain binary
└───────┬───────┘
        │ Uint8Array (CBOR-encoded flat)
        ▼
   CARDANO CHAIN
```

## Project Structure

```
src/
├── tokenizer/           Lexical analysis (Token enum, Tokenizer class)
├── parser/              Syntax analysis (Parser class, Precedence)
├── ast/                 AST node definitions
│   ├── nodes/
│   │   ├── expr/        Expression nodes (literals, binary, call, etc.)
│   │   ├── statements/  Statement nodes (if, for, while, var, etc.)
│   │   ├── types/       Type expression nodes
│   │   └── common/      Identifiers, shared types
│   └── Source/          Source file representation
├── compiler/
│   ├── Compiler.ts      Public API entry point
│   ├── io/              IO abstraction (file reading, output streams)
│   ├── AstCompiler/     AST → TIR compiler (type checking + semantic analysis)
│   │   ├── internal/    Expression and statement compilation
│   │   └── scope/       Scope and symbol management
│   ├── tir/             Typed Intermediate Representation
│   │   ├── types/       TIR type system (native, struct, alias, interface)
│   │   ├── expressions/ TIR expression nodes
│   │   ├── statements/  TIR statement nodes
│   │   └── program/     TypedProgram container
│   ├── TirCompiler/     TIR → IR compiler (expressification)
│   │   └── expressify/  Statement-to-expression conversion
│   └── path/            File path utilities
├── IR/                  Intermediate Representation (backend)
│   ├── IRNodes/         All IR node types (Var, Func, App, Const, etc.)
│   ├── toUPLC/          IR → UPLC compilation
│   │   ├── subRoutines/ Optimization passes
│   │   └── ctx/         UPLC compilation context (De Bruijn tracking)
│   └── utils/           IR utilities
└── diagnostics/         Error and warning reporting
```

## Key Design Decisions

### Iterator-based Tokenizer
The tokenizer yields tokens one at a time rather than materializing the full token array. This keeps memory usage proportional to source size and allows the parser to control advancement.

### Recursive Descent with Precedence Climbing
The parser uses recursive descent for statements and precedence climbing for expressions. This gives clear, maintainable code for statement-level constructs while efficiently handling the 20+ operator precedence levels.

### Two-IR Architecture (TIR + IR)
- **TIR** (Typed IR): Frontend-facing, retains types and imperative structure. Used for type checking and semantic validation.
- **IR** (Backend IR): Untyped, purely expression-based. Maps directly to UPLC's lambda calculus model.

The separation allows the frontend to work with familiar imperative constructs while the backend operates on a minimal functional core.

### Expressification
The TIR → IR step ("expressification") is the bridge between imperative and functional worlds:
- Variable assignments become let-bindings
- `if` statements become ternary/case expressions
- `for`/`while` loops become recursive functions
- `break`/`continue` become return values from recursive lambdas
- Statement sequences become nested applications

### Multi-Pass Optimization
The IR → UPLC compiler runs ~10 optimization passes in a carefully ordered sequence. Early passes (constant folding, dead code elimination) simplify the IR before native expansion introduces new terms. Later passes (hoisting, application grouping) optimize the final UPLC structure.

### IO Abstraction
The compiler operates through a `CompilerIoApi` interface, decoupling file system access from compilation logic. This enables both filesystem-based and in-memory compilation (useful for testing, REPL, and browser environments).

## Smart Contract Support

Pebble includes first-class support for Cardano smart contracts via `contract` declarations:

```
contract MyValidator {
    param treasury: bytes;

    spend(datum, redeemer) {
        // validation logic
    }

    mint(redeemer) {
        // minting policy
    }
}
```

Contract methods (`spend`, `mint`, `certify`, `withdraw`, `propose`, `vote`) compile to individual UPLC validator scripts. The `context` keyword provides access to the transaction context within contract methods.

## Dependencies

- `@harmoniclabs/uplc` — UPLC term definitions and serialization
- `@harmoniclabs/plutus-machine` — UPLC evaluation machine
- `@harmoniclabs/plutus-data` — Plutus Data encoding
- `@harmoniclabs/cbor` — CBOR serialization
