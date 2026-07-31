import { TraceStmt } from "../../../../ast/nodes/statements/TraceStmt";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirTraceStmt } from "../../../tir/statements/TirTraceStmt";
import { canAssignTo } from "../../../tir/types/utils/canAssignTo";
import { isBuiltinShowable } from "../../../tir/expressions/TirShowExpr";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileExpr } from "../exprs/_compileExpr";

export function _compileTraceStmt(
    ctx: AstCompilationCtx,
    stmt: TraceStmt
): [ TirTraceStmt ] | undefined
{
    const bytes_t = ctx.program.stdTypes.bytes;

    let expr = _compileExpr( ctx, stmt.expr, undefined );
    if( !expr ) return undefined;

    // `trace <x>;` accepts any Show-able value: `bytes` is passed through as
    // already-readable UTF-8, everything else is auto-shown at lowering time
    // by `TirTraceExpr.toIR` via `_showIR`. The gate used to allow only
    // `bytes | int` even though the lowering already handled bool/list/data/
    // struct (so those tests were vacuously green behind BUG 30).
    if(
        !canAssignTo( expr.type, bytes_t ) &&
        !isBuiltinShowable( expr.type )
    ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        stmt.expr.range, expr.type.toString(), "a Show-able type"
    );

    return [ new TirTraceStmt( expr, stmt.range ) ];
}
