import { AddExpr } from "../../../../../ast/nodes/expr/binary/BinaryExpr";
import { DiagnosticCode } from "../../../../../diagnostics/diagnosticMessages.generated";
import { TirAddExpr } from "../../../../tir/expressions/binary/TirBinaryExpr";
import { TirType } from "../../../../tir/types/TirType";
import { TirValueT } from "../../../../tir/types/TirNativeType/native/value";
import { TirBytesT } from "../../../../tir/types/TirNativeType/native/bytes";
import { TirStringT } from "../../../../tir/types/TirNativeType/native/string";
import { canAssignTo } from "../../../../tir/types/utils/canAssignTo";
import { getUnaliased } from "../../../../tir/types/utils/getUnaliased";
import { AstCompilationCtx } from "../../../AstCompilationCtx";
import { _compileExpr } from "../_compileExpr";

/**
 * What `+` does is decided by its LEFT operand; this is the type its right operand must
 * then have (`undefined`: the left operand is nothing `+` adds).
 *
 * - `int` (an enum too: an int at runtime): addition
 * - `bytes`, `string`: concatenation, `a.concat( b )`
 * - `Value`: union
 *
 * `TirAddExpr` lowers each of them (`addInteger`, `appendByteString`, `appendString`,
 * `unionValue`). `a += b` is `a = a + b`: it asks here too (`_compileAssignmentStmt`),
 * so that the two never disagree on what can be added.
 */
export function addRightOperandType(
    ctx: AstCompilationCtx,
    leftType: TirType
): TirType | undefined
{
    const left_t = getUnaliased( leftType );
    if(
        left_t instanceof TirValueT
        || left_t instanceof TirBytesT
        || left_t instanceof TirStringT
    ) return leftType;

    const int_t = ctx.program.stdTypes.int;
    if( canAssignTo( leftType, int_t ) ) return int_t;

    return undefined;
}

export function _compileAddExpr(
    ctx: AstCompilationCtx,
    expr: AddExpr,
    _typeHint: TirType | undefined
): TirAddExpr | undefined
{
    const int_t = ctx.program.stdTypes.int;

    // the left operand first, with no hint: its type says what is added
    const left = _compileExpr( ctx, expr.left, undefined );
    if( !left ) return undefined;

    const rightType = addRightOperandType( ctx, left.type );
    if( !rightType )
    return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        expr.left.range, left.type.toString(), int_t.toString()
    );

    const right = _compileExpr( ctx, expr.right, rightType );
    if( !right ) return undefined;

    if( !canAssignTo( right.type, rightType ) )
    return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        expr.right.range, right.type.toString(), rightType.toString()
    );

    return new TirAddExpr(
        left,
        right,
        expr.range
    );
}
