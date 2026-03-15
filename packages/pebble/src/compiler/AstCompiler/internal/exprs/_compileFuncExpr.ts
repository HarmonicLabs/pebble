import { FuncExpr } from "../../../../ast/nodes/expr/functions/FuncExpr";
import { BlockStmt } from "../../../../ast/nodes/statements/BlockStmt";
import { FuncDecl } from "../../../../ast/nodes/statements/declarations/FuncDecl";
import { ReturnStmt } from "../../../../ast/nodes/statements/ReturnStmt";
import { AstFuncType } from "../../../../ast/nodes/types/AstNativeTypeExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { getUniqueInternalName } from "../../../internalVar";
import { TirFuncExpr } from "../../../tir/expressions/TirFuncExpr";
import { TirVariableAccessExpr } from "../../../tir/expressions/TirVariableAccessExpr";
import { TirReturnStmt } from "../../../tir/statements/TirReturnStmt";
import { TirStmt } from "../../../tir/statements/TirStmt";
import { TirSimpleVarDecl } from "../../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirFuncT } from "../../../tir/types/TirNativeType/native/function";
import { void_t } from "../../../tir/program/stdScope/stdScope";
import { TirType } from "../../../tir/types/TirType";
import { TirTypeParam } from "../../../tir/types/TirTypeParam";
import { getUnaliased } from "../../../tir/types/utils/getUnaliased";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileBlockStmt } from "../statements/_compileBlockStmt";
import { _compileVarDecl } from "../statements/_compileVarStmt";
import { _compileDataEncodedConcreteType } from "../types/_compileDataEncodedConcreteType";
import { _compileSopEncodedConcreteType } from "../types/_compileSopEncodedConcreteType";
import { _hasDuplicateTypeParams } from "./_hasDuplicateTypeParams";

/*
- add "self" as first parameter
- replace `node( arg )` as `self( Node{ arg } )`

```
function isOdd( n: int ): boolean
{
    return n == 1 || !isEven( n - 1 );
}

function isEven( n: int ): boolean
{
    return n == 0 || !isOdd( n - 1 );
}
```

becomes

```
runtime struct _Choice {
    IsOdd{ n: int },
    IsEven{ n: int },
}

function _isOdd( mutual_chooser: any, n: int ): boolean
{
    return n == 1 || !mutual_chooser( IsEven{ n: n - 1 } );
}

function _isEven( mutual_chooser: any, n: int ): boolean
{
    return n == 0 || !mutual_chooser( IsOdd{ n: n - 1 } );
}

function _isOdd_isEven( choice: _Choice ): boolean
{
    return case choice
        is IsOdd{ _ } => _isOdd( _isOdd_isEven, ...choice ),
        is IsEven{ _ } => _isEven( _isOdd_isEven, ...choice ),
        ;
}

// partial application
const isOdd = _isOdd( _isOdd_isEven );
const isEven = _isEven( _isOdd_isEven );
```
*/

