import { isUnaryPrefixExpr } from "../../../ast/nodes/expr/unary/UnaryPrefixExpr";
import { SourceRange } from "../../../ast/Source/SourceRange";
import { isTirBinaryExpr, TirExponentiationExpr } from "../../tir/expressions/binary/TirBinaryExpr";
import { TirLitArrExpr } from "../../tir/expressions/litteral/TirLitArrExpr";
import { TirLitFailExpr } from "../../tir/expressions/litteral/TirLitFailExpr";
import { TirLitFalseExpr } from "../../tir/expressions/litteral/TirLitFalseExpr";
import { TirLitHexBytesExpr } from "../../tir/expressions/litteral/TirLitHexBytesExpr";
import { TirLitIntExpr } from "../../tir/expressions/litteral/TirLitIntExpr";
import { TirLitNamedObjExpr } from "../../tir/expressions/litteral/TirLitNamedObjExpr";
import { TirLitObjExpr } from "../../tir/expressions/litteral/TirLitObjExpr";
import { TirLitStrExpr } from "../../tir/expressions/litteral/TirLitStrExpr";
import { isTirLitteralExpr } from "../../tir/expressions/litteral/TirLitteralExpr";
import { TirLitThisExpr } from "../../tir/expressions/litteral/TirLitThisExpr";
import { TirLitTrueExpr } from "../../tir/expressions/litteral/TirLitTrueExpr";
import { TirLitUndefExpr } from "../../tir/expressions/litteral/TirLitUndefExpr";
import { TirLitVoidExpr } from "../../tir/expressions/litteral/TirLitVoidExpr";
import { TirAssertAndContinueExpr } from "../../tir/expressions/TirAssertAndContinueExpr";
import { TirCallExpr } from "../../tir/expressions/TirCallExpr";
import { TirCaseExpr, TirCaseMatcher } from "../../tir/expressions/TirCaseExpr";
import { TirElemAccessExpr } from "../../tir/expressions/TirElemAccessExpr";
import { TirExpr } from "../../tir/expressions/TirExpr";
import { TirFailExpr } from "../../tir/expressions/TirFailExpr";
import { TirFromDataExpr } from "../../tir/expressions/TirFromDataExpr";
import { TirFuncExpr } from "../../tir/expressions/TirFuncExpr";
import { TirHoistedExpr } from "../../tir/expressions/TirHoistedExpr";
import { TirInlineClosedIR } from "../../tir/expressions/TirInlineClosedIR";
import { TirLettedExpr } from "../../tir/expressions/TirLettedExpr";
import { TirNativeFunc } from "../../tir/expressions/TirNativeFunc";
import { TirParentesizedExpr } from "../../tir/expressions/TirParentesizedExpr";
import { TirPropAccessExpr } from "../../tir/expressions/TirPropAccessExpr";
import { TirTernaryExpr } from "../../tir/expressions/TirTernaryExpr";
import { TirToDataExpr } from "../../tir/expressions/TirToDataExpr";
import { TirTraceIfFalseExpr } from "../../tir/expressions/TirTraceIfFalseExpr";
import { TirTraceExpr } from "../../tir/expressions/TirTraceExpr";
import { TirTypeConversionExpr } from "../../tir/expressions/TirTypeConversionExpr";
import { TirVariableAccessExpr } from "../../tir/expressions/TirVariableAccessExpr";
import { TirUnaryExclamation } from "../../tir/expressions/unary/TirUnaryExclamation";
import { TirUnaryMinus } from "../../tir/expressions/unary/TirUnaryMinus";
import { TirUnaryPlus } from "../../tir/expressions/unary/TirUnaryPlus";
import { isTirUnaryPrefixExpr } from "../../tir/expressions/unary/TirUnaryPrefixExpr";
import { TirUnaryTilde } from "../../tir/expressions/unary/TirUnaryTilde";
import { bool_t } from "../../tir/program/stdScope/stdScope";
import { TirBlockStmt } from "../../tir/statements/TirBlockStmt";
import { TirReturnStmt } from "../../tir/statements/TirReturnStmt";
import { TirStmt } from "../../tir/statements/TirStmt";
import { TirArrayLikeDeconstr } from "../../tir/statements/TirVarDecl/TirArrayLikeDeconstr";
import { TirNamedDeconstructVarDecl } from "../../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSimpleVarDecl } from "../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirAliasType } from "../../tir/types/TirAliasType";
import { TirFuncT, TirListT } from "../../tir/types/TirNativeType";
import { TirDataStructType, TirSoPStructType } from "../../tir/types/TirStructType";
import { getListTypeArg } from "../../tir/types/utils/getListTypeArg";
import { getUnaliased } from "../../tir/types/utils/getUnaliased";
import { expressify, expressifyFuncBody, LoopReplacements } from "./expressify";
import { ExpressifyCtx, isExpressifyFuncParam } from "./ExpressifyCtx";
import { flattenSopNamedDeconstructInplace_addTopDestructToCtx_getNestedDeconstruct } from "./flattenSopNamedDeconstructInplace_addTopDestructToCtx_getNestedDeconstruct";
import { isSingleConstrStruct } from "./isSingleConstrStruct";
import { toNamedDeconstructVarDecl } from "./toNamedDeconstructVarDecl";

