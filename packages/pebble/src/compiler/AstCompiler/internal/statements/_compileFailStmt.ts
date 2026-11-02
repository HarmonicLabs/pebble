import { FailStmt } from "../../../../ast/nodes/statements/FailStmt";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirExpr } from "../../../tir/expressions/TirExpr";
import { TirFailStmt } from "../../../tir/statements/TirFailStmt";
import { canAssignTo } from "../../../tir/types/utils/canAssignTo";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { bytes_t, string_t } from "../../../tir/program/stdScope/stdScope";
import { TirTypeConversionExpr } from "../../../tir/expressions/TirTypeConversionExpr";
import { _compileExpr } from "../exprs/_compileExpr";

export function _compileFailStmt(
    ctx: AstCompilationCtx,
    stmt: FailStmt
): [ TirFailStmt ] | undefined
{
    if( !ctx.functionCtx ) return ctx.error(
        DiagnosticCode.A_fail_statement_can_only_be_used_within_a_function_body,
        stmt.range
    );

    let failMsgExpr: TirExpr | undefined = undefined;
    if( stmt.value )
    {
        failMsgExpr = _compileExpr( ctx, stmt.value, string_t );
        if( !failMsgExpr ) return undefined;
        // string literals are utf8 bytes: cast them as `assert ... else` does
        // (without this, every `fail "message";` was a type error)
        if( canAssignTo( failMsgExpr.type, bytes_t ) )
        {
            failMsgExpr = new TirTypeConversionExpr(
                failMsgExpr,
                string_t,
                failMsgExpr.range
            );
        }
        if( !canAssignTo( failMsgExpr.type, string_t ) ) return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            stmt.value.range, failMsgExpr.type.toString(), string_t.toString()
        );
    }

    return [ new TirFailStmt( failMsgExpr, stmt.range ) ];
}