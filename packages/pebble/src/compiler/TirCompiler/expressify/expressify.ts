import { SourceRange } from "../../../ast/Source/SourceRange";
import { getUniqueInternalName } from "../../internalVar";
import { TirLitVoidExpr } from "../../tir/expressions/litteral/TirLitVoidExpr";
import { TirCaseExpr, TirCaseMatcher, TirWildcardCaseMatcher } from "../../tir/expressions/TirCaseExpr";
import { TirExpr } from "../../tir/expressions/TirExpr";
import { TirFailExpr } from "../../tir/expressions/TirFailExpr";
import { TirTraceExpr } from "../../tir/expressions/TirTraceExpr";
import { TirFuncExpr } from "../../tir/expressions/TirFuncExpr";
import { TirLettedExpr } from "../../tir/expressions/TirLettedExpr";
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
import { TirArrayLikeDeconstr } from "../../tir/statements/TirVarDecl/TirArrayLikeDeconstr";
import { TirNamedDeconstructVarDecl } from "../../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSimpleVarDecl } from "../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirSingleDeconstructVarDecl } from "../../tir/statements/TirVarDecl/TirSingleDeconstructVarDecl";
import { TirWhileStmt } from "../../tir/statements/TirWhileStmt";
import { TirDataStructType, TirSoPStructType } from "../../tir/types/TirStructType";
import { ExpressifyCtx } from "./ExpressifyCtx";
import { expressifyVarAssignmentStmt } from "./expressifyVarAssignmentStmt";
import { isSingleConstrStruct } from "./isSingleConstrStruct";
import { expressifyVars } from "./expressifyVars";
import { toNamedDeconstructVarDecl } from "./toNamedDeconstructVarDecl";
import { flattenSopNamedDeconstructInplace_addTopDestructToCtx_getNestedDeconstruct } from "./flattenSopNamedDeconstructInplace_addTopDestructToCtx_getNestedDeconstruct";
import { TirAssertAndContinueExpr } from "../../tir/expressions/TirAssertAndContinueExpr";
import { expressifyTerminatingIfStmt } from "./expressifyTerminatingIfStmt";
import { determineReassignedVariablesAndFlowInfos, determineReassignedVariablesAndReturn, getBodyStateType, getBranchStmtReturnType, ReassignedVariablesAndReturn } from "./determineReassignedVariablesAndReturn";
import { TirTernaryExpr } from "../../tir/expressions/TirTernaryExpr";
import { expressifyIfBranch } from "./expressifyIfBranch";
import { expressifyForStmt, loopToForStmt } from "./expressifyForStmt";
import { getListTypeArg } from "../../tir/types/utils/getListTypeArg";
import { TirElemAccessExpr } from "../../tir/expressions/TirElemAccessExpr";
import { TirLitIntExpr } from "../../tir/expressions/litteral/TirLitIntExpr";
import { TirVarDecl } from "../../tir/statements/TirVarDecl/TirVarDecl";
import { TirCallExpr } from "../../tir/expressions/TirCallExpr";
import { TirNativeFunc } from "../../tir/expressions/TirNativeFunc";
import { TypedProgram } from "../../tir/program/TypedProgram";

export function expressify(
    func: TirFuncExpr,
    loopReplacements: LoopReplacements | undefined,
    program: TypedProgram,
    parentCtx: ExpressifyCtx | undefined = undefined,
): void
{
    const ctx = new ExpressifyCtx( parentCtx, func.returnType, program );

    // define in case of recursion
    ctx.setFuncParam( func.name, func.type  );
    ctx.introduceFuncParams( func.params );

    func.body.stmts = [
        new TirReturnStmt(
            expressifyFuncBody( ctx, func.body.stmts, loopReplacements ),
            func.body.range
        )
    ];
}

export interface LoopReplacements {
    readonly replaceReturnValue   : ( ctx: ExpressifyCtx, stmt: TirReturnStmt ) => TirExpr;
    readonly compileBreak    : ( ctx: ExpressifyCtx, stmt: TirBreakStmt      ) => TirExpr;
    readonly compileContinue : ( ctx: ExpressifyCtx, stmt: TirContinueStmt   ) => TirExpr;
}

