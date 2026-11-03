import { getUniqueInternalName } from "../../internalVar";
import { TirLettedExpr } from "../../tir/expressions/TirLettedExpr";
import { TirAssignmentStmt } from "../../tir/statements/TirAssignmentStmt";
import { TirSimpleVarDecl } from "../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { ExpressifyCtx } from "./ExpressifyCtx";
import { debugAssignBinding, debugBindLetted } from "../../debug/debugHooks";
import { expressifyVars } from "./expressifyVars";

export function expressifyVarAssignmentStmt(
    ctx: ExpressifyCtx,
    stmt: TirAssignmentStmt
): void
{
    // since we no longer return a new TirSimpleVarDecl,
    // we need to expressify the assigned expression here
    // 
    // !!! IMPORTANT !!! we MUST NOT do it if we instead returned a new TirSimpleVarDecl,
    // otherwise it would be re-processed, casing bugs
    const assignedExpr = expressifyVars( ctx, stmt.assignedExpr );

    const originalName = stmt.varIdentifier.resolvedValue.variableInfos.name;
    const latestVarNameSSA = ctx.getVariableSSA( originalName );
    if( !latestVarNameSSA ) {
        throw new Error("re-assigning constant variable '" + originalName + "'");
    }

    const newUniqueName = getUniqueInternalName( originalName );
    ctx.setNewVariableName( originalName, newUniqueName );
    // point to the same object
    const letted = ctx.introduceLettedConstant(
        newUniqueName,
        assignedExpr,
        stmt.range
    );
    debugBindLetted( letted, debugAssignBinding( stmt, originalName ) );
    
    // will replace re-assignment in body
    // return new TirSimpleVarDecl(
    //     newUniqueName,
    //     stmt.varIdentifier.resolvedValue.variableInfos.type,
    //     assignedExpr,
    //     true, // isConst
    //     stmt.range,
    // );
}