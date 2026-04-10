# Abstract Syntax Tree (AST)

The AST (`src/ast/`) represents the syntactic structure of a Pebble program after parsing. It is untyped — nodes carry syntactic information but no resolved type data. The AST compiler later transforms this into the typed TIR.

## Top-Level Union

**File:** `src/ast/PebbleAst.ts`

```typescript
type PebbleAst = VarDecl | TopLevelStmt | BodyStmt | PebbleExpr
               | AstTypeExpr | Identifier | PebbleTypeDecl
```

## Source

**File:** `src/ast/Source/Source.ts`

A `Source` represents a single source file in the compilation:

| Property | Type | Description |
|----------|------|-------------|
| `sourceKind` | `SourceKind` | `User`, `UserEntry`, `Library`, or `LibraryEntry` |
| `absoluteProjPath` | `string` | Normalized file path with extension |
| `uid` | `number` | Unique identifier for this source |
| `text` | `string` | Full source text |
| `statements` | `TopLevelStmt[]` | Parsed top-level statements |

`SourceKind` distinguishes between user code and library code, and marks which file is the compilation entry point.

The `Source` object also provides line/column lookup from character positions, with a cached line map built incrementally as the tokenizer encounters newlines.

## Statements

### TopLevelStmt

Statements allowed at file scope:

| Node | Description |
|------|-------------|
| `EmptyStmt` | Empty statement (`;`) |
| `VarStmt` | Variable declaration (`const`, `let`, `var`) |
| `FuncDecl` | Function declaration |
| `PebbleTypeDecl` | Type declaration (`StructDecl` or `EnumDecl`) |
| `InterfaceDecl` | Interface declaration |
| `TypeImplementsStmt` | Interface implementation binding |
| `ContractDecl` | Smart contract declaration |
| `TestStmt` | Test block |
| `UsingStmt` | Constructor scope import |
| `ExportStmt` | Named export |
| `ExportStarStmt` | Wildcard re-export |
| `ExportImportStmt` | Re-export from module |
| `ImportStmt` | Named import |
| `ImportStarStmt` | Wildcard import |

### BodyStmt

Statements allowed inside function/method bodies:

| Node | Description |
|------|-------------|
| `IfStmt` | Conditional branching |
| `ForStmt` | C-style for loop |
| `ForOfStmt` | For-of iteration |
| `WhileStmt` | While loop |
| `MatchStmt` | Pattern matching |
| `BlockStmt` | Block of statements |
| `ReturnStmt` | Return from function |
| `BreakStmt` | Break from loop |
| `ContinueStmt` | Continue to next iteration |
| `VarStmt` | Variable declaration |
| `AssignmentStmt` | Variable reassignment |
| `UsingStmt` | Constructor scope import |
| `FailStmt` | Explicit failure |
| `AssertStmt` | Assertion |
| `TraceStmt` | Debug tracing |
| `EmptyStmt` | Empty statement |

### Key Statement Structures

#### VarStmt

Contains one or more `VarDecl` nodes. Each `VarDecl` is one of:

| Variant | Description |
|---------|-------------|
| `SimpleVarDecl` | `const x: T = expr` — simple name binding |
| `SingleDeconstructVarDecl` | `const Ctor{ a, b } = expr` — single constructor destructuring |
| `NamedDeconstructVarDecl` | `const { a, b } = expr` — named field destructuring |
| `ArrayLikeDeconstr` | `const [ a, b, ...rest ] = expr` — positional destructuring |

All variants carry:
- `flags` — `const`, `let`, or `var` modifier
- `typeExpr?` — optional type annotation
- `initializer?` — optional initialization expression

#### IfStmt
```
{ condition: PebbleExpr, thenBody: BodyStmt, elseBody?: BodyStmt | IfStmt }
```
`else if` chains are represented as nested `IfStmt` in the `elseBody`.

#### ForStmt
```
{ init?: VarStmt | AssignmentStmt, condition?: PebbleExpr, step?: AssignmentStmt, body: BodyStmt }
```

#### ForOfStmt
```
{ varName: Identifier, iterable: PebbleExpr, body: BodyStmt }
```

#### MatchStmt
```
{ expr: PebbleExpr, cases: MatchCase[], elseBody?: BodyStmt }
```
Each `MatchCase` has a pattern and a body.

#### ContractDecl
```
{ name: Identifier, params: ParamDecl[], methods: MethodDecl[] }
```
Methods are typed by purpose: `spend`, `mint`, `certify`, `withdraw`, `propose`, `vote`.

#### FuncDecl
```
{ name: Identifier, typeParams?: TypeParam[], params: ParamDecl[], returnType?: AstTypeExpr, body: BlockStmt }
```

## Expressions

### PebbleExpr Union

All expression node types:

#### Literals (`LitteralExpr`)

