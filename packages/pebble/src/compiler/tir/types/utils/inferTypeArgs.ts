import { TirArrayT } from "../TirNativeType/native/array";
import { TirFuncT } from "../TirNativeType/native/function";
import { TirLinearMapT } from "../TirNativeType/native/linearMap";
import { TirLinearMapEntryT } from "../TirNativeType/native/linearMapEntry";
import { TirListT } from "../TirNativeType/native/list";
import { TirDataOptT } from "../TirNativeType/native/Optional/data";
import { TirSopOptT } from "../TirNativeType/native/Optional/sop";
import { TirTypeParam } from "../TirTypeParam";
import { TirType } from "../TirType";
import { getUnaliased } from "./getUnaliased";

/**
 * Attempt to bind free `TirTypeParam`s in `formal` so that the result matches
 * `actual`. Bindings are accumulated into `env`. Returns `true` on success.
 *
 * - Inconsistent bindings (`T = int` then `T = bytes`) cause failure.
 * - Shape mismatches between concrete containers cause failure.
 * - Unknown type-params in `formal` not yet in `env` are bound to `actual`'s
 *   matching position.
 *
 * This is intentionally syntactic — no subtyping, no widening. The caller
 * passes already-unaliased argument types.
 */
export function inferTypeArgs(
    formal: TirType,
    actual: TirType,
    env: Map<symbol, TirType>
): boolean
{
    formal = getUnaliased( formal );
    actual = getUnaliased( actual );

    if( formal instanceof TirTypeParam )
    {
        const existing = env.get( formal.symbol );
        if( existing === undefined )
        {
            env.set( formal.symbol, actual );
            return true;
        }
        // consistency: existing binding must equal actual
        return tirTypeStructurallyEqual( existing, actual );
    }

    // both must be the same shape and equal in arg-positions
    if( formal instanceof TirListT && actual instanceof TirListT )
    {
        return inferTypeArgs( formal.typeArg, actual.typeArg, env );
    }
    if( formal instanceof TirArrayT && actual instanceof TirArrayT )
    {
        return inferTypeArgs( formal.typeArg, actual.typeArg, env );
    }
    if( formal instanceof TirFuncT && actual instanceof TirFuncT )
    {
        if( formal.argTypes.length !== actual.argTypes.length ) return false;
        for( let i = 0; i < formal.argTypes.length; i++ )
        {
            if( !inferTypeArgs( formal.argTypes[i], actual.argTypes[i], env ) ) return false;
        }
        return inferTypeArgs( formal.returnType, actual.returnType, env );
    }
    if( formal instanceof TirLinearMapT && actual instanceof TirLinearMapT )
    {
        return (
            inferTypeArgs( formal.keyTypeArg, actual.keyTypeArg, env )
            && inferTypeArgs( formal.valTypeArg, actual.valTypeArg, env )
        );
    }
    if( formal instanceof TirLinearMapEntryT && actual instanceof TirLinearMapEntryT )
    {
        return (
            inferTypeArgs( formal.keyTypeArg, actual.keyTypeArg, env )
            && inferTypeArgs( formal.valTypeArg, actual.valTypeArg, env )
        );
    }
    if( formal instanceof TirDataOptT && actual instanceof TirDataOptT )
    {
        return inferTypeArgs( formal.typeArg, actual.typeArg, env );
    }
    if( formal instanceof TirSopOptT && actual instanceof TirSopOptT )
    {
        return inferTypeArgs( formal.typeArg, actual.typeArg, env );
    }

    // base case: both concrete with no type-vars — must be the same type
    return tirTypeStructurallyEqual( formal, actual );
}

/**
 * Cheap structural equality for unaliased TirTypes — compares concrete TIR
 * names. Sufficient for our inference consistency checks.
 */
export function tirTypeStructurallyEqual( a: TirType, b: TirType ): boolean
{
    a = getUnaliased( a );
    b = getUnaliased( b );
    if( a instanceof TirTypeParam && b instanceof TirTypeParam )
    {
        return a.symbol === b.symbol;
    }
    try {
        return a.toConcreteTirTypeName() === b.toConcreteTirTypeName();
    } catch {
        return false;
    }
}