/**
 * Side effect: modifies the expression in place if possible.
 * 
 * **ASSUME THE INPUT EXPRESSION IS INVALID AFTER THIS FUNCTION CALL.**
 * 
 * @returns a the modified expression
**/
export function expressifyVars(
    ctx: ExpressifyCtx,
    expr: TirExpr
): TirExpr
{
    if(
        // isTirLitteralExpr( expr )
        expr instanceof TirLitVoidExpr
        || expr instanceof TirLitFailExpr
        || expr instanceof TirLitUndefExpr
        || expr instanceof TirLitTrueExpr
        || expr instanceof TirLitFalseExpr
        || expr instanceof TirLitThisExpr
        || expr instanceof TirLitArrExpr
        || expr instanceof TirLitObjExpr
        || expr instanceof TirLitNamedObjExpr
        || expr instanceof TirLitStrExpr
        || expr instanceof TirLitIntExpr
        || expr instanceof TirLitHexBytesExpr
        || expr instanceof TirNativeFunc
        // hoisted expressions are necessarily closed, so no external variables
        || expr instanceof TirHoistedExpr
    ) return expr; 

    // every property access must be replaced with a variable access (or similar)
    // that is either letted/hoisted/nativeFunc/varAccess expression
    //
    // we don't have property access in TermIR (or UPLC)
    if( expr instanceof TirPropAccessExpr ) {
        const objectExpr = expressifyVars( ctx, expr.object );
        expr.object = objectExpr;
        return expressifyPropAccess( ctx, expr );
    }

    if( expr instanceof TirVariableAccessExpr ) {
        const originalVarName = expr.resolvedValue.variableInfos.name;
        const resolvedVariable = ctx.getVariable( originalVarName );
        
        if( !resolvedVariable ) return expr; // variable not found, keep the original expression
        
        // if variable was shadowed
        if( isExpressifyFuncParam( resolvedVariable ) ) {
            // !!! IMPORTANT !!!
            // we must clone the expression to avoid modifying other instances of it elsewhere
            // THIS IS CRUCIAL I SPENT A DAY DEBUGGING THIS
            expr = expr.clone() as TirVariableAccessExpr;
            expr.resolvedValue.variableInfos.name = resolvedVariable.name;
            return expr;
        }

        // resovledVariable instanceof TirVariableAccessExpr
        return resolvedVariable.clone() as (TirLettedExpr | TirNativeFunc | TirHoistedExpr);
    }

    if( isTirUnaryPrefixExpr( expr ) ) {
        const modifiedExpr = expressifyVars( ctx, expr.operand );
        expr.operand = modifiedExpr;
        return expr;
    }
    if(
        expr instanceof TirParentesizedExpr
        || expr instanceof TirTypeConversionExpr
    ) {
        const modifiedExpr = expressifyVars( ctx, expr.expr );
        expr.expr = modifiedExpr;
        return expr;
    }
    if( expr instanceof TirFuncExpr ) {
        expressify( expr, undefined, ctx.program, ctx );
        return expr;
    }
    if( expr instanceof TirCallExpr ) {
        while( expr.func instanceof TirParentesizedExpr ) expr.func = expr.func.expr;
        if( expr.func instanceof TirPropAccessExpr ) {
            for( let i = 0; i < expr.args.length; i++ ) {
                const arg = expressifyVars( ctx, expr.args[i] );
                expr.args[i] = arg;
            }
            return expressifyMethodCall( ctx, expr );
        }
        const func = expressifyVars( ctx, expr.func );
        expr.func = func;
        for( let i = 0; i < expr.args.length; i++ ) {
            const arg = expressifyVars( ctx, expr.args[i] );
            expr.args[i] = arg;
        }
        return expr;
    }
    if( expr instanceof TirCaseExpr ) {
        const matchExpr = expressifyVars( ctx, expr.matchExpr );
        expr.matchExpr = matchExpr;
        for( let i = 0; i < expr.cases.length; i++ ) {
            const c = expr.cases[i];
            const branchCtx = ctx.newChild();

            if( c.pattern instanceof TirArrayLikeDeconstr )
            throw new Error(
                "case expression not yet supported for array-like deconstruction"
            );

            const pattern = toNamedDeconstructVarDecl( c.pattern );

            const branchBodyStmts: TirStmt[] = flattenSopNamedDeconstructInplace_addTopDestructToCtx_getNestedDeconstruct(
                pattern,
                branchCtx,
            );
            branchBodyStmts.push(
                new TirReturnStmt( c.body, c.body.range )
            );

            c.body = expressifyFuncBody( branchCtx, branchBodyStmts, undefined );
        }
        return expr;
    }
    if( expr instanceof TirElemAccessExpr ) {
        const arrExpr = expressifyVars( ctx, expr.arrLikeExpr );
        const indexExpr = expressifyVars( ctx, expr.indexExpr );
        expr.arrLikeExpr = arrExpr;
        expr.indexExpr = indexExpr;
        return expr;
    }
    if( expr instanceof TirTernaryExpr ) {
        const condition = expressifyVars( ctx, expr.condition );
        const ifTrue = expressifyVars( ctx, expr.ifTrue );
        const ifFalse = expressifyVars( ctx, expr.ifFalse );
        expr.condition = condition;
        expr.ifTrue = ifTrue;
        expr.ifFalse = ifFalse;
        return expr;
    }

    if( isTirBinaryExpr( expr ) ) {
        const left = expressifyVars( ctx, expr.left );
        const right = expressifyVars( ctx, expr.right );
        expr.left = left;
        expr.right = right;
        return expr;
    }

    if( expr instanceof TirLettedExpr ) {
        const modifiedExpr = expressifyVars( ctx, expr.expr );
        expr.expr = modifiedExpr;
        return expr;
    }

    if( expr instanceof TirFromDataExpr ) {
        const modifiedExpr = expressifyVars( ctx, expr.dataExpr );
        expr.dataExpr = modifiedExpr;
        return expr;
    }

    if( expr instanceof TirFailExpr ) {
        if( expr.failMsgExpr ) {
            const modifiedExpr = expressifyVars( ctx, expr.failMsgExpr );
            expr.failMsgExpr = modifiedExpr;
        }
        return expr;
    }

    //  TirInlineClosedIR
    if( expr instanceof TirToDataExpr ) {
        const modifiedExpr = expressifyVars( ctx, expr.expr );
        expr.expr = modifiedExpr;
        return expr;
    }

    if( expr instanceof TirAssertAndContinueExpr ) {
        expr.conditions;
        expr.continuation;
        const modifiedConditions = expr.conditions.map( c => expressifyVars( ctx, c ) );
        const modifiedContinuation = expressifyVars( ctx, expr.continuation );
        expr.conditions = modifiedConditions;
        expr.continuation = modifiedContinuation;
        return expr;
    }

    if( expr instanceof TirTraceIfFalseExpr ) {
        const modifiedCondition = expressifyVars( ctx, expr.condition );
        const modifiedTraceStrExpr = expressifyVars( ctx, expr.traceStrExpr );
        expr.condition = modifiedCondition;
        expr.traceStrExpr = modifiedTraceStrExpr;
        return expr;
    }

    if( expr instanceof TirTraceExpr ) {
        const modifiedTraceExpr = expressifyVars( ctx, expr.traceExpr );
        const modifiedContinuation = expressifyVars( ctx, expr.continuation );
        expr.traceExpr = modifiedTraceExpr;
        expr.continuation = modifiedContinuation;
        return expr;
    }

    if( expr instanceof TirInlineClosedIR ) return expr;

    const tsEnsureExhautstiveCheck: never = expr;
    console.error( expr );
    throw new Error("unreachable::expressifyVars");
}

