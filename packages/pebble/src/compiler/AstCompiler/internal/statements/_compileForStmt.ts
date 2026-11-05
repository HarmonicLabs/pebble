import { AssignmentStmt } from "../../../../ast/nodes/statements/AssignmentStmt";
import { ForStmt } from "../../../../ast/nodes/statements/ForStmt";
import { TirAssignmentStmt } from "../../../tir/statements/TirAssignmentStmt";
import { TirForStmt } from "../../../tir/statements/TirForStmt";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { bool_t } from "../../../tir/program/stdScope/stdScope";
import { wrapManyStatements } from "../../utils/wrapManyStatementsOrReturnSame";
import { _compileExpr } from "../exprs/_compileExpr";
import { _compileAssignmentStmt } from "./_compileAssignmentStmt";
import { _compileStatement } from "./_compileStatement";
import { _compileVarStmt } from "./_compileVarStmt";
import { TirSimpleVarDecl } from "../../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";

export function _compileForStmt(
    ctx: AstCompilationCtx,
    stmt: ForStmt
): [ TirForStmt ] | undefined
{
    const loopScope = ctx.newLoopChildScope();
    loopScope.scope.range = stmt.range;

    const _tirInit = stmt.init ? _compileVarStmt( loopScope, stmt.init ) : undefined;
    if( !_tirInit ) return undefined;
    const nonSimpleDecl = _tirInit.filter( s => !(s instanceof TirSimpleVarDecl) );
    if( nonSimpleDecl.length > 0 )
    {
        for( const decl of nonSimpleDecl )
        {
            ctx.error(
                DiagnosticCode.for_loop_initialization_variables_cannot_be_destructured_Declare_it_as_a_simple_variable_and_move_the_destructuring_in_the_loop_body,
                decl.range,
            );
        }
        return undefined;
    }

    const tirInit: TirSimpleVarDecl[] = _tirInit as TirSimpleVarDecl[];

    const tirCond = stmt.condition ? _compileExpr( loopScope, stmt.condition, bool_t ) : undefined;
    if( !tirCond ) return undefined;

    const tirUpdates = _compileForUpdateStmts( loopScope, stmt.updates );
    if( !tirUpdates ) return undefined;

    const tirBody = wrapManyStatements(
        _compileStatement(
            loopScope.newBranchChildScope(),
            stmt.body
        ),
        stmt.body.range
    );
    if( !tirBody ) return undefined;

    return [ new TirForStmt(
        tirInit,
        tirCond,
        tirUpdates,
        tirBody,
        stmt.range
    ) ];
}
export function _compileForUpdateStmts(
    ctx: AstCompilationCtx,
    stmts: AssignmentStmt[]
): TirAssignmentStmt[] | undefined
{
    const tirStmts: TirAssignmentStmt[] = [];
    for( let stmt of stmts )
    {
        const tirStmt = _compileAssignmentStmt( ctx, stmt );
        // empty array here returns undefined
        // that is fine, because an empty array of assignments
        // is not a valid statement
        if( !tirStmt ) return undefined;
        tirStmts.push( ...tirStmt );
    }
    return tirStmts;
}