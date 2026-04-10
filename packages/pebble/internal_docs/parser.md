# Parser

The parser (`src/parser/`) performs syntax analysis, converting a token stream into an Abstract Syntax Tree (AST). It uses recursive descent for statements and precedence climbing for expressions.

## Architecture

**File:** `src/parser/Parser.ts`

The `Parser` class extends `DiagnosticEmitter` and wraps a `Tokenizer` instance (`tn`).

### Entry Points

```typescript
class Parser {
    static parseFile(path, src, getUid?, isEntry?): [Source, DiagnosticMessage[]]
    static parseSource(src, diagnostics?): DiagnosticMessage[]
    parseSource(): void
}
```

- `parseFile()` — Creates a `Source` from raw text, tokenizes, and parses. Returns the populated `Source` with its `statements` array filled.
- `parseSource()` — Parses an existing `Source` object.

The result is stored in `source.statements` (an array of `TopLevelStmt` nodes), not returned directly.

### Hoisting

**File:** `src/parser/hoistStatementsInplace.ts`

After parsing, `hoistStatementsInplace()` reorders top-level statements so that type declarations and function declarations appear before their use sites. This enables forward references without a separate declaration pass.

## Operator Precedence

**File:** `src/parser/Precedence.ts`

Expressions are parsed using precedence climbing. The `Precedence` enum defines levels from lowest to highest:

| Level | Name | Operators |
|-------|------|-----------|
| 0 | None | (no operator) |
| 1 | Comma | `,` |
| 2 | Spread | `...` |
| 3 | Assignment | `=` `+=` `-=` `*=` `/=` `%=` `**=` `<<=` `>>=` `>>>=` `&=` `^=` `\|=` `??=` |
| 4 | CaseExpr | `case ... is ... => ...` |
| 5 | Pipe | `\|>` (reserved for future pipe operator) |
| 6 | Conditional | `? :` (ternary) |
| 7 | LogicalOr | `\|\|` `??` |
| 8 | LogicalAnd | `&&` |
| 9 | BitwiseOr | `\|` |
| 10 | BitwiseXor | `^` |
| 11 | BitwiseAnd | `&` |
| 12 | Equality | `==` `!=` `===` `!==` |
| 13 | Relational | `<` `>` `<=` `>=` `as` `is` |
| 14 | Shift | `<<` `>>` `>>>` |
| 15 | Additive | `+` `-` |
| 16 | Multiplicative | `*` `/` `%` |
| 17 | Exponentiated | `**` |
| 18 | UnaryPrefix | `++x` `--x` `!x` `~x` `-x` |
| 19 | UnaryPostfix | `x++` `x--` |
| 20 | Call | `fn(...)` |
| 21 | MemberAccess | `.` `?.` `!.` `[...]` `!` (non-null) |
| 22 | Grouping | `(...)` |
| 23 | Literal | string, int, hex bytes, identifiers |

### `determinePrecedence(token): Precedence`

Maps a `Token` to its `Precedence` level. Used by `parseExpr()` to decide whether to continue parsing the current expression or return to the caller.

## Statement Parsing

`parseStatement()` dispatches on the current token to parse:

### Control Flow
| Statement | Token | Description |
|-----------|-------|-------------|
| `IfStmt` | `if` | Conditional branching with optional `else` |
| `ForStmt` | `for` | C-style `for(init; cond; step)` loops |
| `ForOfStmt` | `for` + `of` | `for(x of list)` iteration |
| `WhileStmt` | `while` | Condition-based loops |
| `MatchStmt` | `match` | Pattern matching with `when` clauses and optional `else` |
| `BreakStmt` | `break` | Loop exit |
| `ContinueStmt` | `continue` | Skip to next iteration |
| `ReturnStmt` | `return` | Function return |

### Declarations
| Statement | Token | Description |
|-----------|-------|-------------|
| `VarStmt` | `const`/`let`/`var` | Variable declarations with optional type annotation and initializer |
| `FuncDecl` | `function` | Named function declaration |
| `ContractDecl` | `contract` | Smart contract declaration with methods |
| `StructDecl` | `struct` | Struct type declaration (under `PebbleTypeDecl`) |
| `EnumDecl` | `enum` | Enum type declaration (under `PebbleTypeDecl`) |
| `InterfaceDecl` | `interface` | Interface declaration |
| `TypeImplementsStmt` | `type` + `implements` | Interface implementation |
| `UsingStmt` | `using` | Bring constructors into scope |

### Contract-Specific
| Statement | Token | Description |
|-----------|-------|-------------|
| `FailStmt` | `fail` | Explicit validation failure |
| `AssertStmt` | `assert` | Assertion with error message |
| `TraceStmt` | `trace` | Debug tracing |
| `TestStmt` | `test` | Test block declaration |

