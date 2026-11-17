import { EqualExpr, NotEqualExpr } from "../../../../../ast/nodes/expr/binary/BinaryExpr";
import { DiagnosticCode } from "../../../../../diagnostics/diagnosticMessages.generated";
import { TirExpr } from "../../../../tir/expressions/TirExpr";
import { TirTypeConversionExpr } from "../../../../tir/expressions/TirTypeConversionExpr";
import { TirType } from "../../../../tir/types/TirType";
import { areOptionalsOfTwoEncodings, canAssignTo, isSopOptionalLike } from "../../../../tir/types/utils/canAssignTo";
import { hasStdEquality } from "../../../../tir/types/utils/hasStdEquality";
import { normalizeEnumToInt } from "../../../../tir/types/utils/normalizeEnumToInt";
import { AstCompilationCtx } from "../../../AstCompilationCtx";
import { _compileExpr } from "../_compileExpr";

/**
 * The operands of `==` / `!=`, as two values of ONE type that has an equality.
 *
 * - The right operand must be a value of the left one's type.
 * - The two operands are of one type: either of them may be the wider one.
 * - An `Optional<T>` read out of a datum and one made in the function are the
 *   same type in two encodings: the SoP one is converted and they are compared
 *   as data.
 * - A type with no equality (a function, a BLS12-381 element, an array, a
 *   runtime struct) is reported here; the back end has no term for it.
 */
export function _compileEqualityOperands(
    ctx: AstCompilationCtx,
    expr: EqualExpr | NotEqualExpr,
    _typeHint: TirType | undefined
): [ left: TirExpr, right: TirExpr ] | undefined
{
    // the type the comparison is wanted as (a `boolean`) says nothing about
    // its operands: handed down, it refused a struct literal on the left
    // (`P.P{ … } == p` in a condition: "not assignable to boolean")
    let left = _compileExpr( ctx, expr.left, undefined );
    if( !left ) return undefined;

    // enums lower to ints at runtime, so allow comparing against ints
    const leftType = normalizeEnumToInt( left.type, ctx.program.stdTypes.int );

    let right = _compileExpr( ctx, expr.right, leftType );
    if( !right ) return undefined;

    // one type on both sides: either operand may be the wider one (a variable
    // narrowed by `is` compares with an un-narrowed one)
    if( !canAssignTo( right.type, leftType ) && !canAssignTo( leftType, right.type ) )
    {
        if( !areOptionalsOfTwoEncodings( leftType, right.type ) ) return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            expr.right.range, right.type.toString(), leftType.toString()
        );
        // whichever operand is the SoP optional becomes the data one
        if( isSopOptionalLike( right.type ) )
            right = new TirTypeConversionExpr( right, leftType, right.range );
        else
            left = new TirTypeConversionExpr( left, right.type, left.range );
    }

    if( !hasStdEquality( left.type ) ) return ctx.error(
        DiagnosticCode.Operator_0_cannot_be_applied_to_types_1_and_2,
        expr.range,
        expr instanceof EqualExpr ? "==" : "!=",
        left.type.toString(),
        right.type.toString()
    );

    return [ left, right ];
}