export function _compileFuncExpr(
    ctx: AstCompilationCtx,
    expr: FuncExpr,
    expectedFuncType: TirType | undefined,
    isMethod: boolean = false,
): TirFuncExpr | undefined
{
    if( expectedFuncType )
    {
        expectedFuncType = getUnaliased( expectedFuncType );
        if(!( expectedFuncType instanceof TirFuncT ))
        return ctx.error(
            DiagnosticCode.While_compiling_function_expression_expected_type_was_not_a_function,
            expr.range,
        );
    }
    else
    {
        expectedFuncType = (
            isMethod ? undefined :
            ctx.program.functions.get( expr.name.text )?.sig()
        );
        if(!( expectedFuncType instanceof TirFuncT ))
        {
            // if the return type annotation is missing,
            // infer it from the body instead of erroring
            if( !expr.signature.returnType )
            {
                return _compileFuncExprInferReturnType(
                    ctx, expr, isMethod
                );
            }
            expectedFuncType = getDataFuncSignature(
                ctx,
                expr.signature
            );
            if(!(
                expectedFuncType instanceof TirFuncT
            )) return undefined;
        }
    }

    const returnType = expectedFuncType.returnType;

    const funcCtx = ctx.newFunctionChildScope( returnType, isMethod );
    // define value in case of recursion
    funcCtx.scope.defineValue({
        name: expr.name.text,
        type: expectedFuncType,
        isConstant: true,
    });

    // if( _hasDuplicateTypeParams( ctx, expr.typeParams ) ) return undefined;
    if( expr.typeParams.length > 0 )
    return ctx.error(
        DiagnosticCode.Not_implemented_0,
        expr.typeParams[0].range,
        "generic functions"
    );

    const destructuredParamsResult = _getDestructuredParamsAsVarDecls(
        funcCtx,
        expr,
        expectedFuncType
    );
    if( !destructuredParamsResult ) return undefined;
    const { blockInitStmts, params } = destructuredParamsResult;

    const astBody = expr.body instanceof BlockStmt ? expr.body :
    new BlockStmt(
        [ new ReturnStmt( expr.body, expr.body.range ) ],
        expr.body.range
    );

    const compileResult = _compileBlockStmt(
        funcCtx,
        astBody
    );
    if( !compileResult ) return undefined;
    const body = compileResult[0];

    body.stmts.unshift( ...blockInitStmts );

    const funcExpr = new TirFuncExpr(
        expr.name.text,
        params,
        returnType,
        body,
        expr.range
    );

    return funcExpr;
}

/**
 * compiles a function expression whose return type annotation is missing,
 * inferring the return type from the body's return expressions.
 *
 * uses `inferReturnType` flag on the function context so that
 * `_compileReturnStmt` skips the return type assignability check.
 */
function _compileFuncExprInferReturnType(
    ctx: AstCompilationCtx,
    expr: FuncExpr,
    isMethod: boolean,
): TirFuncExpr | undefined
{
    // compile param types (reuse getDataFuncSignature logic for params only)
    const funcParams = expr.signature.params;
    const paramTypes = new Array<TirType>( funcParams.length );
    for( let i = 0; i < funcParams.length; i++ )
    {
        const param = funcParams[i];
        if( !param.type )
        return ctx.error(
            DiagnosticCode.Could_not_infer_function_signature_parameter_type_is_missing,
            param.range,
        );
        const type = _compileDataEncodedConcreteType( ctx, param.type, true );
        if( !type ) return undefined;
        paramTypes[i] = type;
    }

    // use void as a temporary return type; the real type will be inferred
    // from the body's return expressions after compilation
    const tempReturnType = void_t;
    const tempFuncType = new TirFuncT( paramTypes, tempReturnType );

    const funcCtx = ctx.newFunctionChildScope( tempReturnType, isMethod );
    // mark the context as inferring so _compileReturnStmt
    // skips the return type assignability check
    funcCtx.functionCtx!.inferReturnType = true;
    funcCtx.scope.defineValue({
        name: expr.name.text,
        type: tempFuncType,
        isConstant: true,
    });

    if( expr.typeParams.length > 0 )
    return ctx.error(
        DiagnosticCode.Not_implemented_0,
        expr.typeParams[0].range,
        "generic functions"
    );

    const destructuredParamsResult = _getDestructuredParamsAsVarDecls(
        funcCtx,
        expr,
        tempFuncType
    );
    if( !destructuredParamsResult ) return undefined;
    const { blockInitStmts, params } = destructuredParamsResult;

    const astBody = expr.body instanceof BlockStmt ? expr.body :
    new BlockStmt(
        [ new ReturnStmt( expr.body, expr.body.range ) ],
        expr.body.range
    );

    const compileResult = _compileBlockStmt(
        funcCtx,
        astBody
    );
    if( !compileResult ) return undefined;
    const body = compileResult[0];

    body.stmts.unshift( ...blockInitStmts );

    // infer return type from the first return statement in the body
    const returnType = _inferReturnType( body.stmts ) ?? tempReturnType;

    const funcExpr = new TirFuncExpr(
        expr.name.text,
        params,
        returnType,
        body,
        expr.range
    );

    return funcExpr;
}

