import { TirAliasType } from "../TirAliasType";
import { TirEnumType } from "../TirEnumType";
import { TirIntT } from "../TirNativeType/native/int";
import { TirType } from "../TirType";

/**
 * If `t` is an enum type (or alias of one), returns the shared `int` type
 * (since enums lower to plain ints at runtime). Otherwise returns `t`.
 *
 * Use this to relax type checks for binary operators that treat enums as
 * integers (arithmetic, comparison, equality).
 */
export function normalizeEnumToInt( t: TirType, int_t: TirIntT ): TirType
{
    let probe: TirType = t;
    while( probe instanceof TirAliasType ) probe = probe.aliased;
    if( probe instanceof TirEnumType ) return int_t;
    return t;
}
