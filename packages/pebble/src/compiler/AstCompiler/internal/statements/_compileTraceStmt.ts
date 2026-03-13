import { TraceStmt } from "../../../../ast/nodes/statements/TraceStmt";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirTraceStmt } from "../../../tir/statements/TirTraceStmt";
import { canAssignTo } from "../../../tir/types/utils/canAssignTo";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileExpr } from "../exprs/_compileExpr";

export function _compileTraceStmt(
    ctx: AstCompilationCtx,
    stmt: TraceStmt
): [ TirTraceStmt ] | undefined
{
    const bytes_t = ctx.program.stdTypes.bytes;
    const int_t = ctx.program.stdTypes.int;

    let expr = _compileExpr( ctx, stmt.expr, undefined );
    if( !expr ) return undefined;

    if(
        !canAssignTo( expr.type, bytes_t ) &&
        !canAssignTo( expr.type, int_t )
    ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        stmt.expr.range, expr.type.toString(), "bytes | int"
    );

    return [ new TirTraceStmt( expr, stmt.range ) ];
}
