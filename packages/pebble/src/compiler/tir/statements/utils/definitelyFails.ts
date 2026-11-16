import { TirAssertStmt } from "../TirAssertStmt";
import { TirAssignmentStmt } from "../TirAssignmentStmt";
import { TirBlockStmt } from "../TirBlockStmt";
import { TirBreakStmt } from "../TirBreakStmt";
import { TirContinueStmt } from "../TirContinueStmt";
import { TirFailStmt } from "../TirFailStmt";
import { TirForOfStmt } from "../TirForOfStmt";
import { TirForStmt } from "../TirForStmt";
import { TirIfStmt } from "../TirIfStmt";
import { TirMatchStmt } from "../TirMatchStmt";
import { TirReturnStmt } from "../TirReturnStmt";
import { TirStmt } from "../TirStmt";
import { isTirVarDecl } from "../TirVarDecl/TirVarDecl";
import { TirWhileStmt } from "../TirWhileStmt";

export function definitelyFails( stmt: TirStmt | TirBlockStmt ): boolean
{
    const stack: (TirStmt | TirBlockStmt)[] = [ stmt ];
    while( stmt = stack.pop()! )
    {
        if( stmt instanceof TirFailStmt ) return true;

        if( stmt instanceof TirBlockStmt ) {
            stack.push( ...stmt.stmts );
            continue;
        }

        if( isTirVarDecl( stmt ) ) continue;
        if( stmt instanceof TirIfStmt ) {
            stack.push( stmt.thenBranch );
            if( stmt.elseBranch ) stack.push( stmt.elseBranch );
            continue;
        }
        if( stmt instanceof TirMatchStmt ) {
            if( stmt.arms().every(({ body }) => definitelyFails( body )) ) return true;
            continue;
        }
        if(
            stmt instanceof TirForStmt
            || stmt instanceof TirForOfStmt
            || stmt instanceof TirWhileStmt
        ) {
            stack.push( stmt.body );
            continue;
        }
        if(
            stmt instanceof TirReturnStmt
            || stmt instanceof TirBlockStmt
            || stmt instanceof TirBreakStmt
            || stmt instanceof TirContinueStmt
            || stmt instanceof TirAssertStmt
            || stmt instanceof TirAssignmentStmt
        ) continue;

        // const tsEnsureExsaustiveCheck: never = stmt;
    }

    return false;
}