function _inferReturnType( stmts: TirStmt[] ): TirType | undefined
{
    for( const stmt of stmts )
    {
        if( stmt instanceof TirReturnStmt && stmt.value )
        {
            return stmt.value.type;
        }
    }
    return undefined;
}

function _getDestructuredParamsAsVarDecls(
    funcCtx: AstCompilationCtx,
    expr: FuncExpr,
    expectedFuncType: TirFuncT
): { blockInitStmts: TirStmt[], params: TirSimpleVarDecl[] } | undefined
{
    const blockInitStmts: TirStmt[] = [];
    const params: TirSimpleVarDecl[] = [];
    const nParams = expr.signature.params.length;
    for( let i = 0; i < nParams; i++ )
    {
        const astParam = expr.signature.params[ i ];
        const paramTypeHint = expectedFuncType.argTypes[ i ];
        const tirParam = _compileVarDecl(
            funcCtx,
            astParam,
            paramTypeHint
        );
        if( !tirParam ) return undefined;

        if( tirParam instanceof TirSimpleVarDecl )
        {
            params.push( tirParam );
            continue;
        }
        // else move destructuring in the body (uplc has only simple params)

        const uniqueName = getUniqueInternalName(
            tirParam.type.toString().toLowerCase()
        );

        const isConst = tirParam.isConst;

        // function param as simple var decl
        const simpleParam = new TirSimpleVarDecl(
            uniqueName,
            tirParam.type,
            tirParam.initExpr,
            isConst,
            tirParam.range
        );

        // tirParam destructures simpleParam added to the block init stmts
        tirParam.initExpr = new TirVariableAccessExpr(
            {
                variableInfos: {
                    name: simpleParam.name,
                    type: simpleParam.type,
                    isConstant: true
                },
                isDefinedOutsideFuncScope: false,
            },
            tirParam.range
        );

        params.push( simpleParam );
        blockInitStmts.push( tirParam );
    }

    return { blockInitStmts, params };
}

/**
 * [NOTE: abmigous param encoding defaults to data]
 * 
 * when we can encode a struct (or alias of struct) both as sop or data,
 * we default to data encoding
 * 
 * this is because, not know much about what was the original encoding,
 * converting sop to data is usually cheaper
 * than data to sop, where we would need to decode all fields,
 * even if we don't use them.
 * 
 * encoding is cheaper than decoding and can be done outside the function, before the call
 * 
 * Optionals are sop, but the value is follows the rules above.
 * 
 * TODO: in the future we should implement a "fully extracted form" (FEF)
 * so that we don't care about data or sop. (only exception is if the function calls `equalsData` builtin)
    **/
export function getDataFuncSignature(
    ctx: AstCompilationCtx,
    signature: AstFuncType
): TirFuncT | undefined
{
    const funcParams = signature.params;
    const paramTypes = new Array<TirType>( funcParams.length );
    for( let i = 0; i < funcParams.length; i++ )
    {
        const param = funcParams[i];
        if( !param.type )
        return ctx.error(
            DiagnosticCode.Could_not_infer_function_signature_parameter_type_is_missing,
            param.range,
        );

        const type = _compileDataEncodedConcreteType( ctx, param.type, true );
        if( !type ) return undefined;

        paramTypes[i] = type;
    }

    if( !signature.returnType )
    return ctx.error(
        DiagnosticCode.Could_not_infer_function_signature_return_type_is_missing,
        signature.range,
    );

    const returnType = signature.returnType instanceof AstFuncType ?
    getDataFuncSignature(
        ctx,
        signature.returnType
    ) :
    _compileSopEncodedConcreteType(
        ctx,
        signature.returnType
    );

    if(
        !returnType
        || returnType instanceof TirTypeParam
    ) return undefined;

    return new TirFuncT(
        paramTypes,
        returnType
    );
}