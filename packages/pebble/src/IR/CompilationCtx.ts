import type { IRHash } from "./IRHash";

/**
 * Per-compilation mutable state.
 *
 * Everything here is scoped to a single compile so that compilations are
 * hermetic: one compile can never observe or mutate another's caches.
 * Combined with content-addressed `IRHash` (which has no global state at
 * all), this makes the whole pipeline free of cross-compilation leakage.
 *
 * The maps hold (or name) IR nodes that belong to *this* compile's tree —
 * `hoistedCache` in particular references live nodes that later passes
 * mutate in place, which is exactly why it must not outlive the compile.
 *
 * Node value types are kept as `unknown`/`any` here to avoid an
 * `IR/IRNodes` import cycle; the consumers cast at the use site.
 */
export class CompilationCtx
{
    /** hoisted-term hash -> the letted node it was lowered to (live tree node). */
    readonly hoistedCache: Map<IRHash, WeakRef<any>> = new Map();
    /** hoisted-term hash -> the stable binder symbol used to name it. */
    readonly hoistedHashToSymbol: Map<IRHash, WeakRef<Symbol>> = new Map();
    /** letted-term hash -> the stable binder symbol used to name it. */
    readonly lettedHashToSymbol: Map<IRHash, WeakRef<Symbol>> = new Map();
    /** element-type name -> cached `mapToType` TIR helper (clones only). */
    readonly mapToTypeCache: Map<string, any> = new Map();
}

let _current: CompilationCtx | undefined = undefined;
let _default: CompilationCtx | undefined = undefined;

/**
 * The context for the compilation currently in flight. If none is active
 * (e.g. an `IRTerm.name` access from a debug/`showIR` path outside a
 * compile) a process-wide default is used — safe because, with
 * content-addressed hashing, sharing these caches can no longer cause a
 * miscompile; it only affects one-off naming.
 */
export function currentCompilationCtx(): CompilationCtx
{
    if( _current !== undefined ) return _current;
    return ( _default ??= new CompilationCtx() );
}

/**
 * Run `fn` with `ctx` as the active compilation context, restoring the
 * previous one afterwards (so nested compiles are well-behaved). The
 * `finally` guarantees the context is cleared even if `fn` throws.
 */
export function withCompilationCtx<T>( ctx: CompilationCtx, fn: () => T ): T
{
    const prev = _current;
    _current = ctx;
    try { return fn(); }
    finally { _current = prev; }
}
