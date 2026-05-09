import { IfStmt } from "../../../../ast/nodes/statements/IfStmt";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirIfStmt } from "../../../tir/statements/TirIfStmt";
import { TirStmt } from "../../../tir/statements/TirStmt";
import { canAssignTo, canAssignToOptional } from "../../../tir/types/utils/canAssignTo";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { bool_t } from "../../../tir/program/stdScope/stdScope";
import { wrapManyStatements } from "../../utils/wrapManyStatementsOrReturnSame";
import { applyNarrowingsToScope, extractIsNarrowings } from "../../utils/extractIsNarrowings";
import { _compileExpr } from "../exprs/_compileExpr";
import { _compileStatement } from "./_compileStatement";

export function _compileIfStmt(
    ctx: AstCompilationCtx,
    stmt: IfStmt
): [ TirIfStmt ] | undefined
{
    const coditionExpr = _compileExpr( ctx, stmt.condition, bool_t );
    if( !coditionExpr ) return undefined;
    if(
        !canAssignTo( coditionExpr.type, bool_t )
        && !canAssignToOptional( coditionExpr.type )
    ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        stmt.condition.range, coditionExpr.type.toString(), "boolean | Optional<T>"
    );

    const thenCtx = ctx.newBranchChildScope();
    applyNarrowingsToScope(
        thenCtx.scope,
        extractIsNarrowings( coditionExpr, true )
    );
    const thenBranch = wrapManyStatements(
        _compileStatement( thenCtx, stmt.thenBranch ),
        stmt.thenBranch.range
    );
    if( !thenBranch ) return undefined;

    let elseBranch: TirStmt | undefined = undefined;
    if( stmt.elseBranch )
    {
        const elseCtx = ctx.newBranchChildScope();
        applyNarrowingsToScope(
            elseCtx.scope,
            extractIsNarrowings( coditionExpr, false )
        );
        elseBranch = wrapManyStatements(
            _compileStatement( elseCtx, stmt.elseBranch ),
            stmt.elseBranch.range
        );
        if( !elseBranch ) return undefined;
    }

    return [
        new TirIfStmt(
            coditionExpr,
            thenBranch,
            elseBranch,
            stmt.range
        )
    ];
}