export function expressifyFuncBody(
    ctx: ExpressifyCtx,
    bodyStmts: TirStmt[],
    // passed when compiling loops
    loopReplacements: LoopReplacements | undefined,
    assertions: TirAssertStmt[] = [],
): TirExpr
{
    bodyStmts = bodyStmts.slice();
    let stmt: TirStmt;
    while( stmt = bodyStmts.shift()! ) {

        // const isEdgeCase = stmt instanceof TirForStmt || stmt instanceof TirForOfStmt || stmt instanceof TirWhileStmt;
        // if( isEdgeCase ) console.log([stmt, ...bodyStmts].map(s => s.toString()));
        // if( isEdgeCase ) console.log( stmt );

        if( stmt instanceof TirBreakStmt ) {
            if( typeof loopReplacements?.compileBreak !== "function" ) throw new Error("break statement in function body.");
            
            return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                assertions,
                loopReplacements.compileBreak( ctx, stmt )
            );
        }
        else if( stmt instanceof TirContinueStmt ) {
            if( typeof loopReplacements?.compileContinue !== "function" ) throw new Error("continue statement in function body.");
            
            return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                assertions,
                loopReplacements.compileContinue( ctx, stmt )
            );
        }
        else if( stmt instanceof TirReturnStmt ) {
            if( stmt.value ) {
                let modifiedExpr = expressifyVars( ctx, stmt.value );
                if( typeof loopReplacements?.replaceReturnValue === "function" ) {
                    modifiedExpr = loopReplacements.replaceReturnValue( ctx, stmt );
                }
                stmt.value = modifiedExpr;
                
                return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                    assertions,
                    modifiedExpr
                );
            }
            else {
                return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                    assertions,
                    new TirLitVoidExpr( stmt.range )
                );
            }
        }
        // if( isTirVarDecl( stmt ) ) expressifyVarDecl( ctx, stmt );
        else if( stmt instanceof TirSimpleVarDecl ) {
            if( !stmt.initExpr ) throw new Error("simple var decl without init expr");
            const initExpr = expressifyVars( ctx, stmt.initExpr );
            stmt.initExpr = initExpr;

            const lettedExpr = initExpr instanceof TirLettedExpr ? initExpr : ctx.introduceLettedConstant(
                stmt.name,
                initExpr,
                stmt.range
            );
            if( !stmt.isConst ) {
                ctx.setNewVariableName( stmt.name, lettedExpr.varName );
            }

            if( !isSingleConstrStruct( stmt.type ) ) continue;

            if(
                ( initExpr instanceof TirVariableAccessExpr || initExpr instanceof TirLettedExpr )
                && ctx.properties.has( initExpr.varName )
            ) continue; // field extraction was already done
            
            if( stmt.type instanceof TirSoPStructType )
            {
                const pattern = getConstrDestructPattern(
                    stmt.type,
                    stmt.range,
                    undefined, // no init expr (pattern is used as case matcher)
                    0
                );
                ctx.introduceSopConstrFieldsAsProperties( stmt.name, pattern );
                // nested single constr structs
                // are added as destructed variables in the matcher body
                // using `getNestedDestructsInSingleSopDestructPattern`
                
                return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                    assertions,
                    new TirCaseExpr(
                        lettedExpr,
                        [ new TirCaseMatcher(
                            pattern,
                            expressifyFuncBody(
                                ctx,
                                (getNestedDestructsInSingleSopDestructPattern( pattern ) as TirStmt[])
                                .concat( bodyStmts ),
                                loopReplacements
                            ),
                            stmt.range
                        ) ],
                        undefined, // no wildcard case
                        ctx.returnType,
                        stmt.range
                    )
                );
            }
            else if( stmt.type instanceof TirDataStructType )
            {
                ctx.introduceSingleConstrDataLettedFields(
                    stmt.name,
                    stmt.initExpr,
                    stmt.type
                );
                continue;
            }
            continue;
        }
        else if(
            stmt instanceof TirSingleDeconstructVarDecl
            || stmt instanceof TirNamedDeconstructVarDecl
        ) {
            stmt = toNamedDeconstructVarDecl( stmt );

            // for some reason typescript goes crazy with types here
            if( stmt instanceof TirBreakStmt ) throw new Error("unreachable");
            else if( stmt instanceof TirContinueStmt ) throw new Error("unreachable");
            else if( stmt instanceof TirSingleDeconstructVarDecl ) throw new Error("unreachable");

            if( !stmt.initExpr ) throw new Error("simple var decl without init expr");
            const initExpr = expressifyVars( ctx, stmt.initExpr );
            stmt.initExpr = initExpr;

            const lettedName = getUniqueInternalName( stmt.type.toString().toLowerCase() );
            const lettedExpr = ctx.introduceLettedConstant(
                lettedName,
                initExpr,
                stmt.range
            );

            if( stmt.type instanceof TirSoPStructType )
            {
                const nestedDeconstructs = flattenSopNamedDeconstructInplace_addTopDestructToCtx_getNestedDeconstruct(
                    stmt,
                    ctx
                );
                // nested single constr structs
                // are added as destructed variables in the matcher body
                // using `getNestedDestructsInSingleSopDestructPattern`
                
                return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                    assertions,
                    new TirCaseExpr(
                        lettedExpr,
                        [ new TirCaseMatcher(
                            stmt,
                            expressifyFuncBody(
                                ctx,
                                (nestedDeconstructs as TirStmt[])
                                .concat( bodyStmts ),
                                loopReplacements
                            ),
                            stmt.range
                        ) ],
                        new TirWildcardCaseMatcher(
                            new TirFailExpr( undefined, ctx.returnType, stmt.range ),
                            stmt.range
                        ),
                        ctx.returnType,
                        stmt.range
                    )
                );
            }
            else if( stmt.type instanceof TirDataStructType ) {
                const { implicitAssertions, nestedDeconstructs } = ctx.introduceDeconstrDataLettedFields( stmt, lettedExpr );
                assertions.push( ...implicitAssertions );
                bodyStmts.unshift( ...nestedDeconstructs );
                continue;
            }

            throw new Error("deconstruction of non-struct type" + stmt.type.toString() );
        }
        else if( stmt instanceof TirArrayLikeDeconstr ) {

            if( !stmt.initExpr ) throw new Error("array-like deconstruction with init expr is not supported");
            
            const listType = stmt.type;
            const elemType = getListTypeArg( stmt.type );
            if( !elemType ) throw new Error("array-like deconstruction without element type is not supported");

            const uniqueArrName = getUniqueInternalName("deconstructed_list_0");
            let lettedArr = ctx.introduceLettedConstant(
                uniqueArrName,
                expressifyVars( ctx, stmt.initExpr ),
                stmt.range
            );

            const modTails = 3;
            const nextDeclarations: TirVarDecl[] = [];

            for( let i = 0; i < stmt.elements.length; i++ )
            {
                const elem = stmt.elements[i];
                const uniqueVarName = getUniqueInternalName("elem_" + i.toString());

                const nTails = i % modTails; // every 3 we hoist the intermediate list

                let lettedElem: TirLettedExpr;
                if( nTails === 0 && i > 0 ) {
                    // hoist the list
                    lettedArr = ctx.introduceLettedConstant(
                        uniqueArrName,
                        new TirElemAccessExpr(
                            lettedArr,
                            new TirLitIntExpr( BigInt( modTails ), elem.range ),
                            listType,
                            elem.range
                        ),
                        stmt.range
                    );
                    lettedElem = ctx.introduceLettedConstant(
                        uniqueVarName,
                        new TirElemAccessExpr(
                            lettedArr,
                            new TirLitIntExpr( BigInt(0), elem.range ),
                            elemType,
                            elem.range
                        ),
                        elem.range
                    );
                }
                else {
                    lettedElem = ctx.introduceLettedConstant(
                        uniqueVarName,
                        new TirElemAccessExpr(
                            lettedArr,
                            new TirLitIntExpr( BigInt( nTails ), elem.range ),
                            elemType,
                            elem.range
                        ),
                        elem.range
                    );
                }

                if( elem instanceof TirSimpleVarDecl )
                {
                    ctx.setNewVariableName( elem.name, uniqueVarName );
                }
                else {
                    elem.initExpr = lettedElem;
                    nextDeclarations.push( elem );
                }
            }

            if( stmt.rest ) {
                const uniqueRestName = getUniqueInternalName( stmt.rest );
                const restLetted = ctx.introduceLettedConstant(
                    uniqueRestName,
                    new TirCallExpr(
                        TirNativeFunc._dropList( elemType ),
                        [
                            new TirLitIntExpr( BigInt( stmt.elements.length % modTails ), stmt.range ),
                            lettedArr
                        ],
                        listType,
                        stmt.range
                    ),
                    stmt.range
                );
                ctx.setNewVariableName( stmt.rest, uniqueRestName );
            }

            bodyStmts.push( ...nextDeclarations );
            continue;
        }
        else if( stmt instanceof TirAssignmentStmt ) {
            void expressifyVarAssignmentStmt( ctx, stmt );

            // !!! IMPORTANT BUG !!!
            // .unshift the resulting `TirSimpleVarDecl` into bodyStmts
            // will cause the assigned expression to be re-expressified
            // meaning that variables that depend on themselves (e.g. `x = x + 1`) will be processed twice
            //
            // x = (x + 1) --> const x_i = (x + 1) --> const x_i = (x_i/*x + 1*/ */ + 1) (??? BUG ???)
            //
            // so ultimately `x = x + 1` would be compiled as `x = x + 1 + 1`
            //
            // const constDecl = expressifyVarAssignmentStmt( ctx, stmt );
            // bodyStmts.unshift( constDecl );
            continue;
        }
        else if( stmt instanceof TirBlockStmt ) {
            // inline the block
            bodyStmts = stmt.stmts.concat( bodyStmts );
            continue;
        }
        else if( stmt instanceof TirFailStmt ) {
            if( stmt.failMsgExpr ) {
                const modifiedExpr = expressifyVars( ctx, stmt.failMsgExpr );
                stmt.failMsgExpr = modifiedExpr;

                
                return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                    assertions,
                    new TirFailExpr(
                        modifiedExpr,
                        ctx.returnType,
                        stmt.range
                    )
                );
            }
            else {
                
                return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                    assertions,
                    new TirFailExpr( undefined, ctx.returnType, stmt.range )
                );
            }
        }
        else if( stmt instanceof TirTraceStmt ) {
            const modifiedExpr = expressifyVars( ctx, stmt.expr );
            stmt.expr = modifiedExpr;

            const continuation = expressifyFuncBody( ctx, bodyStmts, loopReplacements );

            return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                assertions,
                new TirTraceExpr( modifiedExpr, continuation, stmt.range )
            );
        }
        else if( stmt instanceof TirAssertStmt ) {
            const condition = expressifyVars( ctx, stmt.condition );
            stmt.condition = condition;

            if( stmt.elseExpr ) {
                const elseExpr = expressifyVars( ctx, stmt.elseExpr );
                stmt.elseExpr = elseExpr;
            }

            assertions.push( stmt );
            continue;
        }
        else if( stmt instanceof TirIfStmt ) {
            if( stmt.thenBranch.definitelyTerminates() ) {
                const elseBranchStmts: TirStmt[] = [];
                if( stmt.elseBranch ) {
                    if( stmt.elseBranch instanceof TirBlockStmt ) {
                        elseBranchStmts.push( ...stmt.elseBranch.stmts );
                    }
                    else {
                        elseBranchStmts.push( stmt.elseBranch );
                    }
                }

                // move the rest of the body into the else branch
                elseBranchStmts.push(
                    ...bodyStmts
                );

                stmt.elseBranch = new TirBlockStmt(
                    elseBranchStmts,
                    stmt.elseBranch?.range ?? stmt.thenBranch.range
                );

                
                return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                    assertions,
                    expressifyTerminatingIfStmt( ctx, stmt, loopReplacements )
                );
            }
            else if( stmt.elseBranch && stmt.elseBranch.definitelyTerminates() ) {
                const thenBranchStmts: TirStmt[] = [];
                if( stmt.thenBranch instanceof TirBlockStmt ) {
                    thenBranchStmts.push( ...stmt.thenBranch.stmts );
                }
                else {
                    thenBranchStmts.push( stmt.thenBranch );
                }

                // move the rest of the body into the then branch
                thenBranchStmts.push(
                    ...bodyStmts
                );
                stmt.thenBranch = new TirBlockStmt(
                    thenBranchStmts,
                    stmt.thenBranch.range
                );

                
                return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                    assertions,
                    expressifyTerminatingIfStmt( ctx, stmt, loopReplacements )
                );
            }

            // determine affected variables
            // determine if we have an early return
            const reassignsAndReturns = determineReassignedVariablesAndReturn( stmt );

            // build a SoP type to return
            const { sop, initState } = getBranchStmtReturnType( reassignsAndReturns, ctx, stmt.range );

            const condition = expressifyVars( ctx, stmt.condition );

            const stmtExpr = new TirTernaryExpr(
                condition,
                expressifyIfBranch(
                    ctx.newChild(),
                    stmt.thenBranch,
                    reassignsAndReturns.reassigned,
                    sop,
                    loopReplacements
                ),
                stmt.elseBranch ? expressifyIfBranch(
                    ctx.newChild(),
                    stmt.elseBranch,
                    reassignsAndReturns.reassigned,
                    sop,
                    loopReplacements
                ) : initState, // no else branch means the variables stay unchanged
                sop,
                stmt.range
            );

            // expressify as ternary that returns the SoP type
            
            return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                assertions,
                wrapNonTerminatingFinalStmtAsCaseExpr(
                    stmtExpr,
                    sop,
                    ctx,
                    stmt.range,
                    reassignsAndReturns,
                    bodyStmts,
                    loopReplacements
                )
            );
        }
        else if( stmt instanceof TirMatchStmt ) {

            /**
             * index of the **only** case that does not terminate
             * 
             * if it is undefined, then all cases terminate
             * if it is negative, then more than one case does not terminate
             * if it is positive, then only one case does not terminate and this is the index
            **/
            let doesNotTerminateIdx: number | undefined = undefined;
            for( let i = 0; i < stmt.cases.length; i++ )
            {
                const _case = stmt.cases[i];
                if( _case.body.definitelyTerminates() ) continue;

                if( typeof doesNotTerminateIdx !== "number" )
                    doesNotTerminateIdx = i;
                else {
                    doesNotTerminateIdx = -1; // more than one case does not terminate
                    break;
                }
            }

            const onlyOneCaseDoesNotTerminate = typeof doesNotTerminateIdx === "number" && doesNotTerminateIdx >= 0;
            if( onlyOneCaseDoesNotTerminate )
            {
                const theDude = stmt.cases[doesNotTerminateIdx!];
                
                theDude.body = theDude.body instanceof TirBlockStmt ? theDude.body : new TirBlockStmt(
                    [ theDude.body ],
                    theDude.body.range
                );
                (theDude.body as TirBlockStmt).stmts.push(
                    ...bodyStmts
                );
            }
            
            const isDirectReturn =
                typeof doesNotTerminateIdx !== "number" // all cases terminate
                || onlyOneCaseDoesNotTerminate;

            const reassignsAndReturns = determineReassignedVariablesAndReturn( stmt );

            if( isDirectReturn )
            {
                // build a SoP type to return
                // const { sop, initState } = getBranchStmtReturnType( reassignsAndReturns, ctx, stmt.range );

                const finalExpression = new TirCaseExpr(
                    expressifyVars( ctx, stmt.matchExpr ),
                    stmt.cases.map( _case => {
                        if( _case.pattern instanceof TirArrayLikeDeconstr )
                        throw new Error("array-like deconstruction in match statement is not supported");

                        _case.pattern = toNamedDeconstructVarDecl( _case.pattern );

                        const caseCtx = ctx.newChild();

                        flattenSopNamedDeconstructInplace_addTopDestructToCtx_getNestedDeconstruct(
                            _case.pattern,
                            caseCtx
                        );

                        const caseBody = expressifyFuncBody(
                            caseCtx,
                            _case.body instanceof TirBlockStmt
                                ? _case.body.stmts
                                : [ _case.body ],
                            loopReplacements,
                            [], // no assertions (checked before evaluating case expression))
                        );

                        return new TirCaseMatcher(
                            _case.pattern,
                            caseBody,
                            _case.range
                        );
                    }),
                    stmt.wildcardCase ? new TirWildcardCaseMatcher(
                        expressifyFuncBody(
                            ctx.newChild(),
                            stmt.wildcardCase.body instanceof TirBlockStmt
                                ? stmt.wildcardCase.body.stmts
                                : [ stmt.wildcardCase.body ],
                            loopReplacements,
                            [], // no assertions (checked before evaluating case expression))
                        ),
                        stmt.wildcardCase.range
                    ) : undefined,
                    ctx.returnType,
                    stmt.range
                );

                // expressify as ternary that returns the SoP type
                
                return TirAssertAndContinueExpr.fromStmtsAndContinuation(
                    assertions,
                    // isDirectReturn === true, so we don't need to wrap
                    finalExpression
                    /*
                    true ? finalExpression : wrapNonTerminatingFinalStmtAsCaseExpr(
                        finalExpression,
                        sop,
                        ctx,
                        stmt.range,
                        reassignsAndReturns,
                        bodyStmts,
                        loopReplacements
                    )
                    //*/
                );
            }

            throw new Error("match statement with multiple non-terminating cases is not implemented yet (sorry)");
        }
        // else if( stmt instanceof TirForOfStmt ) {
        // 
        //     const definitelyTerminates = stmt.definitelyTerminates();
        // 
        //     // determine affected variables
        //     // determine if we may have an early return
        //     // determine if we can break or continue
        //     const reassignedAndFlow = determineReassignedVariablesAndFlowInfos( stmt );
        //     const {
        //         reassigned,
        //         returns,
        //         canBreak,
        //         canContinue
        //     } = reassignedAndFlow;
        //     const { sop, initState } = getBranchStmtReturnType( reassignedAndFlow, ctx, stmt.range );
        // 
        //     if(
        //         !returns
        //         && !canBreak
        //         // && !canContinue
        //     ) {
        //         // **only for...of** can be optimized as a simple `.reduce`
        //         // producing the new state in this case
        //         // (`.reduce` has no way to break or early return (efficiently))
        //         // continue is ok, because we only need to pass the state up to that point
        //     }
        // 
        // }
        else if(
            stmt instanceof TirForStmt
            || stmt instanceof TirWhileStmt
            || stmt instanceof TirForOfStmt
        )
        {
            const definitelyTerminates = stmt.definitelyTerminates();
            const reassignedAndFlow = determineReassignedVariablesAndFlowInfos( stmt );
            const returnTypeAndInvalidInit = getBranchStmtReturnType( reassignedAndFlow, ctx, stmt.range );
            const forStmt = loopToForStmt( stmt );
            const { bodyStateType, initState } = getBodyStateType(
                returnTypeAndInvalidInit,
                forStmt
            );
            const loopExprCtx = ctx.newChild();
            const loopExpr = expressifyForStmt(
                loopExprCtx,
                forStmt,
                returnTypeAndInvalidInit.sop,
                bodyStateType,
                initState
            );

            const result = TirAssertAndContinueExpr.fromStmtsAndContinuation(
                assertions,
                definitelyTerminates ? loopExpr : wrapNonTerminatingFinalStmtAsCaseExpr(
                    loopExpr,
                    returnTypeAndInvalidInit.sop,
                    ctx,
                    stmt.range,
                    reassignedAndFlow,
                    bodyStmts,
                    loopReplacements
                )
            );

            return result;
        }
        else {
            // const tsEnsureExhautstiveCheck: never = stmt;
            // console.error( stmt );
            // throw new Error("unreachable::expressify::stmt");
        }
        const tsEnsureExhautstiveCheck: never = stmt;
        console.error( stmt );
        throw new Error("unreachable::expressify::stmt");
    }

    return TirAssertAndContinueExpr.fromStmtsAndContinuation(
        assertions,
        new TirLitVoidExpr( SourceRange.mock )
    );
}

