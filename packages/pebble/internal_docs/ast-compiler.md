# AST Compiler

The AST compiler (`src/compiler/AstCompiler/`) transforms the untyped AST into a typed intermediate representation (TIR / `TypedProgram`). It performs type checking, type inference, symbol resolution, and scope management — bridging syntax and semantics.

## Architecture

**File:** `src/compiler/AstCompiler/AstCompiler.ts`

```typescript
class AstCompiler {
    constructor(
        readonly cfg: CompilerOptions,
        readonly io: CompilerIoApi,
        diagnostics?: DiagnosticMessage[]
    )
}
```

### Key Properties

| Property | Type | Description |
|----------|------|-------------|
| `program` | `TypedProgram` | The output typed program being built |
| `cfg` | `CompilerOptions` | Compilation configuration |
| `io` | `CompilerIoApi` | File I/O abstraction |
| `preludeScope` | `AstScope` | Standard library scope (built-in types and functions) |
| `parsedAstSources` | `Map<string, Source>` | Cache of already-parsed source files |

### Main Methods

| Method | Description |
|--------|-------------|
| `compile()` | Full compilation: parse → type check → produce TypedProgram |
| `check()` | Type checking only, returns diagnostics without full compilation |
| `export(funcName, modulePath?)` | Compile and export a specific function |
| `run()` | Compile and execute via the UPLC machine |
| `runRepl()` | Interactive REPL mode |

## Compilation Flow

1. **Source Loading** — Read entry file via `io.readFile()`, create `Source` object
2. **Parsing** — Tokenize and parse using `Parser.parseFile()`
3. **Import Resolution** — Recursively load and parse imported modules
4. **Scope Construction** — Build scope hierarchy from declarations
5. **Type Declaration Compilation** — Process struct, enum, interface, type alias declarations
6. **Function Compilation** — Compile function bodies with type checking
7. **Contract Compilation** — Process contract declarations and methods
8. **TypedProgram Assembly** — Register all compiled definitions in the output program

## Compilation Context

**File:** `src/compiler/AstCompiler/AstCompilationCtx.ts`

The `AstCompilationCtx` tracks state during AST traversal:

- Current scope reference
- Expected return type (for type checking returns)
- Current function context
- Contract context (if inside a contract)
- Loop nesting depth (for break/continue validation)
- Diagnostic accumulation

The context is passed through all compilation functions and updated as scopes are entered/exited.

## Scope Management

**File:** `src/compiler/AstCompiler/scope/AstScope.ts`

Scopes form a tree mirroring the lexical structure of the program:

```
File Scope (top-level declarations)
  └── Function Scope (parameters + local vars)
        └── Block Scope (if/for/while body vars)
              └── Block Scope (nested blocks)
```

### Scope Operations

| Operation | Description |
|-----------|-------------|
| Symbol lookup | Walk up scope chain to find a name's definition |
| Symbol insertion | Add a new binding to the current scope |
| Type lookup | Resolve a type name to its TIR type |
| Function name mapping | Map AST names to unique TIR function names |
| Conflict detection | Report duplicate declarations in the same scope |

### Prelude Scope

The prelude scope contains all built-in types and functions available without import:
- Native types: `int`, `bytes`, `boolean`, `void`, `data`
- Generic types: `Optional`, `List`, `LinearMap`
- Built-in functions and operations

## Internal Compilation

### Expression Compilation

**File:** `src/compiler/AstCompiler/internal/exprs/_compileExpr.ts`

`_compileExpr()` dispatches on the AST expression kind:

| AST Expression | TIR Result | Notes |
|----------------|------------|-------|
| `Identifier` | `TirVariableAccessExpr` | Resolved via scope lookup |
| `LitIntExpr` | `TirLitIntExpr` | Direct mapping |
| `LitStrExpr` | `TirLitStrExpr` | Direct mapping |
| `LitHexBytesExpr` | `TirLitHexBytesExpr` | Direct mapping |
| `LitTrueExpr` / `LitFalseExpr` | `TirLitTrueExpr` / `TirLitFalseExpr` | Direct mapping |
| `BinaryExpr` | `TirBinaryExpr` | Type-checked operands |
| `UnaryPrefixExpr` | `TirUnaryPrefixExpr` | Type-checked operand |
| `CallExpr` | `TirCallExpr` | Argument types validated against function signature |
| `PropAccessExpr` | `TirPropAccessExpr` | Field existence and type resolved |
| `ElemAccessExpr` | `TirElemAccessExpr` | Index type checked |
| `FuncExpr` | `TirFuncExpr` | Parameters and body compiled in new scope |
| `TernaryExpr` | `TirTernaryExpr` | Condition must be boolean, branches unified |
| `CaseExpr` | `TirCaseExpr` | Patterns validated, exhaustiveness checked |
| `TypeConversionExpr` | `TirTypeConversionExpr` | Cast validity checked |
| `LitArrExpr` | `TirLitArrExpr` | Element types unified |
| `LitObjExpr` | `TirLitObjExpr` | Field types inferred |
| `LitNamedObjExpr` | `TirLitNamedObjExpr` | Constructor and field types validated |