| Node | Value Type | Example |
|------|-----------|---------|
| `LitIntExpr` | `bigint` | `42`, `0xff` |
| `LitStrExpr` | `string` | `"hello"` |
| `LitHexBytesExpr` | `Uint8Array` | `#aabbcc` |
| `LitTrueExpr` | `boolean` | `true` |
| `LitFalseExpr` | `boolean` | `false` |
| `LitUndefExpr` | — | `undefined` |
| `LitVoidExpr` | — | `void` |
| `LitContextExpr` | — | `context` |
| `LitFailExpr` | `PebbleExpr?` | `fail` or `fail(msg)` |
| `LitArrExpr` | `PebbleExpr[]` | `[1, 2, 3]` |
| `LitObjExpr` | `ObjField[]` | `{ a: 1, b: 2 }` |
| `LitNamedObjExpr` | `Identifier, ObjField[]` | `MyStruct { x: 1 }` |

#### Operators

| Node | Structure | Description |
|------|-----------|-------------|
| `BinaryExpr` | `{ left, op, right }` | Binary operation |
| `UnaryPrefixExpr` | `{ op, operand }` | Prefix unary (`!`, `-`, `~`, `++`, `--`) |
| `NonNullExpr` | `{ operand }` | Non-null assertion (`x!`) |

`BinaryExpr` has subtypes for specific operations: `AddExpr`, `SubtractExpr`, `MultiplyExpr`, `DivideExpr`, `ModuloExpr`, `PowerExpr`, `EqualExpr`, `NotEqualExpr`, `StrictEqualExpr`, `StrictNotEqualExpr`, `LessThanExpr`, `GreaterThanExpr`, etc.

#### Access & Call

| Node | Structure | Description |
|------|-----------|-------------|
| `CallExpr` | `{ callee, args }` | Function call |
| `PropAccessExpr` | `{ object, property, optional? }` | Property access (`.`, `?.`, `!.`) |
| `ElemAccessExpr` | `{ object, index }` | Element access (`[i]`) |

#### Functions

| Node | Structure | Description |
|------|-----------|-------------|
| `FuncExpr` | `{ params, returnType?, body, arrowKind? }` | Function expression |

`arrowKind` distinguishes arrow functions (`=>`) from regular `function` expressions.

#### Other

| Node | Structure | Description |
|------|-----------|-------------|
| `TernaryExpr` | `{ condition, thenExpr, elseExpr }` | Ternary conditional |
| `CaseExpr` | `{ value, cases }` | Pattern matching expression |
| `TypeConversionExpr` | `{ expr, targetType }` | Type cast (`as`) |
| `ParenthesizedExpr` | `{ expr }` | Parenthesized expression |
| `Identifier` | `{ name }` | Variable/function reference |

## Type Expressions

### AstTypeExpr Union

Type annotations in the AST:

#### Native Types (`AstNativeTypeExpr`)

| Node | Syntax | Description |
|------|--------|-------------|
| `AstIntType` | `int` | Integer type |
| `AstBooleanType` | `boolean` | Boolean type |
| `AstBytesType` | `bytes` | Byte string type |
| `AstVoidType` | `void` | Void/unit type |
| `AstNativeOptionalType` | `Optional<T>` | Optional type (generic) |
| `AstListType` | `List<T>` | List type (generic) |
| `AstLinearMapType` | `LinearMap<K, V>` | Key-value map type (generic) |
| `AstFuncType` | `(params) => ReturnType` | Function type |

#### Named Types (`AstNamedTypeExpr`)
User-defined types referenced by name, with optional generic type arguments:
```
MyStruct
MyGeneric<int, bytes>
```

## Common Nodes

### Identifier

**File:** `src/ast/nodes/common/Identifier.ts`

```typescript
interface Identifier {
    name: string;
    pos: number;     // Start position in source
    end: number;     // End position in source
}
```

All name references in the AST use `Identifier` nodes, which carry source position for diagnostics.

## Node Position Tracking

Every AST node carries `pos` (start) and `end` (exclusive end) character positions in the source text. These are used by:
- The diagnostics system to report error locations with line/column
- The AST compiler for source mapping
- Pretty-printing and IDE integration

## Type Declarations

### StructDecl
```typescript
{
    name: Identifier,
    typeParams?: TypeParam[],
    fields: StructField[]
}
```
Each `StructField` has a name, type annotation, and optional flags (readonly, etc.).

### EnumDecl
```typescript
{
    name: Identifier,
    typeParams?: TypeParam[],
    constructors: EnumConstructor[]
}
```
Each `EnumConstructor` has a name and optional fields, forming a sum type.

### InterfaceDecl
```typescript
{
    name: Identifier,
    typeParams?: TypeParam[],
    methods: InterfaceMethod[]
}
```
