import { Identifier } from "../../../ast/nodes/common/Identifier";
import { SourceRange } from "../../../ast/Source/SourceRange";
import { getUniqueInternalName } from "../../internalVar";
import { TirLitNamedObjExpr } from "../../tir/expressions/litteral/TirLitNamedObjExpr";
import { TirCallExpr } from "../../tir/expressions/TirCallExpr";
import { TirExpr } from "../../tir/expressions/TirExpr";
import { TirFuncExpr } from "../../tir/expressions/TirFuncExpr";
import { TirPropAccessExpr } from "../../tir/expressions/TirPropAccessExpr";
import { TirVariableAccessExpr } from "../../tir/expressions/TirVariableAccessExpr";
import { TirUnaryExclamation } from "../../tir/expressions/unary/TirUnaryExclamation";
import { TirAssignmentStmt } from "../../tir/statements/TirAssignmentStmt";
import { TirBlockStmt } from "../../tir/statements/TirBlockStmt";
import { TirBreakStmt } from "../../tir/statements/TirBreakStmt";
import { TirContinueStmt } from "../../tir/statements/TirContinueStmt";
import { TirForOfStmt } from "../../tir/statements/TirForOfStmt";
import { TirForStmt } from "../../tir/statements/TirForStmt";
import { TirIfStmt } from "../../tir/statements/TirIfStmt";
import { TirReturnStmt } from "../../tir/statements/TirReturnStmt";
import { TirSimpleVarDecl } from "../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirWhileStmt } from "../../tir/statements/TirWhileStmt";
import { TirBoolT } from "../../tir/types/TirNativeType";
import { TirFuncT } from "../../tir/types/TirNativeType/native/function";
import { TirSoPStructType } from "../../tir/types/TirStructType";
import { TirType } from "../../tir/types/TirType";
import { getListTypeArg } from "../../tir/types/utils/getListTypeArg";
import { expressifyFuncBody, LoopReplacements } from "./expressify";
import { ExpressifyCtx, isExpressifyFuncParam } from "./ExpressifyCtx";
import { expressifyVars } from "./expressifyVars";

export function loopToForStmt( stmt: TirWhileStmt | TirForOfStmt | TirForStmt ): TirForStmt
{
    if(  stmt instanceof TirForStmt ) return stmt;

    if( stmt instanceof TirForOfStmt ) {
        // convert for of to for
        const partialListName = getUniqueInternalName("for_of_partial_list");
        const iterElemType = getListTypeArg( stmt.iterable.type );
        if( !iterElemType ) throw new Error("Iterable type is not a list");

        const varRange = stmt.elemDeclaration.range;

        const partialListVar = new TirSimpleVarDecl(
            partialListName, // name
            stmt.iterable.type, // type
            stmt.iterable, // initial value
            false, // is constant
            varRange // range
        );

        const partialListVarAccess = new TirVariableAccessExpr(
            {
                isDefinedOutsideFuncScope: false,
                variableInfos: {
                    name: partialListVar.name,
                    type: partialListVar.type,
                    isConstant: false,
                },
            },
            varRange
        );

        // `!partialList.isEmpty()`
        const runCondition = new TirUnaryExclamation(
            new TirCallExpr(
                new TirPropAccessExpr(
                    partialListVarAccess.clone(),
                    new Identifier("isEmpty", varRange ),
                    new TirFuncT( [], new TirBoolT() ),
                    varRange
                ),
                [], // args
                new TirBoolT(),
                varRange
            ),
            new TirBoolT(),
            varRange
        );

        const updatePartialList = new TirAssignmentStmt(
            partialListVarAccess.clone() as TirVariableAccessExpr,
            new TirCallExpr(
                new TirPropAccessExpr(
                    partialListVarAccess.clone(),
                    new Identifier("tail", varRange ),
                    new TirFuncT( [], stmt.iterable.type ),
                    varRange
                ),
                [], // args
                stmt.iterable.type,
                varRange
            ),
            varRange
        );

        let body = stmt.body instanceof TirBlockStmt ? stmt.body : new TirBlockStmt( [ stmt.body ], stmt.range );
        const elemDecl = stmt.elemDeclaration;
        elemDecl.initExpr = new TirCallExpr(
            new TirPropAccessExpr(
                partialListVarAccess.clone(),
                new Identifier("head", varRange ),
                new TirFuncT( [], iterElemType ),
                varRange
            ),
            [], // args
            iterElemType,
            varRange
        );
        body.stmts.unshift(
            elemDecl
        );

        return new TirForStmt(
            [ partialListVar ], // init
            runCondition, // condition
            [ updatePartialList ], // update
            body, // loopBody
            stmt.range, // range
        );
    }

    // convert while to for
    return new TirForStmt(
        [], // no init
        stmt.condition, // condition
        [], // no update
        stmt.body, // loopBody
        stmt.range, // range
    );
}

