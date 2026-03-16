# Intermediate Representation (IR)

The IR (`src/IR/`) is the backend intermediate representation. It is untyped and purely expression-based, mapping directly to UPLC's lambda calculus model. The IR sits between the typed TIR and the final UPLC output.

## IR Node Kinds

**File:** `src/IR/IRNodeKind.ts`

```typescript
enum IRNodeKind {
    Var         = 0,   // Variable reference
    Func        = 1,   // Lambda abstraction
    App         = 2,   // Function application
    Const       = 3,   // Constant value
    Native      = 4,   // Builtin operation
    Letted      = 5,   // Let-binding (locally scoped)
    Hoisted     = 6,   // Hoisted to top scope (closed term)
    Error       = 7,   // Error / divergence
    Forced      = 8,   // Force (evaluate delayed computation)
    Delayed     = 9,   // Delay (create thunk)
    Constr      = 10,  // Data constructor
    Case        = 11,  // Pattern matching / case expression
    Recursive   = 12,  // Recursive binding (intermediate)
    SelfCall    = 13,  // Self-call in recursion (intermediate)
    SopDeconstr = 14   // Sum-of-Products deconstruction
}
```

## IRTerm Union

**File:** `src/IR/IRTerm.ts`

```typescript
type IRTerm = IRVar | IRFunc | IRApp | IRConst | IRNative | IRLetted | IRHoisted
            | IRError | IRForced | IRDelayed | IRConstr | IRCase | IRRecursive | IRSelfCall
```

### IIRTerm Interface

All IR nodes implement:

| Property/Method | Description |
|-----------------|-------------|
| `kind` | `IRNodeKind` discriminator |
| `parent` | Reference to parent node (for tree traversal) |
| `hash` | Content-based hash for structural comparison |
| `children()` | Returns child IR terms |
| `toUPLC(ctx)` | Converts to UPLC term |
| `clone()` | Deep copy with fresh symbols |
| `toJson()` | JSON serialization |

## Core Nodes

### IRVar — Variable Reference

**File:** `src/IR/IRNodes/IRVar.ts`

| Property | Type | Description |
|----------|------|-------------|
| `name` | `symbol` | Unique variable identifier |

Represents a reference to a bound variable. During UPLC generation, the symbol is resolved to a De Bruijn index via the compilation context.

```typescript
toUPLC(ctx: ToUplcCtx): UPLCVar {
    return new UPLCVar(ctx.getVarAccessDbn(this.name));
}
```

### IRFunc — Lambda Abstraction

**File:** `src/IR/IRNodes/IRFunc.ts`

| Property | Type | Description |
|----------|------|-------------|
| `params` | `symbol[]` | Parameter names (one or more) |
| `body` | `IRTerm` | Function body |
| `arity` | `number` | Number of parameters |

Multi-parameter functions are syntactic sugar — they expand to nested single-parameter lambdas during UPLC generation:

```
IRFunc([a, b, c], body)
→ Lambda(a, Lambda(b, Lambda(c, body)))
```

### IRApp — Function Application

**File:** `src/IR/IRNodes/IRApp.ts`

| Property | Type | Description |
|----------|------|-------------|
| `fn` | `IRTerm` | Function to apply |
| `arg` | `IRTerm` | Argument value |

Standard beta-reducible application. Chains of applications represent curried calls:

```
f(a, b, c) → App(App(App(f, a), b), c)
```

### IRConst — Constant Value

**File:** `src/IR/IRNodes/IRConst.ts`

| Property | Type | Description |
|----------|------|-------------|
| `value` | UPLC constant | Integer, bytestring, string, bool, unit, data, or list |

Wraps a UPLC constant value. Converts directly to `UPLCConst` during code generation.

### IRNative — Builtin Operation

**File:** `src/IR/IRNodes/IRNative/`

| Property | Type | Description |
|----------|------|-------------|
| `tag` | native tag | Identifies the specific builtin |

References a UPLC builtin function (e.g., `addInteger`, `ifThenElse`, `headList`). Some natives are Pebble-internal (e.g., `id`, `not`, `increment`) and are expanded to their IR equivalents by the `replaceNatives` optimization pass before UPLC generation.

Natives are identified by numeric tags. The native index also encodes force requirements — negative tags indicate natives that need force wrappers.

### IRLetted — Let-Binding

**File:** `src/IR/IRNodes/IRLetted.ts`

| Property | Type | Description |
|----------|------|-------------|
| `name` | `symbol` | Bound variable name |
| `value` | `IRTerm` | Expression to bind |
| `body` | `IRTerm` | Continuation using the binding |
| `meta` | object | Optimization metadata (`forceHoist`, usage count) |

Represents a local let-binding. The optimization pipeline decides whether to:
- **Inline** the value (single-use or small)
- **Keep as let** (multiple uses, placed at optimal scope)
- **Promote to hoisted** (closed term, globally reusable)

During UPLC generation, becomes `(λname. body)(value)`.

### IRHoisted — Hoisted Definition

**File:** `src/IR/IRNodes/IRHoisted.ts`

| Property | Type | Description |
|----------|------|-------------|
| `name` | `symbol` | Definition name |
| `hoisted` | `IRTerm` | The hoisted expression (must be closed) |
| `body` | `IRTerm` | Continuation using the hoisted name |
| `meta` | object | Optimization metadata (`forceHoist`) |

