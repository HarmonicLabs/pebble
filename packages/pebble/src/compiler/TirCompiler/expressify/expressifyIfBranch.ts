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
import { expressifyFuncBody, LoopReplacements } from "./expressify";
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

    const earlyReturnConstr: TirStructConstr | undefined = sop.constructors[1];

    const wrapReturnExpr: (( expr: TirExpr ) => TirLitNamedObjExpr) | undefined = !earlyReturnConstr ? undefined :
    ( expr: TirExpr ): TirLitNamedObjExpr => new TirLitNamedObjExpr(
        new Identifier( earlyReturnConstr.name, expr.range ),
        [ new Identifier( earlyReturnConstr.fields[0].name, expr.range ) ],
        [ expr ],
        sop,
        expr.range
    );

    // replace explicit return statements wrapping the return value in the second constr
    replaceReturnStatements(
        body,
        wrapReturnExpr,
        sop
    );

    // add a final return statement (if it doesn't end with one)
    // returning the first constr, with the modified variables
    const lastIdx = body.length - 1;
    if(
        body.length === 0 ||
        !(body[lastIdx] instanceof TirReturnStmt)
    ) {
        const fstConstr = sop.constructors[0];
        const fields = fstConstr.fields;
        body.push(
            new TirReturnStmt(
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
            )
        );
    }

    // finally expressify as normal function body, but with `sop` as return type
    return expressifyFuncBody(
        ctx,
        body,
        loopReplacements
    );
}

function replaceReturnStatements(
    body: TirStmt[],
    wrapReturnExpr: (( expr: TirExpr ) => TirLitNamedObjExpr) | undefined,
    sopType: TirSoPStructType
): void
{
    const hasEarlyReturn = typeof wrapReturnExpr === "function";
    for( let i = 0; i < body.length; i++ ) {
        const stmt = body[i];

        // replace the return statement with a new one
        // that returns the first constr, with the modified variables
        if( stmt instanceof TirReturnStmt ) {
            if( !hasEarlyReturn ) throw new Error( "unexpected early return statement." );
            stmt.value = wrapReturnExpr( stmt.value ?? new TirLitVoidExpr( stmt.range ) );
            body[i] = stmt;
            continue;
        }

        if(
            isTirVarDecl( stmt )
            || stmt instanceof TirBreakStmt
            || stmt instanceof TirContinueStmt
            || stmt instanceof TirFailStmt
            || stmt instanceof TirTraceStmt
            || stmt instanceof TirAssertStmt
            || stmt instanceof TirAssignmentStmt
        ) continue;

        if( stmt instanceof TirBlockStmt ) {
            replaceReturnStatements(
                stmt.stmts,
                wrapReturnExpr,
                sopType
            );
            continue;
        }
        if( stmt instanceof TirIfStmt )
        {
            stmt.thenBranch = stmt.thenBranch instanceof TirBlockStmt ?
                stmt.thenBranch :
                new TirBlockStmt([ stmt.thenBranch ], stmt.range );
            replaceReturnStatements(
                (stmt.thenBranch as TirBlockStmt).stmts,
                wrapReturnExpr,
                sopType
            );

            if( stmt.elseBranch )
            {
                stmt.elseBranch = stmt.elseBranch instanceof TirBlockStmt ?
                    stmt.elseBranch :
                    new TirBlockStmt([ stmt.elseBranch ], stmt.range );
                replaceReturnStatements(
                    (stmt.elseBranch as TirBlockStmt).stmts,
                    wrapReturnExpr,
                    sopType
                );
            }
            continue;
        }

        if( stmt instanceof TirMatchStmt )
        {
            for( let i = 0; i < stmt.cases.length; i++ ) {
                const matchCase = stmt.cases[i];
                matchCase.body = matchCase.body instanceof TirBlockStmt ?
                    matchCase.body :
                    new TirBlockStmt([ matchCase.body ], matchCase.range );
                replaceReturnStatements(
                    (matchCase.body as TirBlockStmt).stmts,
                    wrapReturnExpr,
                    sopType
                );
            }
            // TODO: do wildcard
            continue;
        }

        if(
            stmt instanceof TirForStmt
            || stmt instanceof TirForOfStmt
            || stmt instanceof TirWhileStmt
        ) {
            stmt.body = stmt.body instanceof TirBlockStmt ?
                stmt.body :
                new TirBlockStmt([ stmt.body ], stmt.range );
            replaceReturnStatements(
                (stmt.body as TirBlockStmt).stmts,
                wrapReturnExpr,
                sopType
            );
            continue;
        }

        const tsEnsureExhautstiveCheck: never = stmt;
    }
}