function expressifyPropAccess(
    ctx: ExpressifyCtx,
    propAccessExpr: TirPropAccessExpr
): TirExpr
{
    let expr = propAccessExpr.object;
    const prop = propAccessExpr.prop.text;

    while( expr instanceof TirParentesizedExpr ) expr = expr.expr;

    if(
        expr instanceof TirLitVoidExpr
        || expr instanceof TirLitUndefExpr
        || expr instanceof TirLitFailExpr
        || expr instanceof TirLitTrueExpr
        || expr instanceof TirLitFalseExpr
        // methods on these should have already been converted to functions
        || expr instanceof TirLitArrExpr
        || expr instanceof TirLitStrExpr
        || expr instanceof TirLitIntExpr
        || expr instanceof TirLitHexBytesExpr
        || expr instanceof TirNativeFunc
        || expr instanceof TirPropAccessExpr // `expressifyVars` is called recursively on the object before this check
        // these result to native types
        || expr instanceof TirUnaryExclamation // boolean
        || expr instanceof TirUnaryPlus // int
        || expr instanceof TirUnaryMinus // int
        || expr instanceof TirUnaryTilde // bytes
        || expr instanceof TirFuncExpr // functions have no properties
        || expr instanceof TirParentesizedExpr // typescript being stupid
        || isTirBinaryExpr( expr ) // all of these return either int, bytes or boolean
        // TirAssertAndContinueExpr | TirTraceIfFalseExpr | TirTraceExpr | TirInlineClosedIR
        || expr instanceof TirAssertAndContinueExpr
        || expr instanceof TirTraceIfFalseExpr
        || expr instanceof TirTraceExpr
        || expr instanceof TirInlineClosedIR
    ) throw new Error( "Invalid property access expression" );

    if( expr instanceof TirLitThisExpr ) {
        let varName = ctx.properties.get( "this" )?.get( prop );
        if( !varName ) throw new Error(
            `Property '${prop}' does not exist on 'this'`
        );
        varName = ctx.getVariableSSA( varName )?.latestName ?? varName;

        const expr = ctx.getVariable( varName );
        if( isExpressifyFuncParam( expr ) ) {
            return new TirVariableAccessExpr(
                {
                    variableInfos: {
                        name: expr.name,
                        type: expr.type,
                        isConstant: true,
                    },
                    isDefinedOutsideFuncScope: false,
                },
                propAccessExpr.range
            )
        }

        return expr;
    }

    // expressify as normal variable
    if( 
        expr instanceof TirLitObjExpr 
        || expr instanceof TirLitNamedObjExpr 
    ) {
        const valIdx = expr.fieldNames.findIndex( f => f.text === prop );
        if( valIdx < 0 ) throw new Error(
            `Property '${prop}' does not exist on object literal`
        );
        return expr.values[valIdx];
    }

    if(
        expr instanceof TirHoistedExpr
        || expr instanceof TirLettedExpr
        || expr instanceof TirVariableAccessExpr
        // all of these are valid property access expressions
        // and we need to inspect the return type to check if the property exists
        || expr instanceof TirCallExpr
        || expr instanceof TirCaseExpr
        || expr instanceof TirTypeConversionExpr 
        || expr instanceof TirElemAccessExpr
        || expr instanceof TirTernaryExpr 
        || expr instanceof TirFromDataExpr
        || expr instanceof TirFailExpr
        || expr instanceof TirToDataExpr
    ) {

        if(
            expr instanceof TirHoistedExpr
            || expr instanceof TirLettedExpr
            || expr instanceof TirVariableAccessExpr
        ) {
            let varName = ctx.properties.get( expr.varName )?.get( prop );
            if( varName ) {
                varName = ctx.getVariableSSA( varName )?.latestName ?? varName;
    
                const result = ctx.getVariable( varName );
                if( isExpressifyFuncParam( result ) ) {
                    return new TirVariableAccessExpr(
                        {
                            variableInfos: {
                                name: result.name,
                                type: result.type,
                                isConstant: true,
                            },
                            isDefinedOutsideFuncScope: false,
                        },
                        propAccessExpr.range
                    )
                }
    
                return result;
            }

            // if there is no property in the context
            // we extract the property inplace below (outside this block)
        }

        const objType = getUnaliased( expr.type );

        if( !isSingleConstrStruct( objType ) ) {
            // IMPORTANT: we only care about fields here
            // any methods should have already been converted to functions
            console.error( objType, expr.toString() );
            throw new Error(`cannot access property '${prop}' on non-struct type`);
        }

        const ctor = objType.constructors[0];
        const fIdx = ctor.fields.findIndex( f => f.name === prop );
        if( fIdx < 0 ) throw new Error(
            `Property '${prop}' does not exist on type '${objType.toString()}'`
        );

        const fName = ctor.fields[fIdx].name;
        const fType = ctor.fields[fIdx].type;

        return new TirCaseExpr(
            expr,
            [
                new TirCaseMatcher(
                    new TirNamedDeconstructVarDecl(
                        ctor.name,
                        new Map([
                            [ fName, new TirSimpleVarDecl( fName, fType, undefined, true, propAccessExpr.range ) ]
                        ]),
                        undefined, // rest
                        expr.type,
                        undefined, // init expr
                        true, // isConst
                        propAccessExpr.range
                    ),
                    new TirVariableAccessExpr(
                        {
                            variableInfos: {
                                name: fName,
                                type: fType,
                                isConstant: true,
                            },
                            isDefinedOutsideFuncScope: false,
                        },
                        propAccessExpr.range
                    ),
                    propAccessExpr.range
                )
            ],
            undefined, // wildcard case
            fType,
            propAccessExpr.range
        );
    };

    const tsEnsureExhautstiveCheck: never = expr;
    throw new Error("Invalid property access expression");
}