function getConstrDestructPattern(
    type: TirSoPStructType,
    range: SourceRange,
    initExpr: TirExpr | undefined,
    constrIndex: number
): TirNamedDeconstructVarDecl
{
    const constr = type.constructors[constrIndex];
    if( !constr ) throw new Error("no constructor in single constr struct type");

    const deconstructedFields: Map<string, TirSimpleVarDecl> = new Map();
    for( const field of constr.fields ) {
        const uniqueName = getUniqueInternalName( field.name );
        deconstructedFields.set(
            field.name,
            new TirSimpleVarDecl(
                uniqueName,
                field.type,
                initExpr,
                false, // not a constant (reassigned if deconstruction statement already exists later)
                range
            )
        );
    }

    return new TirNamedDeconstructVarDecl(
        constr.name,
        deconstructedFields,
        undefined,
        type,
        undefined,
        false, // not a constant
        range
    );
}


function getNestedDestructsInSingleSopDestructPattern(
    pattern: TirNamedDeconstructVarDecl
): TirNamedDeconstructVarDecl[]
{
    const result : TirNamedDeconstructVarDecl[] = [];
    for( const [ fName, varDecl ] of pattern.fields )
    {
        if(!( varDecl instanceof TirSimpleVarDecl ))
        throw new Error("expected simple var decl in single destruct pattern");

        if(!( varDecl.type instanceof TirSoPStructType )) continue;

        result.push(
            getConstrDestructPattern(
                varDecl.type,
                varDecl.range,
                // init expr
                new TirVariableAccessExpr(
                    {
                        variableInfos: {
                            name: varDecl.name,
                            type: varDecl.type,
                            isConstant: true,
                        },
                        isDefinedOutsideFuncScope: false,
                    },
                    varDecl.range
                ),
                0
            )
        );
    }
    return result;
}

