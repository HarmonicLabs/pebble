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
        const tirStmt = _compileStatement( blockCtx, blockStmt );
        if( !Array.isArray( tirStmt ) )
        {
            // a check (`TypedProgram.checkOnly`) leaves out a statement that failed, and goes on
            // with the next (a declaration that failed is declared all the same). Its error is
            // reported: in it, or at the declaration of a name it uses that failed (whose uses
            // report nothing more)
            if(
                ctx.program.checkOnly
                && blockCtx.diagnostics.some( d => d.category === DiagnosticCategory.Error )
            ) continue;
            return undefined;
        }
        tirStmts.push( ...tirStmt );
    }
    return [ new TirBlockStmt( tirStmts, stmt.range ) ];
}