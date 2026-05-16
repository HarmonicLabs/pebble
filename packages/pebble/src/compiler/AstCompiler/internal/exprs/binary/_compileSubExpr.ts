import { SubExpr } from "../../../../../ast/nodes/expr/binary/BinaryExpr";
import { DiagnosticCode } from "../../../../../diagnostics/diagnosticMessages.generated";
import { TirSubExpr } from "../../../../tir/expressions/binary/TirBinaryExpr";
import { TirType } from "../../../../tir/types/TirType";
import { TirValueT } from "../../../../tir/types/TirNativeType/native/value";
import { canAssignTo } from "../../../../tir/types/utils/canAssignTo";
import { getUnaliased } from "../../../../tir/types/utils/getUnaliased";
import { AstCompilationCtx } from "../../../AstCompilationCtx";
import { _compileExpr } from "../_compileExpr";

export function _compileSubExpr(
    ctx: AstCompilationCtx,
    expr: SubExpr,
    _typeHint: TirType | undefined
): TirSubExpr | undefined
{
    const int_t = ctx.program.stdTypes.int;

    const leftProbe = _compileExpr( ctx, expr.left, undefined );
    if( !leftProbe ) return undefined;
    const leftTy = getUnaliased( leftProbe.type );

    if( leftTy instanceof TirValueT )
    {
        const right = _compileExpr( ctx, expr.right, leftProbe.type );
        if( !right ) return undefined;
        if( !( getUnaliased( right.type ) instanceof TirValueT ) )
        return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            expr.right.range, right.type.toString(), "Value"
        );
        return new TirSubExpr( leftProbe, right, expr.range );
    }

    if( !canAssignTo( leftProbe.type, int_t ) )
    return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        expr.left.range, leftProbe.type.toString(), int_t.toString()
    );

    const right = _compileExpr( ctx, expr.right, int_t );
    if( !right ) return undefined;

    if( !canAssignTo( right.type, int_t ) )
    return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        expr.right.range, right.type.toString(), int_t.toString()
    );

    return new TirSubExpr(
        leftProbe,
        right,
        // implicit int type,
        expr.range
    );
}