function expressifyMethodCall(
    ctx: ExpressifyCtx,
    methodCall: TirCallExpr
): TirCallExpr
{
    const methodPropAccess = methodCall.func;
    if(!( methodPropAccess instanceof TirPropAccessExpr ))
    throw new Error("Invalid method call expression");

    const methodIdentifierProp = methodPropAccess.prop;
    const methodName = methodIdentifierProp.text;

    const objectExpr = expressifyVars( ctx, methodPropAccess.object );
    let objectType = objectExpr.type;

    while( objectType instanceof TirAliasType ) {
        const aliasMethds = objectType.methodsNamesPtr;
        const tirMethodName = aliasMethds.get( methodName );
        if( !tirMethodName ) {
            objectType = objectType.aliased;
            continue;
        }

        const funcExpr = ctx.program.functions.get( tirMethodName );
        if( !funcExpr ) throw new Error(`Definition of method '${methodName}' on type '${objectType.toString()}' is missing.`);

        return new TirCallExpr(
            funcExpr,
            [ objectExpr, ...methodCall.args ],
            methodCall.type,
            SourceRange.join( methodIdentifierProp.range, methodCall.range.atEnd() )
        );
    }

    if(
        objectType instanceof TirDataStructType
        || objectType instanceof TirSoPStructType
    ) {
        const structMethods = objectType.methodNamesPtr;
        const tirMethodName = structMethods.get( methodName );
        if( !tirMethodName ) throw new Error(
            `Method '${methodName}' does not exist on type '${objectType.toString()}'`
        );

        const funcExpr = ctx.program.functions.get( tirMethodName );
        if( !funcExpr ) throw new Error(`Definition of method '${methodName}' on type '${objectType.toString()}' is missing.`);

        return new TirCallExpr(
            funcExpr,
            [ objectExpr, ...methodCall.args ],
            methodCall.type,
            SourceRange.join( methodIdentifierProp.range, methodCall.range.atEnd() )
        );
    }

    if( objectType instanceof TirListT ) {
        const result = expressifyListMethodCall(
            ctx,
            objectExpr,
            methodCall,
            methodName,
            objectType,
            SourceRange.join( methodIdentifierProp.range, methodCall.range.atEnd() )
        );
        if( result ) return result;
    }

    throw new Error(`not implemented::expressifyMethodCall for type '${objectType.toString()}' (method name: '${methodName}')`);

    // const tsEnsureExhautstiveCheck: never = objectType;
    throw new Error(`Cannot call method '${methodName}' on non-struct type '${objectType.toString()}'`);
}

