import { AssertStmt } from "../../../../ast/nodes/statements/AssertStmt";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirExpr } from "../../../tir/expressions/TirExpr";
import { TirTypeConversionExpr } from "../../../tir/expressions/TirTypeConversionExpr";
import { TirAssertStmt } from "../../../tir/statements/TirAssertStmt";
import { canAssignTo, canAssignToOptional } from "../../../tir/types/utils/canAssignTo";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { applyNarrowingsToScope, extractIsNarrowings } from "../../utils/extractIsNarrowings";
import { _compileExpr } from "../exprs/_compileExpr";

export function _compileAssertStmt(
    ctx: AstCompilationCtx,
    stmt: AssertStmt
): [ TirAssertStmt ] | undefined
{
    const bool_t = ctx.program.stdTypes.bool;
    const string_t = ctx.program.stdTypes.string;
    const bytes_t = ctx.program.stdTypes.bytes;

    const tirCond = _compileExpr( ctx, stmt.condition, bool_t );
    if( !tirCond ) return undefined;
    if(
        !canAssignTo( tirCond.type, bool_t )
        && !canAssignToOptional( tirCond.type )
    ) {
        return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            stmt.condition.range, tirCond.type.toString(), bool_t.toString()
        );
    }

    let failMsgExpr: TirExpr | undefined = undefined;
    if( stmt.elseExpr )
    {
        failMsgExpr = _compileExpr( ctx, stmt.elseExpr, string_t );
        if( !failMsgExpr ) return undefined;

        if( canAssignTo( failMsgExpr.type, bytes_t ) )
        {
            // auto cast to string
            failMsgExpr = new TirTypeConversionExpr(
                failMsgExpr,
                string_t,
                failMsgExpr.range
            );
        }

        if( !canAssignTo( failMsgExpr.type, string_t ) ) return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            stmt.elseExpr.range, failMsgExpr.type.toString(), string_t.toString()
        );
    }

    // After a successful `assert`, propagate any `is`-derived narrowings
    // into the current scope so subsequent statements see narrowed types.
    applyNarrowingsToScope(
        ctx.scope,
        extractIsNarrowings( tirCond, true )
    );

    return [ new TirAssertStmt( tirCond, failMsgExpr, stmt.range ) ];
}