### Modules
| Statement | Token | Description |
|-----------|-------|-------------|
| `ImportStmt` | `import` | Named imports from module |
| `ImportStarStmt` | `import *` | Wildcard import |
| `ExportStmt` | `export` | Named exports |
| `ExportStarStmt` | `export *` | Re-export all |
| `ExportImportStmt` | `export` + `import` | Re-export from module |

### Other
| Statement | Token | Description |
|-----------|-------|-------------|
| `BlockStmt` | `{` | Block of statements |
| `EmptyStmt` | `;` | Empty statement |
| `AssignmentStmt` | (identifier) | Variable reassignment |

## Expression Parsing

`parseExpr(precedence)` implements precedence climbing:

1. Parse a primary expression (literal, identifier, unary, parenthesized, etc.)
2. While the next token has precedence >= the current level:
   a. Consume the operator
   b. Parse the right operand with the next higher precedence
   c. Build a binary/ternary node

### Primary Expressions

| Expression | Token | Description |
|------------|-------|-------------|
| `Identifier` | identifier | Variable/function name |
| `LitIntExpr` | integer | Integer literal |
| `LitStrExpr` | string | String literal |
| `LitHexBytesExpr` | `#...` | Hex bytes literal |
| `LitTrueExpr` | `true` | Boolean true |
| `LitFalseExpr` | `false` | Boolean false |
| `LitUndefExpr` | `undefined` | Undefined value |
| `LitVoidExpr` | `void` | Void value |
| `LitContextExpr` | `context` | Transaction context |
| `LitFailExpr` | `fail` | Fail expression |
| `LitArrExpr` | `[` | Array literal |
| `LitObjExpr` | `{` | Object literal |
| `LitNamedObjExpr` | Name `{` | Named constructor |
| `FuncExpr` | `function` / `(` / identifier `=>` | Function/arrow expression |
| `ParenthesizedExpr` | `(` | Parenthesized expression |

### Compound Expressions

| Expression | Syntax | Description |
|------------|--------|-------------|
| `BinaryExpr` | `a op b` | Binary operation (arithmetic, comparison, logical, bitwise) |
| `UnaryPrefixExpr` | `op a` | Prefix unary (`!`, `-`, `~`, `++`, `--`) |
| `NonNullExpr` | `a!` | Non-null assertion |
| `CallExpr` | `f(a, b)` | Function call |
| `PropAccessExpr` | `a.b` | Property access |
| `ElemAccessExpr` | `a[i]` | Element/index access |
| `TernaryExpr` | `c ? t : f` | Conditional expression |
| `CaseExpr` | `case v is P => e, ...` | Pattern matching expression |
| `TypeConversionExpr` | `a as T` | Type cast |

### Arrow Function Detection

The parser uses lookahead (`isArrowFuncOrParenExprLookahead()`) to distinguish between:
- Parenthesized expression: `(a + b)`
- Arrow function: `(a, b) => a + b`

This is resolved by scanning ahead for `=>` after the closing `)`.

## Variable Declarations

`parseVarStmt()` handles multiple declaration forms:

### Simple Declaration
```
const x: int = 42;
let y = "hello";
var z: bytes;
```

### Destructuring
```
// Single constructor destructuring
const MyStruct{ field1, field2 } = expr;

// Named object destructuring
const { a, b, c } = expr;

// Array-like destructuring
const [ first, second, ...rest ] = expr;
```

## Type Expressions

`parseTypeExpr()` parses type annotations:

| Type | Syntax | Description |
|------|--------|-------------|
| Native | `int`, `bytes`, `boolean`, `void` | Built-in types |
| Named | `MyStruct` | User-defined types |
| Optional | `Optional<T>` | Optional wrapper |
| List | `List<T>` | List type |
| LinearMap | `LinearMap<K, V>` | Map type |
| Function | `(a: int, b: bytes) => boolean` | Function type |
| Generic | `T` | Type parameter |

## Contract Parsing

`parseContractDecl()` parses smart contract definitions:

```
contract Name {
    param paramName: Type;

    spend(datum, redeemer) { ... }
    mint(redeemer) { ... }
    certify(cert) { ... }
    withdraw(redeemer) { ... }
    propose(procedure) { ... }
    vote(voter) { ... }
}
```

Each method type has its own argument structure matching the Cardano validator interface.

## Error Recovery

When the parser encounters unexpected tokens:
1. Reports a diagnostic with the expected vs actual token
2. Calls `skipStatement()` to advance past the problematic construct
3. `skipBlock()` can skip matched `{...}` blocks
4. Continues parsing from the next recognizable statement boundary

This allows the parser to report multiple errors in a single pass rather than aborting on the first error.

## Pattern Matching

`parseMatchStatement()` handles pattern matching:

```
match value {
    when Pattern1 => { ... }
    when Pattern2(a, b) => { ... }
    else => { ... }
}
```

Patterns can be:
- Constructor patterns with bindings
- Literal patterns
- Wildcard (`else`)
