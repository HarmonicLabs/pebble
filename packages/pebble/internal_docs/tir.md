# Typed Intermediate Representation (TIR)

The TIR (`src/compiler/tir/`) is the frontend-facing intermediate representation. It mirrors the AST's imperative structure but carries complete type information. The TIR bridges syntax (AST) and backend compilation (IR).

## TypedProgram

**File:** `src/compiler/tir/program/TypedProgram.ts`

The central container for a fully type-checked program:

| Property | Type | Description |
|----------|------|-------------|
| `functions` | `Map<TirFuncName, TirFuncExpr>` | All compiled functions by unique name |
| `types` | `Map<TirTypeName, TirType>` | All type definitions |
| `preludeScope` | scope | Standard library types and functions |
| `mainFunc` | `TirFuncExpr` | Entry point function |

### Key Methods

| Method | Description |
|--------|-------------|
| `getMainOrThrow()` | Returns entry function, throws if missing |
| `getFunction(name)` | Retrieves a typed function by name |
| `getType(name)` | Retrieves a type definition by name |

Contract-specific methods produce validator scripts:
- `contract()` — general contract compilation
- `spawn()` / `mint()` / `certify()` — specific validator entry points

## Type System

**File:** `src/compiler/tir/types/`

### Type Hierarchy

```
TirType
├── TirNativeType           Built-in types
│   ├── TirIntT             int
│   ├── TirBoolT            boolean
│   ├── TirBytesT           bytes
│   ├── TirStringT          string
│   ├── TirVoidT            void
│   ├── TirDataT            Plutus Data
│   ├── TirListT<T>         List<T>
│   ├── TirFuncT            Function types
│   ├── TirLinearMapT<K,V>  LinearMap<K,V>
│   ├── TirDataOptT<T>      Optional<T> (data-encoded)
│   ├── TirSopOptT<T>       Optional<T> (SoP-encoded)
│   ├── TirUnConstrDataResultT  unConstrData result pair
│   └── TirPairDataT        Pair of Data values
├── TirCustomType           User-defined types
│   ├── TirDataStructType   Data-encoded struct
│   ├── TirSoPStructType    SoP-encoded struct
│   ├── TirAliasType        Type alias
│   └── TirInterfaceType    Interface definition
└── TirTypeParam            Generic type parameter
```

### ITirType Interface

All types implement:

| Method | Description |
|--------|-------------|
| `toString()` | Human-readable type name |
| `toTirTypeKey()` | Unique identifier for type comparison |
| `toAstName()` | Original name from source code |
| `toUplcConstType()` | UPLC constant type (for native types) |

### Native Types

| Type | Description | UPLC Encoding |
|------|-------------|---------------|
| `TirIntT` | Arbitrary-precision integer | `integer` |
| `TirBoolT` | Boolean value | `bool` (SoP) |
| `TirBytesT` | Raw byte string | `bytestring` |
| `TirStringT` | UTF-8 text string | `string` |
| `TirVoidT` | Unit/void | `unit` |
| `TirDataT` | Plutus Data | `data` |
| `TirListT<T>` | Homogeneous list | `list` |
| `TirFuncT` | Function type | lambda |
| `TirLinearMapT<K,V>` | Ordered key-value map | `list` of pairs |

### Struct Types

Structs can be encoded in two ways:

#### Data-Encoded (`TirDataStructType`)
Serialized as Plutus Data (Constr with fields). Used for types that cross the on-chain boundary:
- Datum types
- Redeemer types
- Types stored in UTxOs

#### SoP-Encoded (`TirSoPStructType`)
Uses UPLC's native Sum-of-Products encoding (Constr/Case). More efficient for computation:
- Internal computation types
- Types that never leave the validator

Both struct types contain:
- `constructors: TirStructConstr[]` — one or more constructors
- Each constructor has `fields: TirStructField[]` with names and types
- Constructor index for pattern matching

### Type Aliases (`TirAliasType`)
Wraps another `TirType` with a new name. `getUnaliased()` recursively unwraps aliases.

### Interface Types (`TirInterfaceType`)
Defines method signatures that types can implement. Used with `TypeImplementsStmt` to bind implementations.

### Type Parameters (`TirTypeParam`)
Generic type variables identified by `symbol`. Resolved at instantiation sites.

### Type Utilities

**File:** `src/compiler/tir/types/utils/`

