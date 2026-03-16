# IR to UPLC Optimizations

The IR-to-UPLC compiler (`src/IR/toUPLC/`) transforms the expression-based IR into final UPLC through a multi-pass optimization pipeline. Each pass is a subroutine in `src/IR/toUPLC/subRoutines/`.

## Pipeline Overview

**File:** `src/IR/toUPLC/compileIRToUPLC.ts`

```typescript
function compileIRToUPLC(term: IRTerm, options: Partial<CompilerOptions>): UPLCTerm
```

The passes execute in this order:

```
IR Term (input)
   │
   ├─ 1. Unwrap top-level lettings/hoistings
   │
   ├─ 2. Constant folding (first pass)          rewriteNativesAppliedToConstants
   ├─ 3. Dead code elimination (first pass)      removeUnusedVars
   │
   ├─ 4. Negative native hoisting                _makeAllNegativeNativesHoisted
   ├─ 5. Native expansion                        replaceNatives
   ├─ 6. Constant folding (second pass)          rewriteNativesAppliedToConstants
   │
   ├─ 7. Forced native hoisting                  replaceForcedNativesWithHoisted
   ├─ 8. Letted handling                         handleLetted
   ├─ 9. Hoisted handling                        handleHoisted
   │
   ├─ 10. Recursive term handling                handleRecursiveTerms
   ├─ 11. Forced native extraction (conditional) hoistForcedNatives
   │
   ├─ 12. Dead code elimination (second pass)    removeUnusedVars
   │
   ├─ 13. UPLC optimizations                     performUplcOptimizations
   ├─ 14. Builtin force validation               ensureProperlyForcedBuiltins
   │
   ├─ 15. Marker addition (optional)             addVersionMarker
   └─ 16. UPLC generation + validation           term.toUPLC() + closed-term check
```

## Compiler Options

**File:** `src/IR/toUPLC/CompilerOptions.ts`

```typescript
interface CompilerOptions {
    entry: string;                          // Entry file path
    root: string;                           // Project root
    outDir: string;                         // Output directory
    silent: boolean;                        // Suppress output
    targetUplcVersion: UPLCVersion;         // Target UPLC version
    removeTraces: boolean;                  // Strip trace calls
    delayHoists: boolean;                   // Defer hoisted evaluation
    addMarker: boolean;                     // Add version marker
    uplcOptimizations: {
        groupApplications: boolean;         // Reorder/group function arguments
        inlineSingleUse: boolean;           // Inline single-reference bindings
        simplifyWrappedPartialFuncApps: boolean; // Simplify partial applications
        removeForceDelay: boolean;          // Remove redundant force(delay(x))
    }
}
```

### Predefined Configurations

| Config | `delayHoists` | `removeTraces` | Optimizations | Use Case |
|--------|:---:|:---:|:---:|----------|
| `productionOptions` | `false` | `true` | all on | Default for deployment |
| `debugOptions` | `false` | `false` | all off | Debugging |
| `extremeOptions` | `true` | `true` | all on | Maximum size reduction |
| `testOptions` | `false` | `true` | all on | Tests (silent) |

### `delayHoists` Trade-off

When `false` (default): hoisted terms are evaluated at script startup. Fast for single-purpose scripts but wastes budget if branches don't use all hoisted terms.

When `true`: hoisted terms are converted to letted and placed at their use site. Reduces startup cost for multi-purpose scripts (e.g., contract with multiple methods) but increases compilation time and may duplicate code.

## Pass 1: Constant Folding

**File:** `src/IR/toUPLC/subRoutines/rewriteNativesAppliedToConstantsAndReturnRoot.ts`

Evaluates native operations with constant arguments at compile time. Runs twice — before and after native expansion.

### Transformations

| Pattern | Replacement | Description |
|---------|-------------|-------------|
| `(λx. x)(arg)` | `arg` | Identity elimination |
| `add(a)(b)` where both constant | `a + b` | Arithmetic folding |
| `lessThan(a)(b)` where both constant | `a < b` | Comparison folding |
| `eq(0)(x)` | `isZero(x)` | Zero-equality specialization |
| `add(1)(x)` | `increment(x)` | Increment specialization |
| `sub(1)(x)` | `decrement(x)` | Decrement specialization |
| `ifThenElse(const_true, t, e)` | `t` | Dead branch elimination |
| `ifThenElse(const_false, t, e)` | `e` | Dead branch elimination |
| `ifThenElse(not(x), t, e)` | `ifThenElse(x, e, t)` | Negation swap |
| `length(list) == 0` | `chooseList(list, then, else)` | Null-check optimization |
| `dropN(const)` | composed drops | Precompiled drop combinator |

### Algorithm
DFS traversal with a reprocessing stack. When a term is rewritten, its parent is pushed onto the stack for re-evaluation, since the new term may enable further folding.

## Pass 2: Dead Code Elimination

**File:** `src/IR/toUPLC/subRoutines/removeUnusuedVarsAndReturnRoot/`

Removes unused function parameters and their corresponding arguments.