function expressifyListMethodCall(
    ctx: ExpressifyCtx,
    objectExpr: TirExpr,
    methodCall: TirCallExpr,
    methodName: string,
    listType: TirListT,
    exprRange: SourceRange,
): TirCallExpr | undefined
{
    const elemsType = getUnaliased( getListTypeArg( listType )! );
    if( !elemsType ) throw new Error("Invalid list type");

    if( methodName === "length" ) {
        if( methodCall.args.length !== 0 ) throw new Error(
            `Method 'length' of type 'list' takes 0 arguments, ${methodCall.args.length} provided`
        );
        return new TirCallExpr(
            TirNativeFunc._length( elemsType ),
            [ objectExpr ],
            methodCall.type,
            exprRange
        );
    }
    if( methodName === "some" ) {
        if( methodCall.args.length !== 1 ) throw new Error(
            `Method 'includes' of type 'list' takes 1 argument, ${methodCall.args.length} provided`
        );
        return new TirCallExpr(
            TirNativeFunc._some( elemsType ),
            [ methodCall.args[0], objectExpr ],
            methodCall.type,
            exprRange
        );
    }
    if( methodName === "every" ) {
        if( methodCall.args.length !== 1 ) throw new Error(
            `Method 'every' of type 'list' takes 1 argument, ${methodCall.args.length} provided`
        );
        return new TirCallExpr(
            TirNativeFunc._every( elemsType ),
            [ methodCall.args[0], objectExpr ],
            methodCall.type,
            exprRange
        );
    }
    if( methodName === "includes" ) {
        if( methodCall.args.length !== 1 ) throw new Error(
            `Method 'includes' of type 'list' takes 1 argument, ${methodCall.args.length} provided`
        );
        return new TirCallExpr(
            TirNativeFunc._some( elemsType ),
            [
                new TirCallExpr(
                    TirNativeFunc._equals( elemsType ),
                    [ methodCall.args[0] ],
                    new TirFuncT([ elemsType ], bool_t ),
                    methodCall.args[0].range
                ),
                objectExpr
            ],
            methodCall.type,
            exprRange
        );
    }
    if( methodName === "head" ) {
        if( methodCall.args.length !== 0 ) throw new Error(
            `Method 'head' of type 'list' takes 0 arguments, ${methodCall.args.length} provided`
        );
        return new TirCallExpr(
            TirNativeFunc.headList( elemsType ),
            [ objectExpr ],
            methodCall.type,
            exprRange
        );
    }
    if( methodName === "tail" ) {
        if( methodCall.args.length !== 0 ) throw new Error(
            `Method 'tail' of type 'list' takes 0 arguments, ${methodCall.args.length} provided`
        );
        return new TirCallExpr(
            TirNativeFunc.tailList( elemsType ),
            [ objectExpr ],
            methodCall.type,
            exprRange
        );
    }
    if( methodName === "isEmpty" ) {
        if( methodCall.args.length !== 0 ) throw new Error(
            `Method 'isEmpty' of type 'list' takes 0 arguments, ${methodCall.args.length} provided`
        );
        return new TirCallExpr(
            TirNativeFunc.nullList( elemsType ),
            [ objectExpr ],
            methodCall.type,
            exprRange
        );
    }

    if( methodName === "find" ) {
        if( methodCall.args.length !== 1 ) throw new Error(
            `Method 'find' of type 'list' takes 1 argument, ${methodCall.args.length} provided`
        );
        // const finalType = getUnaliased( methodCall.type );
        // console.log( finalType );
        return new TirCallExpr(
            TirNativeFunc._findSopOptional( elemsType ),
            [ methodCall.args[0], objectExpr ],
            methodCall.type,
            exprRange
        );
    }

    if( methodName === "filter" ) {
        if( methodCall.args.length !== 1 ) throw new Error(
            `Method 'filter' of type 'list' takes 1 argument, ${methodCall.args.length} provided`
        );

        return new TirCallExpr(
            TirNativeFunc._filter( elemsType ),
            [ methodCall.args[0], objectExpr ],
            methodCall.type,
            exprRange
        );
    }

    if( methodName === "prepend" ) {
        if( methodCall.args.length !== 1 ) throw new Error(
            `Method 'prepend' of type 'list' takes 1 argument, ${methodCall.args.length} provided`
        );

        return new TirCallExpr(
            TirNativeFunc.mkCons( elemsType ),
            [ methodCall.args[0], objectExpr ],
            methodCall.type,
            exprRange
        );
    }

    if( methodName === "map" ) {
        if( methodCall.args.length !== 1 ) throw new Error(
            `Method 'map' of type 'list' takes 1 argument, ${methodCall.args.length} provided`
        );

        const arg = methodCall.args[0];
        const argFuncType = getUnaliased( arg.type );
        if( !( argFuncType instanceof TirFuncT ) ) throw new Error(
            `Argument 1 of method 'map' of type 'list' must be a function, got '${arg.type.toString()}'`
        );
        const mapReturnT = argFuncType.returnType;

        const elemTypeTirName = elemsType.toTirTypeKey(); 
        let base_mapToType = _base_mapToType_cache.get( elemTypeTirName )?.clone() as TirHoistedExpr;
        if( !base_mapToType ) {
            base_mapToType = new TirHoistedExpr(
                "_map_to_list_of_" + elemTypeTirName,
                new TirCallExpr(
                    TirNativeFunc._mkMap( elemsType, mapReturnT ),
                    [ new TirLitArrExpr([], new TirListT( mapReturnT ), SourceRange.unknown ) ],
                    new TirFuncT([
                        // mapping function
                        new TirFuncT([
                            elemsType
                        ], mapReturnT),
                        // list to map over
                        new TirListT(elemsType)
                    ], new TirListT(mapReturnT)),
                    SourceRange.unknown
                )
            );
            base_mapToType.varName; // precompute hash and symbol
            _base_mapToType_cache.set(
                elemTypeTirName,
                base_mapToType.clone() as TirHoistedExpr
            );
        }

        return new TirCallExpr(
            base_mapToType,
            [ methodCall.args[0], objectExpr ],
            methodCall.type,
            exprRange
        );
    }

    // TODO
    /*
    {
        show: new TirFuncT( [], bytes_t ),
        reverse: new TirFuncT( [], new TirListT( elemsType ) ),
    };
    */
}

const _base_mapToType_cache: Map<string, TirHoistedExpr> = new Map();

export function __unsafe_clear_mapToType_cache(): void
{
    _base_mapToType_cache.clear();
}