import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { SourceRange } from "../../../../ast/Source/SourceRange";
import { AstFuncType } from "../../../../ast/nodes/types/AstNativeTypeExpr";
import { AstNamedTypeExpr } from "../../../../ast/nodes/types/AstNamedTypeExpr";
import { SimpleVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/SimpleVarDecl";
import { CommonFlags } from "../../../../common";
import type { IRTerm } from "../../../../IR/IRTerm";
import { TirType } from "../../types/TirType";
import { TypedProgram } from "../TypedProgram";

// NOTE: `TirToDataExpr` transitively imports `common_hoisted`, which calls
// `IRConst.data(...)` at module-load time. Loading this at the top would
// cycle with `TypedProgram` during early compiler bootstrap and trip
// "Cannot read properties of undefined (reading 'data')" in tests that load
// the IR layer in isolation. Require it lazily inside the factory instead.

/**
 * Register compiler-built interfaces and their built-in implementation
 * factories.
 *
 * - `ToData`: every type that supports a `data` encoding (which is most
 *   Pebble types) automatically satisfies it. The factory returns
 *   `_toDataUplcFunc(T)` — a closed IR closure `(T) -> data` produced by
 *   the same compile-time dispatch that `TirToDataExpr` uses.
 *
 * User types may also implement these interfaces explicitly via
 * `type Foo implements ToData { toData(self): data { ... } }`. When a
 * constraint is resolved at call time, the user-impl path is checked first
 * (via the type's `methodNamesPtr`); only if no user impl exists does the
 * compiler fall back to the built-in factory registered here.
 */
export function populateBuiltinInterfaces( program: TypedProgram ): void
{
    const unkRange = SourceRange.unknown;

    // ---- interface ToData { toData(self): data } ----
    const selfParam = new SimpleVarDecl(
        new Identifier( "self", unkRange ),
        // self has no annotated type; the implementer's type fills the slot
        undefined as any,
        undefined,
        CommonFlags.None,
        unkRange,
    );
    const toDataSig = new AstFuncType(
        [ selfParam ],
        new AstNamedTypeExpr( new Identifier( "data", unkRange ), [], unkRange ),
        unkRange,
    );
    const toDataMethods = new Map<string, AstFuncType>([
        [ "toData", toDataSig ],
    ]);

    // Register the interface in the prelude scope so users can write
    // `<T implements ToData>`. The scope walker (`resolveInterface`) finds
    // it via the parent chain.
    program.preludeScope.interfaces.set( "ToData", toDataMethods );

    // Built-in impl factory: given a concrete TIR type, return a
    // closed `IRTerm` of type `(T) -> data`. `_toDataUplcFunc` already
    // dispatches compile-time per concrete type — return its hoisted
    // closure directly. Loaded lazily to avoid the bootstrap cycle.
    program.builtinInterfaceImpls.set( "ToData", new Map([
        [ "toData", ( concreteType: TirType ): IRTerm => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { _toDataUplcFunc } = require( "../../expressions/TirToDataExpr" );
            return _toDataUplcFunc( concreteType );
        }],
    ]));

    // ---- interface Show { show(self): bytes } ----
    // Returns a UTF-8 textual representation suitable for human reading
    // and for passing through `trace`. Built-in primitives auto-implement
    // it (int -> decimal, bytes -> lowercase hex, bool -> "true"/"false",
    // data -> serialiseData -> hex, List<T>/LinearMap<K,V> -> recursive,
    // data-encoded structs -> serialiseData -> hex). User types may
    // override with `type X implements Show { show(self): bytes { ... } }`.
    const showSig = new AstFuncType(
        [ selfParam ],
        new AstNamedTypeExpr( new Identifier( "bytes", unkRange ), [], unkRange ),
        unkRange,
    );
    program.preludeScope.interfaces.set( "Show", new Map<string, AstFuncType>([
        [ "show", showSig ],
    ]));

    program.builtinInterfaceImpls.set( "Show", new Map([
        [ "show", ( concreteType: TirType ): IRTerm => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { _showUplcFunc } = require( "../../expressions/TirShowExpr" );
            return _showUplcFunc( concreteType );
        }],
    ]));
}