### Algorithm
1. Traverse applications bottom-up using a context stack
2. For each `IRApp(IRFunc(...), arg)`, count references to each parameter
3. Filter out parameters with zero references
4. Remove the corresponding argument from the application
5. If all parameters are unused, unwrap the function entirely (replace `(λ_. body)(arg)` with `body`)

Runs twice: early (before native expansion) and late (after all transformations).

## Pass 3: Native Expansion

**File:** `src/IR/toUPLC/subRoutines/replaceNatives/`

Expands Pebble-internal native operations into their IR equivalents (typically hoisted functions).

### Key Expansions

| Native | Expansion |
|--------|-----------|
| `id` | `hoisted(λx. x)` |
| `not` | `hoisted(λb. ifThenElse(b, false, true))` |
| `increment` | `hoisted(add(1))` |
| `decrement` | `hoisted(add(-1))` |
| `isZero` | `hoisted(eq(0))` |
| `isOne` | `hoisted(eq(1))` |
| `and` | `hoisted(λa.λb. ifThenElse(a, b, false))` |
| `or` | `hoisted(λa.λb. ifThenElse(a, true, b))` |
| `strictIfThenElse` | Force + delay composition |
| `length` | Applied tail operations |
| `dropN` | Composed hoisted drop combinators |

### Drop Combinator Compilation

**File:** `src/IR/toUPLC/subRoutines/_comptimeDropN.ts`

Arbitrary `dropN(k)` is compiled into an optimal composition of pre-hoisted drop functions:

| Hoisted | Definition |
|---------|------------|
| `drop2` | `λl. tail(tail(l))` |
| `drop3` | `λl. tail(drop2(l))` |
| `drop4` | `λl. drop2(drop2(l))` |
| `drop8` | `λl. drop4(drop4(l))` |
| `drop16` | `λl. drop8(drop8(l))` |
| `drop32` | `λl. drop16(drop16(l))` |

For arbitrary N, greedy decomposition into `{32, 16, 8, 4, 3, 2, 1}`:
```
drop15 → drop8(drop4(drop3(l)))
drop25 → drop16(drop8(tail(l)))
```

## Pass 4: Letted Handling

**File:** `src/IR/toUPLC/subRoutines/handleLetted/`

Converts `IRLetted` nodes to lambda applications `(λvar. body)(value)`, placing bindings at the optimal scope.

### Algorithm

1. **Sanify tree** — ensure correct parent pointers
2. **Mark recursive hoists** — prevent inlining across recursion boundaries
3. **Sort by dependency** — most-dependent letted first
4. **For each letted term:**
   - If **single reference**: inline directly (replace variable access with the value)
   - If **value is a variable**: always inline (no cost)
   - If **multiple references**: find optimal scope placement

### Scope Placement

**File:** `src/IR/toUPLC/subRoutines/handleLetted/groupByScope.ts`

For multi-reference letted terms:

1. `getUnboundedVars(value)` — find free variables in the value expression
2. `getMaxScope(unbounded)` — find the smallest scope containing all free variable definitions
3. `lowestCommonAncestor(references)` — find the scope containing all use sites
4. Place the binding at the lower (more specific) of the two scopes

This ensures the binding is:
- High enough that all free variables in its value are in scope
- Low enough that it's not computed unnecessarily in branches that don't use it

### Iterative Processing

The pass is iterative: each iteration extracts one letted binding, replaces `IRLetted` with `(λvar. body)(value)`, and continues until no letted nodes remain.

## Pass 5: Hoisted Handling

**File:** `src/IR/toUPLC/subRoutines/handleHoistedAndReturnRoot/`

Processes `IRHoisted` nodes — closed terms extracted to top-level scope.

### Algorithm

1. Unwrap top-level hoisted wrappers
2. Collect all hoisted terms, sort by dependencies
3. Partition into:
   - **To hoist**: multiple references or `meta.forceHoist = true`
   - **To inline**: single reference (inline instead of extracting)
4. Build a lambda chain from outermost scope:
   ```
   (λhoisted1. (λhoisted2. ... body)(value2))(value1)
   ```
5. Replace all `IRHoisted` references with `IRVar` pointing to the lambda parameter

### Hoisted vs Letted Trade-off

| Property | Hoisted | Letted |
|----------|---------|--------|
| Free variables | None (closed) | May have free vars |
| Scope | Top-level | Optimal local scope |
| Evaluation | Always at startup | Only when branch is taken |
| Code sharing | Always shared | May be duplicated |
| `delayHoists` option | Converts to letted | Stays as letted |

When `delayHoists = true`, `replaceHoistedWithLetted()` downgrades hoisted terms to letted. Conversely, `replaceClosedLettedWithHoisted()` upgrades closed letted terms to hoisted.

## Pass 6: Recursive Term Handling

**File:** `src/IR/toUPLC/subRoutines/handleRecursiveTerms.ts`

Converts `IRRecursive` and `IRSelfCall` nodes (which have no UPLC equivalent) into Y-combinator patterns.

### Transformation

```
IRRecursive(self, body)
↓
(hoisted(λrecBody. recBody(recBody)))(λself. body)
```

