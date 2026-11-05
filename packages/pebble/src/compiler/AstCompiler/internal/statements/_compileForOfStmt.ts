import { ForOfStmt } from "../../../../ast/nodes/statements/ForOfStmt";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirForOfStmt } from "../../../tir/statements/TirForOfStmt";
import { TirListT } from "../../../tir/types/TirNativeType";
import { TirTypeParam } from "../../../tir/types/TirTypeParam";
import { canAssignTo } from "../../../tir/types/utils/canAssignTo";
import { getListTypeArg } from "../../../tir/types/utils/getListTypeArg";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { wrapManyStatements } from "../../utils/wrapManyStatementsOrReturnSame";
import { _compileExpr } from "../exprs/_compileExpr";
import { _compileStatement } from "./_compileStatement";
import { _compileVarDecl, _firstDeclStmtRange } from "./_compileVarStmt";

export function _compileForOfStmt(
    ctx: AstCompilationCtx,
    stmt: ForOfStmt
): [ TirForOfStmt ] | undefined
{
    const any_list_t = new TirListT( new TirTypeParam("T") );

    const iterableExpr = _compileExpr(
        ctx,
        stmt.iterable,
        any_list_t
    );
    if( !iterableExpr ) return undefined;
    const elemsType = getListTypeArg( iterableExpr.type );
    if( !elemsType ) return ctx.error(
        DiagnosticCode.The_argument_of_a_for_of_statement_must_be_an_iterable,
        stmt.iterable.range
    );

    const loopCtx = ctx.newLoopChildScope();
    loopCtx.scope.range = stmt.range;

    const varDecl = stmt.elemDeclaration.declarations[0];
    const tirVarDecl = _compileVarDecl(
        loopCtx,
        varDecl,
        elemsType,
        _firstDeclStmtRange( stmt.elemDeclaration, varDecl )
    );
    if( !tirVarDecl ) return undefined;
    if( !canAssignTo( tirVarDecl.type, elemsType ) ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        varDecl.range, tirVarDecl.type.toString(), elemsType.toString()
    );

    const tirBody = wrapManyStatements(
        _compileStatement(
            loopCtx,
            stmt.body
        ),
        stmt.body.range
    );
    if( !tirBody ) return undefined;

    return [ new TirForOfStmt(
        tirVarDecl,
        iterableExpr,
        tirBody,
        stmt.range
    ) ];
}