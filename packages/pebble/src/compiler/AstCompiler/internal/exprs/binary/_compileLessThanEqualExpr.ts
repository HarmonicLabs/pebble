import { LessThanEqualExpr } from "../../../../../ast/nodes/expr/binary/BinaryExpr";
import { DiagnosticCode } from "../../../../../diagnostics/diagnosticMessages.generated";
import { TirLessThanEqualExpr } from "../../../../tir/expressions/binary/TirBinaryExpr";
import { TirAliasType } from "../../../../tir/types/TirAliasType";
import { TirType } from "../../../../tir/types/TirType";
import { canAssignTo } from "../../../../tir/types/utils/canAssignTo";
import { getUnaliased } from "../../../../tir/types/utils/getUnaliased";
import { TirValueT } from "../../../../tir/types/TirNativeType/native/value";
import { normalizeEnumToInt } from "../../../../tir/types/utils/normalizeEnumToInt";
import { AstCompilationCtx } from "../../../AstCompilationCtx";
import { int_t, bytes_t } from "../../../../tir/program/stdScope/stdScope";
import { _compileExpr } from "../_compileExpr";

export function _compileLessThanEqualExpr(
    ctx: AstCompilationCtx,
    expr: LessThanEqualExpr,
    typeHint: TirType | undefined
): TirLessThanEqualExpr | undefined
{
    const left = _compileExpr( ctx, expr.left, typeHint );
    if( !left ) return undefined;

    if(
        !( getUnaliased( left.type ) instanceof TirValueT )
        && !canAssignTo( left.type, int_t )
        && !canAssignTo( left.type, bytes_t )
    ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        expr.left.range, left.type.toString(), int_t.toString()
    );

    let leftType = normalizeEnumToInt( left.type, int_t );
    while( leftType instanceof TirAliasType ) leftType = leftType.aliased;

    const right = _compileExpr( ctx, expr.right, leftType );
    if( !right ) return undefined;

    if( !canAssignTo( right.type, leftType ) )
    return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        expr.right.range, right.type.toString(), leftType.toString()
    );

    return new TirLessThanEqualExpr(
        left,
        right,
        // implicit bool type,
        expr.range
    ); 
}