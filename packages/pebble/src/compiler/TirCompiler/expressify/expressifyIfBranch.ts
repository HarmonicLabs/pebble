import { Identifier } from "../../../ast/nodes/common/Identifier";
import { TirLitNamedObjExpr } from "../../tir/expressions/litteral/TirLitNamedObjExpr";
import { TirLitVoidExpr } from "../../tir/expressions/litteral/TirLitVoidExpr";
import { TirExpr } from "../../tir/expressions/TirExpr";
import { TirVariableAccessExpr } from "../../tir/expressions/TirVariableAccessExpr";
import { TirAssertStmt } from "../../tir/statements/TirAssertStmt";
import { TirAssignmentStmt } from "../../tir/statements/TirAssignmentStmt";
import { TirBlockStmt } from "../../tir/statements/TirBlockStmt";
import { TirBreakStmt } from "../../tir/statements/TirBreakStmt";
import { TirContinueStmt } from "../../tir/statements/TirContinueStmt";
import { TirFailStmt } from "../../tir/statements/TirFailStmt";
import { TirTraceStmt } from "../../tir/statements/TirTraceStmt";
import { TirForOfStmt } from "../../tir/statements/TirForOfStmt";
import { TirForStmt } from "../../tir/statements/TirForStmt";
import { TirIfStmt } from "../../tir/statements/TirIfStmt";
import { TirMatchStmt } from "../../tir/statements/TirMatchStmt";
import { TirReturnStmt } from "../../tir/statements/TirReturnStmt";
import { TirStmt } from "../../tir/statements/TirStmt";
import { isTirVarDecl } from "../../tir/statements/TirVarDecl/TirVarDecl";
import { TirWhileStmt } from "../../tir/statements/TirWhileStmt";
import { TirSoPStructType, TirStructConstr } from "../../tir/types/TirStructType";
import { expressifyFuncBody, LoopReplacements, syntheticStateReturns } from "./expressify";
import { ExpressifyCtx } from "./ExpressifyCtx";

export function expressifyIfBranch(
    ctx: ExpressifyCtx,
    branch: TirStmt,
    reassignedNames: string[],
    sop: TirSoPStructType,
    loopReplacements: LoopReplacements | undefined
): TirExpr
{
    ctx.returnType = sop;

    const body = branch instanceof TirBlockStmt ? branch.stmts : [ branch ];

    // NOTE: user `return` statements are NOT pre-wrapped here anymore.
    // `expressifyFuncBody`'s return handling wraps each one into the
    // NEAREST state layer's `EarlyReturn` (it sees `ctx.returnType = sop`),
    // and the exit-case arms bubble it outward one layer at a time — the
    // old eager pre-walk double-wrapped nested returns (the loop-level
    // machinery re-wrapped the already-wrapped value), silently DROPPING
    // returns nested two or more branch levels deep inside loops.

    // add a final return statement (if it doesn't end with one)
    // returning the first constr, with the modified variables
    const lastIdx = body.length - 1;
    if(
        body.length === 0 ||
        !(body[lastIdx] instanceof TirReturnStmt)
    ) {
        const fstConstr = sop.constructors[0];
        const fields = fstConstr.fields;
        const syntheticTail = new TirReturnStmt(
            new TirLitNamedObjExpr(
                new Identifier( fstConstr.name, branch.range ),
                fields.map( f => new Identifier( f.name, branch.range ) ),
                fields.map(( f, i ) => new TirVariableAccessExpr(
                        {
                            variableInfos: {
                                name: reassignedNames[i],
                                type: f.type,
                                isConstant: false
                            },
                            isDefinedOutsideFuncScope: false,
                        },
                        branch.range
                    )
                ),
                sop,
                branch.range
            ),
            branch.range
        );
        // the tail's value IS the state sop — exempt from return wrapping
        syntheticStateReturns.add( syntheticTail );
        body.push( syntheticTail );
    }

    // finally expressify as normal function body, but with `sop` as return type
    return expressifyFuncBody(
        ctx,
        body,
        loopReplacements
    );
}