function wrapNonTerminatingFinalStmtAsCaseExpr(
    finalStmtExpr: TirExpr,
    sop: TirSoPStructType,
    ctx: ExpressifyCtx,
    stmtRange: SourceRange,
    reassignsAndReturns: ReassignedVariablesAndReturn,
    nextBodyStmts: TirStmt[],
    loopReplacements: LoopReplacements | undefined
): TirCaseExpr
{
    nextBodyStmts = nextBodyStmts.slice();
    const continuations: TirCaseMatcher[] = [];

    const contBranchCtx = ctx.newChild();
    const contConstr = sop.constructors[0];
    const contFields = contConstr.fields;

    const contPattern = new TirNamedDeconstructVarDecl(
        sop.constructors[0].name,
        new Map(
            contFields.map(( f, i ) => [
                f.name,
                new TirSimpleVarDecl(
                    getUniqueInternalName( f.name ),
                    f.type,
                    undefined, // no init expr (pattern is used as case matcher)
                    false, // not a constant
                    stmtRange
                )
            ])
        ),
        undefined, // no rest
        sop,
        undefined, // no init expr
        false, // not a constant
        stmtRange
    );

    const nestedDeconstructs = flattenSopNamedDeconstructInplace_addTopDestructToCtx_getNestedDeconstruct(
        contPattern,
        contBranchCtx
    );
    const mainContinuaiton = expressifyFuncBody(
        contBranchCtx,
        (nestedDeconstructs as TirStmt[])
        .concat( nextBodyStmts ),
        loopReplacements,
        [] // assertions are added before if statement exectution
    ); 

    continuations.push(
        new TirCaseMatcher(
            contPattern,
            mainContinuaiton,
            stmtRange
        )
    );


    if( reassignsAndReturns.returns ) {
        const earlyRetConstr = sop.constructors[1];
        const earlyRetField = earlyRetConstr.fields[0];
        const uniqueFieldName = getUniqueInternalName( earlyRetField.name );
        const earlyRetPattern = new TirNamedDeconstructVarDecl(
            earlyRetConstr.name,
            new Map([
                [
                    earlyRetField.name,
                    new TirSimpleVarDecl(
                        uniqueFieldName,
                        earlyRetField.type,
                        undefined, // no init expr (pattern is used as case matcher)
                        false, // not a constant
                        stmtRange
                    )
                ]
            ]),
            undefined, // no rest
            sop,
            undefined, // no init expr
            false, // not a constant
            stmtRange
        );
        continuations.push(
            new TirCaseMatcher(
                earlyRetPattern,
                new TirVariableAccessExpr(
                    {
                        variableInfos: {
                            name: uniqueFieldName,
                            type: earlyRetField.type,
                            isConstant: true,
                        },
                        isDefinedOutsideFuncScope: false,
                    },
                    stmtRange
                ),
                stmtRange
            )
        );
    }

    // expressify as ternary that returns the SoP type
    return new TirCaseExpr(
        finalStmtExpr,
        continuations,
        undefined, // no wildcard case
        ctx.returnType,
        stmtRange
    );
}