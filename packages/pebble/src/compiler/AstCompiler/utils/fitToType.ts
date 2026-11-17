import { TirExpr } from "../../tir/expressions/TirExpr";
import { TirTypeConversionExpr } from "../../tir/expressions/TirTypeConversionExpr";
import { TirType } from "../../tir/types/TirType";
import { canAssignTo, isOptionalEncodingBridge } from "../../tir/types/utils/canAssignTo";

/**
 * `expr` as a value for a slot of type `target` — a variable, a parameter, a
 * field, the result of a function, the other arm of a branch:
 *
 * - `expr` itself, when its type is assignable as it is;
 * - `expr` converted, when the two types are the two encodings of one
 *   `Optional<T>`. They are one type to whoever writes the program and two
 *   different values at run time (a data-encoded optional is `Constr 0 [x]`
 *   as data, a SoP one is a constructor term), so the conversion is real;
 * - `undefined`, when it is not such a value: the caller reports it.
 *
 * Every place a value flows into a typed slot asks this, and not
 * `canAssignTo` alone: with `canAssignTo` alone an optional read out of a
 * datum could be passed to a function and not returned from it.
 */
export function fitToType( expr: TirExpr, target: TirType ): TirExpr | undefined
{
    if( canAssignTo( expr.type, target ) ) return expr;
    if( isOptionalEncodingBridge( expr.type, target ) )
        return new TirTypeConversionExpr( expr, target, expr.range );
    return undefined;
}