A closed term (no free variables) extracted to top-level scope. This enables sharing — if the same computation appears in multiple branches, it's computed once and referenced by variable.

Hoisted terms are fundamentally different from letted: they have no free variables and can be placed at any scope level. The trade-off is that all hoisted terms are evaluated at script startup, even if some branches never use them.

Uses `WeakRef` caching to avoid duplicating identical hoisted definitions.

### IRError — Error / Failure

**File:** `src/IR/IRNodes/IRError.ts`

| Property | Type | Description |
|----------|------|-------------|
| `msg` | `IRTerm?` | Optional error message |

Represents explicit failure (`fail` statement) or unreachable code. Compiles to UPLC `Error`.

### IRForced — Force

**File:** `src/IR/IRNodes/IRForced.ts`

| Property | Type | Description |
|----------|------|-------------|
| `forced` | `IRTerm` | Term to force |

Evaluates a delayed computation. Pairs with `IRDelayed` to implement laziness. Also required by UPLC for polymorphic builtins.

### IRDelayed — Delay

**File:** `src/IR/IRNodes/IRDelayed.ts`

| Property | Type | Description |
|----------|------|-------------|
| `delayed` | `IRTerm` | Term to delay |

Creates a thunk (suspended computation). The term is not evaluated until forced. Used for:
- Lazy evaluation of conditional branches
- Polymorphic builtin application (UPLC requirement)

### IRConstr — Constructor

**File:** `src/IR/IRNodes/IRConstr.ts`

| Property | Type | Description |
|----------|------|-------------|
| `index` | `number` | Constructor tag |
| `fields` | `IRTerm[]` | Constructor field values |

Builds a tagged value for pattern matching. The index identifies which constructor of a sum type is being used.

### IRCase — Case Expression

**File:** `src/IR/IRNodes/IRCase.ts`

| Property | Type | Description |
|----------|------|-------------|
| `scrutinee` | `IRTerm` | Value being matched |
| `cases` | `IRTerm[]` | Handler for each constructor (by index) |

Destructs a value built with `IRConstr` and selects the appropriate handler. Each case receives the constructor's fields as lambda parameters.

```
case Constr(0, [a, b]) of
    [λa.λb. handler0(a, b),   // constructor 0
     λc. handler1(c)]          // constructor 1
```

### IRRecursive — Recursive Binding (Intermediate)

**File:** `src/IR/IRNodes/IRRecursive.ts`

| Property | Type | Description |
|----------|------|-------------|
| `params` | `symbol[]` | Function parameters |
| `body` | `IRTerm` | Body with self-reference |

Represents a recursive function definition. This is an **intermediate node** — it cannot be directly converted to UPLC. The `handleRecursiveTerms` optimization pass converts it to a Y-combinator pattern:

```
recursive f(x) => body
→ (λrecBody. recBody recBody)(λf. λx. body)
```

### IRSelfCall — Self-Call (Intermediate)

**File:** `src/IR/IRNodes/IRSelfCall.ts`

| Property | Type | Description |
|----------|------|-------------|
| `args` | `IRTerm[]` | Arguments to self-call |

Represents a recursive call to the enclosing `IRRecursive` function. Also an **intermediate node** — converted to `(self self args...)` by the recursive term handler.

## Parent-Child Relationships

Every IR node maintains a `parent` reference:
- Set automatically when a node is assigned as a child
- Enables upward tree traversal (used by scope analysis)
- Hash invalidation propagates upward on modification

When a child is shared between trees (shouldn't happen but is defensively handled), `sanifyTree()` clones the child to ensure each node has exactly one parent.

## Hash System

**File:** `src/IR/IRHash.ts`

Each IR node computes a content-based hash from its structure:
- Leaf nodes (Var, Const, Native) hash from their value
- Interior nodes hash from their children's hashes
- Hashes are cached and invalidated when children change

Used by:
- `IRHoisted` caching — identical hoisted terms share definitions
- Optimization passes — detect structurally identical subtrees
- Debug assertions — verify tree integrity

## De Bruijn Index Conversion

**File:** `src/IR/toUPLC/ctx/ToUplcCtx.ts`

UPLC uses De Bruijn indices instead of named variables. The `ToUplcCtx` tracks the mapping:

| Method | Description |
|--------|-------------|
| `getVarDeclDbn(sym)` | Get the declaration depth of a variable |
| `getVarAccessDbn(sym)` | Get the access index (relative to current scope depth) |
| `newChild(vars)` | Enter a new lambda scope, adding bound variables |

Index 0 = innermost binding, index 1 = next outer, etc. The context is threaded through `toUPLC()` calls as the tree is traversed.

## IR Utilities

**File:** `src/IR/utils/`

| Utility | Description |
|---------|-------------|
| `isClosedIRTerm(term)` | Returns true if term has no free variables |
| `isIRTerm(value)` | Type guard for IR nodes |
| `showIR(term)` | Pretty-print IR for debugging |
| `iterTree(term, callback)` | DFS traversal of IR tree |
| `getUnboundedVars(term)` | Find all free variables in a term |