### Statement Compilation

**File:** `src/compiler/AstCompiler/internal/statements/_compileStatement.ts`

`_compileStatement()` dispatches on the AST statement kind:

| AST Statement | TIR Result | Notes |
|---------------|------------|-------|
| `VarStmt` | `TirVarDecl` | Type inference from initializer or annotation |
| `IfStmt` | `TirIfStmt` | Condition type-checked as boolean |
| `ForStmt` | `TirForStmt` | Init, condition, step compiled in loop scope |
| `ForOfStmt` | `TirForOfStmt` | Iterable must be `List<T>`, var bound as `T` |
| `WhileStmt` | `TirWhileStmt` | Condition type-checked as boolean |
| `ReturnStmt` | `TirReturnStmt` | Return type checked against function signature |
| `MatchStmt` | `TirMatchStmt` | Patterns type-checked, bindings created |
| `AssignmentStmt` | `TirAssignmentStmt` | Target must be mutable, type must match |
| `FailStmt` | `TirFailStmt` | Optional error message compiled |
| `AssertStmt` | `TirAssertStmt` | Condition type-checked as boolean |
| `TraceStmt` | `TirTraceStmt` | Message compiled |
| `BlockStmt` | `TirBlockStmt` | New scope opened |

### Type Compilation

**Files:** `src/compiler/AstCompiler/internal/types/`

Two encoding strategies for user-defined types:

#### Data-Encoded Types (`_compileDataEncodedConcreteType`)
Types serialized in Plutus Data format (CBOR-encoded). Used for types that cross the on-chain boundary (datum, redeemer). Produces `TirDataStructType`.

#### SoP-Encoded Types (`_compileSopEncodedConcreteType`)
Types using Sum-of-Products encoding native to UPLC. More efficient for internal computation but not directly serializable as Plutus Data. Produces `TirSoPStructType`.

## Type Checking

### Type Inference
- Variable types inferred from initializer expressions when no annotation is given
- Function return types inferred from body when not annotated
- Generic type parameters resolved at call sites
- Binary operator result types determined from operand types

### Type Validation
- Assignment targets must be compatible with source types
- Function arguments must match parameter types
- Return values must match declared return types
- Pattern match arms must cover the scrutinee type

### Type Compatibility (`canAssignTo`)
**File:** `src/compiler/tir/types/utils/canAssignTo.ts`

Returns a `CanAssign` enum indicating whether a value of one type can be assigned to a target of another type:
- Direct match (same type)
- Subtype relationship (struct implementing interface)
- Data encoding compatibility
- Generic instantiation

### Type Casting (`canCastTo`)
**File:** `src/compiler/tir/types/utils/canCastTo.ts`

Validates explicit `as` casts. Allows conversions between related types that wouldn't be implicitly assignable.

## Module System

### Import Resolution

When the compiler encounters an `ImportStmt`:
1. Resolve the module path relative to the importing file
2. Check `parsedAstSources` cache for already-parsed sources
3. If not cached, load via `io.readFile()`, parse, and cache
4. Look up exported names in the module's scope
5. Import the resolved symbols into the current scope

### Export Handling

Exports mark declarations as visible to importing modules. The scope tracks which names are exported and validates that exported names refer to existing declarations.

## Diagnostic Reporting

The AST compiler reports diagnostics through the inherited `DiagnosticEmitter`:

| Category | Examples |
|----------|---------|
| Type errors | Type mismatch in assignment, wrong argument type |
| Name errors | Undefined variable, duplicate declaration |
| Scope errors | Break outside loop, return outside function |
| Import errors | Module not found, name not exported |
| Contract errors | Invalid method signature, missing required methods |

Each diagnostic includes source location (file, line, column), severity (error/warning/info), and a descriptive message.