| Utility | Description |
|---------|-------------|
| `canAssignTo(source, target)` | Type compatibility check, returns `CanAssign` enum |
| `canCastTo(source, target)` | Explicit cast validity check |
| `getUnaliased(type)` | Recursively unwrap alias types |
| `getListTypeArg(type)` | Extract element type from `List<T>` |
| `getOptTypeArg(type)` | Extract inner type from `Optional<T>` |
| `getDeconstructableType(type)` | Check if type supports destructuring |

## Expressions

**File:** `src/compiler/tir/expressions/`

TIR expressions extend AST expressions with resolved type information. Every `TirExpr` has a `type: TirType` property.

### ITirExpr Interface

| Property/Method | Description |
|-----------------|-------------|
| `type` | Resolved TIR type of this expression |
| `isConstant` | Whether the expression is a compile-time constant |
| `deps` | Dependencies on other definitions |
| `toIR()` | Convert to backend IR term |
| `clone()` | Deep copy |
| `toString()` | Debug string representation |

### Literal Expressions

| Expression | Type | Description |
|------------|------|-------------|
| `TirLitIntExpr` | `TirIntT` | Integer constant |
| `TirLitStrExpr` | `TirStringT` | String constant |
| `TirLitHexBytesExpr` | `TirBytesT` | Hex bytes constant |
| `TirLitTrueExpr` | `TirBoolT` | Boolean true |
| `TirLitFalseExpr` | `TirBoolT` | Boolean false |
| `TirLitVoidExpr` | `TirVoidT` | Void value |
| `TirLitUndefExpr` | `TirVoidT` | Undefined value |
| `TirLitThisExpr` | context | Self-reference in contract |
| `TirLitFailExpr` | — | Fail with optional message |
| `TirLitArrExpr` | `TirListT<T>` | Array/list literal |
| `TirLitObjExpr` | struct | Anonymous struct literal |
| `TirLitNamedObjExpr` | struct | Named constructor call |

### Operator Expressions

| Expression | Description |
|------------|-------------|
| `TirBinaryExpr` | Binary operation with typed operands |
| `TirUnaryPrefixExpr` | Prefix unary with typed operand |
| `TirUnaryMinus` | Numeric negation |
| `TirUnaryPlus` | Numeric identity |
| `TirUnaryExclamation` | Logical negation |
| `TirUnaryTilde` | Bitwise complement |

### Access & Call Expressions

| Expression | Description |
|------------|-------------|
| `TirVariableAccessExpr` | Typed variable reference |
| `TirCallExpr` | Typed function call with resolved overload |
| `TirPropAccessExpr` | Typed property access with resolved field |
| `TirElemAccessExpr` | Typed element access |

### Function Expressions

| Expression | Description |
|------------|-------------|
| `TirFuncExpr` | Typed function with parameter types and return type |

### Control Flow Expressions

| Expression | Description |
|------------|-------------|
| `TirTernaryExpr` | Typed ternary with unified branch types |
| `TirCaseExpr` | Typed pattern matching expression |

### Backend-Oriented Expressions

These expressions are introduced by the AST compiler for backend compilation and have no direct AST counterpart:

| Expression | Description |
|------------|-------------|
| `TirHoistedExpr` | Reference to a hoisted (shared) definition |
| `TirLettedExpr` | Let-bound expression (locally scoped) |
| `TirFromDataExpr` | Deserialize value from Plutus Data |
| `TirToDataExpr` | Serialize value to Plutus Data |
| `TirAssertAndContinueExpr` | Assertion with continuation (doesn't branch) |
| `TirTraceExpr` | Trace message output |
| `TirTraceIfFalseExpr` | Conditional trace on false condition |
| `TirFailExpr` | Explicit failure |
| `TirNativeFunc` | Reference to a native/builtin function |
| `TirInlineClosedIR` | Inline pre-compiled IR term |
| `TirTypeConversionExpr` | Explicit type conversion |

## Statements

**File:** `src/compiler/tir/statements/`

TIR statements mirror AST statements with added type information.

### Termination Analysis

The `Termination` enum tracks control flow:
- `None` — statement continues normally
- `Return` — statement always returns
- `Break` — statement always breaks
- `Continue` — statement always continues
- `Fail` — statement always fails

This is used during expressification to determine which branches are terminal.

### Variable Declarations (`TirVarDecl`)

| Variant | Description |
|---------|-------------|
| `TirSimpleVarDecl` | Simple typed binding |
| `TirSingleDeconstructVarDecl` | Single constructor destructuring with typed fields |
| `TirNamedDeconstructVarDecl` | Named field destructuring with typed fields |
| `TirArrayLikeDeconstr` | Array destructuring with element types |

### Control Flow Statements

| Statement | Description |
|-----------|-------------|
| `TirIfStmt` | Typed conditional with termination analysis |
| `TirForStmt` | Typed for loop with typed init/condition/step |
| `TirForOfStmt` | Typed for-of with element type from list |
| `TirWhileStmt` | Typed while loop |
| `TirReturnStmt` | Typed return with value type checking |
| `TirBreakStmt` | Break (validated to be inside loop) |
| `TirContinueStmt` | Continue (validated to be inside loop) |
| `TirBlockStmt` | Typed block with statement list |
| `TirMatchStmt` | Typed pattern match with exhaustiveness info |

### Assignment & Mutation

| Statement | Description |
|-----------|-------------|
| `TirAssignmentStmt` | Typed assignment with mutability validation |

### Assertion & Error

| Statement | Description |
|-----------|-------------|
| `TirAssertStmt` | Typed assertion (condition must be boolean) |
| `TirFailStmt` | Typed explicit failure |
| `TirTraceStmt` | Typed trace output |

## TIR Compiler (Expressification)

**File:** `src/compiler/TirCompiler/`

The TIR compiler converts TIR (typed, statement-based) to IR (untyped, expression-based).

### Main Entry Point

**File:** `src/compiler/TirCompiler/compileTirProgram.ts`

```typescript
function compileTypedProgram(cfg: CompilerOptions, tirProgram: TypedProgram): IRTerm
```

1. Expressifies all functions in the program
2. Converts the main function's TIR to IR via `toIR()`
3. Returns the root `IRTerm`

### Expressification Engine

**File:** `src/compiler/TirCompiler/expressify/expressify.ts`

Converts imperative statement-based function bodies to pure functional expressions.

#### Core Transformations

| Statement | Expression Form |
|-----------|----------------|
| Variable declaration | Let-binding: `(λvar. rest)(value)` |
| Assignment | New let-binding shadowing previous variable |
| `if` statement | Ternary or case expression |
| `for` loop | Recursive function with condition check |
| `while` loop | Recursive function with condition check |
| `for...of` loop | Recursive traversal of list |
| `return` | Direct expression value |
| `break` | Return value from recursive loop function |
| `continue` | Recursive call to loop body |
| `match` | Nested case expressions |
| `assert` | Assert-and-continue expression |
| `fail` | Error term |
| `trace` | Trace expression wrapping continuation |
| Block | Nested expressification of statements |

#### ExpressifyCtx

**File:** `src/compiler/TirCompiler/expressify/ExpressifyCtx.ts`

Tracks state during expressification:

| Property | Description |
|----------|-------------|
| Variable shadowing | SSA-like renaming for reassigned variables |
| Function parameters | Current function's parameter symbols |
| Letted constants | Accumulated let-bindings |
| Object properties | Struct field access tracking |
| Parent context | Scope chain for nested functions |

#### Reassignment Analysis

**File:** `src/compiler/TirCompiler/expressify/determineReassignedVariablesAndReturn.ts`

Before expressifying control flow (if, loops), analyzes which variables are reassigned in each branch. This determines:
- Which variables need to be "returned" from branches (via SoP wrapping)
- Whether early return/break occurs
- How to merge variable states after branches rejoin

#### SoP Wrapping

When a control flow construct (if, loop) reassigns variables, the expressifier wraps the result in a Sum-of-Products type:
- Constructor 0: normal continuation with updated variable values
- Constructor 1: early return with return value
- Constructor 2: break (in loops)

The caller then deconstructs this SoP to extract the updated state or handle the early exit.

#### Loop Expressification

**File:** `src/compiler/TirCompiler/expressify/expressifyForStmt.ts`

Loops become recursive functions:

```
// for(let i = 0; i < n; i++) { body }
// becomes:
(λloop. loop(0))(
    recursive loop(i) =>
        case (i < n) {
            true  => let bodyResult = expressify(body) in loop(i + 1)
            false => continuation
        }
)
```

Break and continue are handled by returning different SoP constructors from the recursive function.
