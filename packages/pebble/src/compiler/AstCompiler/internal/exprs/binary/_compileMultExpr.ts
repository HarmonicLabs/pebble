import { MultExpr } from "../../../../../ast/nodes/expr/binary/BinaryExpr";
import { DiagnosticCode } from "../../../../../diagnostics/diagnosticMessages.generated";
import { TirMultExpr } from "../../../../tir/expressions/binary/TirBinaryExpr";
import { TirType } from "../../../../tir/types/TirType";
import { TirValueT } from "../../../../tir/types/TirNativeType/native/value";
import { canAssignTo } from "../../../../tir/types/utils/canAssignTo";
import { getUnaliased } from "../../../../tir/types/utils/getUnaliased";
import { AstCompilationCtx } from "../../../AstCompilationCtx";
import { _compileExpr } from "../_compileExpr";

export function _compileMultExpr(
    ctx: AstCompilationCtx,
    expr: MultExpr,
    _typeHint: TirType | undefined
): TirMultExpr | undefined
{
    const int_t = ctx.program.stdTypes.int;

    // Probe both sides without hints so we can disambiguate
    // (int * Value) / (Value * int) / (int * int).
    const leftProbe = _compileExpr( ctx, expr.left, undefined );
    if( !leftProbe ) return undefined;
    const leftTy = getUnaliased( leftProbe.type );

    if( leftTy instanceof TirValueT )
    {
        const right = _compileExpr( ctx, expr.right, int_t );
        if( !right ) return undefined;
        if( !canAssignTo( right.type, int_t ) )
        return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            expr.right.range, right.type.toString(), int_t.toString()
        );
        return new TirMultExpr( leftProbe, right, expr.range );
    }

    if( !canAssignTo( leftProbe.type, int_t ) )
    return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        expr.left.range, leftProbe.type.toString(), int_t.toString()
    );

    // left is int — right may be int (regular product) or Value (scaleValue).
    const right = _compileExpr( ctx, expr.right, undefined );
    if( !right ) return undefined;
    const rightTy = getUnaliased( right.type );
    if( rightTy instanceof TirValueT )
    {
        return new TirMultExpr( leftProbe, right, expr.range );
    }
    if( !canAssignTo( right.type, int_t ) )
    return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        expr.right.range, right.type.toString(), int_t.toString()
    );

    return new TirMultExpr(
        leftProbe,
        right,
        // implicit int type,
        expr.range
    );
}
