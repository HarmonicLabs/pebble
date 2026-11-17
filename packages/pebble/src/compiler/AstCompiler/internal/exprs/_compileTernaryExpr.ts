import { TernaryExpr } from "../../../../ast/nodes/expr/TernaryExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirTernaryExpr } from "../../../tir/expressions/TirTernaryExpr";
import { TirType } from "../../../tir/types/TirType";
import { canAssignTo } from "../../../tir/types/utils/canAssignTo";
import { fitToType } from "../../utils/fitToType";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { applyNarrowingsToScope, extractIsNarrowings } from "../../utils/extractIsNarrowings";
import { _compileExpr } from "./_compileExpr";

export function _compileTernaryExpr(
    ctx: AstCompilationCtx,
    expr: TernaryExpr,
    typeHint: TirType | undefined
): TirTernaryExpr | undefined
{
    const bool_t = ctx.program.stdTypes.bool;

    const cond = _compileExpr( ctx, expr.condition, bool_t );
    if( !cond ) return undefined;
    if( !canAssignTo( cond.type, bool_t ) ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        expr.condition.range, cond.type.toString(), bool_t.toString()
    );

    const thenCtx = ctx.newBranchChildScope();
    applyNarrowingsToScope( thenCtx.scope, extractIsNarrowings( cond, true ) );
    const thenExpr = _compileExpr( thenCtx, expr.ifTrue, typeHint );
    if( !thenExpr ) return undefined;

    const returnType = thenExpr.type;

    const elseCtx = ctx.newBranchChildScope();
    applyNarrowingsToScope( elseCtx.scope, extractIsNarrowings( cond, false ) );
    const compiledElse = _compileExpr( elseCtx, expr.ifFalse, returnType );
    if( !compiledElse ) return undefined;

    // both arms are one type: the first's
    const elseExpr = fitToType( compiledElse, returnType );
    if( !elseExpr ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        expr.ifFalse.range, compiledElse.type.toString(), returnType.toString()
    );

    return new TirTernaryExpr(
        cond,
        thenExpr,
        elseExpr,
        returnType,
        expr.range
    );
}