Where each `IRSelfCall(args...)` inside `body` becomes:
```
self(self)(args...)
```

The hoisted `λrecBody. recBody(recBody)` is the fixed-point combinator kernel, shared across all recursive functions.

## Pass 7: UPLC Optimizations

**File:** `src/IR/toUPLC/subRoutines/performUplcOptimizationsAndReturnRoot/`

UPLC-specific optimizations applied after all IR transformations.

### Function Expansion

**File:** `expandFuncsAndReturnRoot.ts`

Expands multi-arity IR functions to nested single-parameter lambdas (required by UPLC):

```
IRFunc([a, b, c], body) → Lambda(a, Lambda(b, Lambda(c, body)))
```

### Identity Elimination

Detects and removes identity function applications:
```
(λx. x)(arg) → arg
```

### Independent Application Grouping

**File:** `performUplcOptimizationsAndReturnRoot.ts`

Reorders and groups function parameters based on data dependencies to minimize closure captures.

#### Algorithm

1. Extract nested function applications:
   ```
   ((λp1. (λp2. (λp3. body))(a2))(a1)) → params=[p1,p2,p3], args=[a1,a2,a3]
   ```
2. Analyze dependencies: which parameters reference which other parameters
3. Group parameters by dependency level:
   - Group 0: parameters with no free variables (can be outermost)
   - Group 1: parameters depending only on group 0
   - Group N: parameters depending on group N-1
4. Reorder parameters to match grouping
5. Convert multi-argument groups to `IRCase`/`IRConstr`:
   ```
   // Instead of λa.λb.λc.body applied to (a)(b)(c)
   // Use: case Constr(0, [a, b, c]) of [λa.λb.λc. body]
   ```

This reduces the number of lambda abstractions and applications, shrinking script size.

### Force/Delay Removal

Removes redundant `force(delay(x))` pairs, which cancel out:
```
force(delay(x)) → x
```

### Wrapped Partial Application Simplification

Simplifies patterns like `λx. f(x)` to just `f` when `f` doesn't capture `x`.

## Pass 8: Builtin Force Validation

**File:** `ensureProperlyForcedBuiltinsAndReturnRoot.ts`

Ensures UPLC builtins have the correct number of `force` wrappers as required by the UPLC specification.

Each builtin has a specific number of required forces (from `getNRequiredForces()`). This pass:
1. Finds each `IRNative` node
2. Counts existing `IRForced` wrappers
3. Adds missing force layers or validates existing ones

This is the final correctness pass before UPLC code generation.

## Supporting Passes

### Negative Native Hoisting

`_makeAllNegativeNativesHoisted()` — Hoists natives with negative tags (builtins requiring partial application) to ensure they're properly handled.

### Forced Native Hoisting

`hoistForcedNatives()` — Extracts forced builtins (e.g., `force(ifThenElse)`) to top-level hoisted definitions. Hoistable forced natives include:
- `strictIfThenElse`, `chooseUnit`, `trace`
- `mkCons`, `headList`, `tailList`, `nullList`
- `chooseData`, `fstPair`, `sndPair`
- `strictChooseList`

### Recursive Hoist Marking

`markRecursiveHoistsAsForced()` — Marks hoisted/letted terms inside `IRRecursive` nodes with `meta.forceHoist = true` to prevent inlining that would create self-referential structures.

### Tree Sanification

`sanifyTree()` — Validates and repairs parent pointers throughout the IR tree. Clones nodes that appear to have multiple parents (shouldn't happen but handled defensively).

### Closed Letted ↔ Hoisted Conversion

| Pass | Direction | Condition |
|------|-----------|-----------|
| `replaceClosedLettedWithHoisted()` | Letted → Hoisted | Term has no free variables |
| `replaceHoistedWithLetted()` | Hoisted → Letted | `delayHoists` enabled |

## UPLC Generation

After all optimization passes, the final IR tree is converted to UPLC:

1. `term.toUPLC(ToUplcCtx.root())` — each IR node converts itself to UPLC
2. `ToUplcCtx` tracks De Bruijn variable numbering through scope nesting
3. The result is validated as a closed term (no free variables)
4. Optional version marker is prepended for UPLC v1.1+

### De Bruijn Index Resolution

**File:** `src/IR/toUPLC/ctx/ToUplcCtx.ts`

The context maintains a stack of bound variables:

```
λa. λb. λc. ... a ...
                 ^ De Bruijn index = 2 (innermost c=0, b=1, a=2)
```

| Method | Description |
|--------|-------------|
| `getVarAccessDbn(sym)` | Returns the De Bruijn index for a variable access |
| `newChild(vars)` | Pushes new bindings onto the scope stack |

## Optimization Impact

The optimization pipeline typically achieves:
- **Code size reduction**: 40-70% compared to naive compilation
- **Execution cost reduction**: Fewer lambda abstractions and applications
- **Startup cost management**: Hoisting vs letted trade-off for multi-purpose scripts

The `delayHoists` option is the primary knob for scripts that serve multiple purposes (e.g., a contract with spend + mint methods). Setting it to `true` avoids paying for hoisted definitions that aren't used in the current execution path.