export function expressifyForStmt(
    ctx: ExpressifyCtx,
    stmt: TirForStmt,
    returnType: TirSoPStructType,
    bodyStateType: TirSoPStructType,
    initState: TirLitNamedObjExpr,
    // Optimization: when the loop has exactly one reassigned variable
    // and no user-written `return` inside its body, the SoP wrap
    // (`Reassigns{var}`) on every iteration is unnecessary. The caller
    // can opt into a bare-value lowering by passing the variable's type
    // here; the loop function then returns that type directly, and the
    // call site is expected to bind the result without a case-match.
    bareReturnType?: TirType,
): TirCallExpr
{
    const effectiveReturnType: TirSoPStructType | TirType = bareReturnType ?? returnType;
    const isBareMode = bareReturnType !== undefined;
    let loopBody = stmt.body instanceof TirBlockStmt ? stmt.body : new TirBlockStmt( [ stmt.body ], stmt.range );
    loopBody = new TirBlockStmt(
        loopBody.stmts.slice(),
        loopBody.range
    );

    // add final loop updates
    if( Array.isArray( stmt.update ) ) for( const updateStmt of stmt.update ) {
        loopBody.stmts.push( updateStmt );
    }

    // ALWAYS add a final `continue;` to the end of the loop body
    loopBody.stmts.push(
        new TirContinueStmt( loopBody.range.atEnd() )
    );

    if( stmt.condition ) {
        loopBody = new TirBlockStmt(
            [
                new TirIfStmt(
                    stmt.condition,
                    // then
                    loopBody,
                    // else
                    new TirBlockStmt([ new TirBreakStmt( stmt.condition.range ) ], stmt.condition.range ),
                    stmt.condition.range
                )
            ],
            loopBody.range
        );
    }

    const loopFuncName = getUniqueInternalName("loop");

    const loopFuncType = new TirFuncT(
        bodyStateType.constructors[0].fields.map( f => f.type ),
        effectiveReturnType
    );

    const loopReplacements: LoopReplacements = {
        compileBreak( ctx, stmt ) {
            if( isBareMode )
            {
                // Bare-value mode: the loop's return type IS the single
                // user variable's type. `break` yields that var's current
                // value directly, no SoP construction.
                const userVarField = bodyStateType.constructors[0].fields[0];
                const resolved = ctx.getVariable( userVarField.name );
                if( isExpressifyFuncParam( resolved ) ) {
                    return new TirVariableAccessExpr(
                        {
                            variableInfos: {
                                name: resolved.name,
                                type: resolved.type,
                                isConstant: false
                            },
                            isDefinedOutsideFuncScope: false
                        },
                        stmt.range
                    );
                }
                return resolved;
            }
            // return first constructor of the return type
            const ctor = returnType.constructors[0];
            return new TirLitNamedObjExpr(
                new Identifier( ctor.name, stmt.range ),
                ctor.fields.map( f => new Identifier( f.name, stmt.range ) ),
                bodyStateType.constructors[0].fields
                .slice(0, ctor.fields.length)
                .map( f => {
                    const resolved = ctx.getVariable( f.name );
                    if( isExpressifyFuncParam( resolved ) ) {
                        return new TirVariableAccessExpr(
                            {
                                variableInfos: {
                                    name: resolved.name,
                                    type: resolved.type,
                                    isConstant: false
                                },
                                isDefinedOutsideFuncScope: false
                            },
                            stmt.range
                        )
                    }
                    return resolved;
                }),
                returnType,
                stmt.range
            )
        },
        replaceReturnValue( ctx, stmt ) {
            // Synthetic returns inserted by `expressifyIfBranch` (and
            // analogous callers) carry the inner-if's SoP value as the
            // continuation of the ternary they participate in — they are
            // NOT user-written returns escaping the loop. When the loop
            // has no user-written `return` in its body, `returnType` has
            // only the "break/continue" constructor: in that case the
            // value flowing through is already the right type and we
            // must leave it untouched. (Previously this threw "No return
            // constructor found in return type" when a for-of body
            // contained an `if` that mutated a captured `let` — the
            // synthesized branch-tail returns hit this path even though
            // the user had no `return` inside the loop.)
            const ctor = returnType.constructors[1];
            if( !ctor ) {
                return stmt.value!;
            }
            return new TirLitNamedObjExpr(
                new Identifier( ctor.name, stmt.range ),
                [ new Identifier( ctor.fields[0].name, stmt.range ) ],
                [ stmt.value ],
                returnType,
                stmt.range
            );
        },
        compileContinue( ctx, stmt ) {
            // return recursive call
            const resolvedSelfResult = ctx.getVariable( loopFuncName );
            let resolvedSelf: TirExpr;
            if( isExpressifyFuncParam( resolvedSelfResult ) ) {
                resolvedSelf = new TirVariableAccessExpr(
                    {
                        variableInfos: {
                            name: resolvedSelfResult.name,
                            type: resolvedSelfResult.type,
                            isConstant: false
                        },
                        isDefinedOutsideFuncScope: false
                    },
                    stmt.range
                );
            } else {
                resolvedSelf = resolvedSelfResult;
            }
            return new TirCallExpr(
                resolvedSelf,
                bodyStateType.constructors[0].fields
                .map( f => {
                    const resolved = ctx.getVariable( f.name );
                    if( isExpressifyFuncParam( resolved ) ) {
                        return new TirVariableAccessExpr(
                            {
                                variableInfos: {
                                    name: resolved.name,
                                    type: resolved.type,
                                    isConstant: false
                                },
                                isDefinedOutsideFuncScope: false
                            },
                            stmt.range
                        )
                    }
                    return resolved;
                }),
                effectiveReturnType,
                stmt.range
            );
        },
    };

    const loopCompilationCtx = ctx.newChild();

    // define loop function for recursion
    loopCompilationCtx.setFuncParam( loopFuncName, loopFuncType );

    // define loop function parameters
    for( const { name, type } of bodyStateType.constructors[0].fields ) {
        loopCompilationCtx.setFuncParam( name, type );
    }

    const loopFuncExpr = new TirFuncExpr(
        loopFuncName, // func name
        // func params
        bodyStateType.constructors[0].fields.map( f => new TirSimpleVarDecl(
            f.name,
            f.type,
            undefined, // no initial value
            false, // is constant
            stmt.range
        )),
        // func return type
        effectiveReturnType,
        // func body
        new TirBlockStmt([
            new TirReturnStmt(
                expressifyFuncBody(
                    loopCompilationCtx,
                    loopBody.stmts,
                    loopReplacements,
                    [] // assertions
                ),
                stmt.range
            )
        ], stmt.range
        ),
        // func range
        stmt.range,
        true // is loop
    );
    return new TirCallExpr(
        loopFuncExpr,
        // loop call init args
        initState.values.map( v => expressifyVars( ctx, v.clone() ) ),
        effectiveReturnType,
        stmt.range
    );
}