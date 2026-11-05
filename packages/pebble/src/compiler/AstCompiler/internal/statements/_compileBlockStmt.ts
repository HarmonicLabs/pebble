import { BlockStmt } from "../../../../ast/nodes/statements/BlockStmt";
import { DiagnosticCategory } from "../../../../diagnostics/DiagnosticCategory";
import { TirBlockStmt } from "../../../tir/statements/TirBlockStmt";
import { TirStmt } from "../../../tir/statements/TirStmt";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileStatement } from "./_compileStatement";

export function _compileBlockStmt(
    ctx: AstCompilationCtx,
    stmt: BlockStmt,
): [ TirBlockStmt ] | undefined
{
    const blockCtx = ctx.newBranchChildScope();
    blockCtx.scope.range = stmt.range;
    // stmt.stmts;
    const tirStmts: TirStmt[] = [];
    for( const blockStmt of stmt.stmts )
    {
        const nDiagnostics = blockCtx.diagnostics.length;
        const tirStmt = _compileStatement( blockCtx, blockStmt );
        if( !Array.isArray( tirStmt ) )
        {
            // a check (`TypedProgram.checkOnly`) leaves out a statement whose error is reported,
            // and goes on with the next (a declaration that failed is declared all the same)
            if(
                ctx.program.checkOnly
                && blockCtx.diagnostics.slice( nDiagnostics ).some( d => d.category === DiagnosticCategory.Error )
            ) continue;
            return undefined;
        }
        tirStmts.push( ...tirStmt );
    }
    return [ new TirBlockStmt( tirStmts, stmt.range ) ];
}