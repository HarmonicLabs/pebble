import { ReturnStmt } from "../../../../ast/nodes/statements/ReturnStmt";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirLitVoidExpr } from "../../../tir/expressions/litteral/TirLitVoidExpr";
import { TirReturnStmt } from "../../../tir/statements/TirReturnStmt";
import { fitToType } from "../../utils/fitToType";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileExpr } from "../exprs/_compileExpr";

export function _compileReturnStmt(
    ctx: AstCompilationCtx,
    stmt: ReturnStmt
): [ TirReturnStmt ] | undefined
{
    if( !ctx.functionCtx ) return ctx.error(
        DiagnosticCode.A_return_statement_can_only_be_used_within_a_function_body,
        stmt.range
    );
    const hintReturn = ctx.functionCtx.returnType;
    const inferring = ctx.functionCtx.inferReturnType === true;
    const compiled = stmt.value ?
    _compileExpr(
        ctx,
        stmt.value,
        inferring ? undefined : hintReturn
    ) : new TirLitVoidExpr( stmt.range );
    if( !compiled ) return undefined;

    // the value as the function's declared result
    const expr = inferring ? compiled : fitToType( compiled, hintReturn );
    if( !expr ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        stmt.value?.range ?? stmt.range, compiled.type.toString(), hintReturn.toString()
    );

    return [ new TirReturnStmt( expr, stmt.range ) ];
}