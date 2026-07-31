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
import { TirBlockStmt } from "../../../tir/statements/TirBlockStmt";
import { TirIfStmt } from "../../../tir/statements/TirIfStmt";
import { TirMatchStmt } from "../../../tir/statements/TirMatchStmt";
import { TirForStmt } from "../../../tir/statements/TirForStmt";
import { TirWhileStmt } from "../../../tir/statements/TirWhileStmt";
import { TirForOfStmt } from "../../../tir/statements/TirForOfStmt";
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
import { getDataFuncSignature } from "../types/getDataFuncSignature";
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

    // When the EXPECTED return type is still generic (a free `TirTypeParam`,
    // e.g. the `B` of `List.map`'s callback `(A) => B`), a lambda must NOT
    // adopt that type param as its own return type — that would make the
    // lambda's type non-concrete (`(int) => B`), and it then fails to assign
    // to itself (audit BUG 39). Instead infer the real return type from the
    // body (`x => x + 1` → `int`) and skip the return-type assignability
    // check while compiling (the param types from the hint are still used).
    const returnTypeIsGeneric = !returnType.isConcrete();

    const funcCtx = ctx.newFunctionChildScope( returnType, isMethod );
    if( returnTypeIsGeneric ) funcCtx.functionCtx!.inferReturnType = true;
    // define value in case of recursion
    funcCtx.scope.defineValue({
        name: expr.name.text,
        type: expectedFuncType,
        isConstant: true,
    });

    // if( _hasDuplicateTypeParams( ctx, expr.typeParams ) ) return undefined;
    // Generic functions are compiled per-instantiation by `monomorphizeGeneric`.
    // The cloned `FuncExpr` it produces has `typeParams = []`, so we only need
    // to refuse the (rare) case where someone directly calls `_compileFuncExpr`
    // on a still-generic AST node (e.g. an anonymous lambda annotated with type
    // params, which is not supported yet).
    if( expr.typeParams.length > 0 )
    return ctx.error(
        DiagnosticCode.Not_implemented_0,
        expr.typeParams[0].range,
        "generic lambda expressions (top-level generic functions are supported)"
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

    // If the expected return type was generic, use the type inferred from the
    // body so the lambda is concrete (see `returnTypeIsGeneric` above).
    const finalReturnType = returnTypeIsGeneric
        ? ( _inferReturnType( body.stmts ) ?? returnType )
        : returnType;

    const funcExpr = new TirFuncExpr(
        expr.name.text,
        params,
        finalReturnType,
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

    // Inferred-return-type variant: generics are not supported here because
    // signature inference depends on knowing the type-param substitution.
    if( expr.typeParams.length > 0 )
    return ctx.error(
        DiagnosticCode.Not_implemented_0,
        expr.typeParams[0].range,
        "generic functions with inferred return type — annotate the return type"
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
    // Return statements are not always top-level: `if(...) { return a }
    // else { return b }`, `match`, and loop bodies all nest them. Scanning
    // only the top level made any multi-branch function infer `void`
    // (audit BUG 34). Recurse into every statement that can contain a
    // `return` and take the first value type found (branches of a
    // well-typed function share a return type; call-site checks catch the
    // rest).
    for( const stmt of stmts )
    {
        const t = _returnTypeOfStmt( stmt );
        if( t ) return t;
    }
    return undefined;
}

function _returnTypeOfStmt( stmt: TirStmt ): TirType | undefined
{
    if( stmt instanceof TirReturnStmt )
        return stmt.value ? stmt.value.type : undefined;

    if( stmt instanceof TirBlockStmt )
        return _inferReturnType( stmt.stmts );

    if( stmt instanceof TirIfStmt )
        return _returnTypeOfStmt( stmt.thenBranch )
            ?? ( stmt.elseBranch ? _returnTypeOfStmt( stmt.elseBranch ) : undefined );

    if( stmt instanceof TirMatchStmt )
    {
        for( const c of stmt.cases )
        {
            const t = _returnTypeOfStmt( c.body );
            if( t ) return t;
        }
        return stmt.wildcardCase ? _returnTypeOfStmt( stmt.wildcardCase.body ) : undefined;
    }

    if(
        stmt instanceof TirForStmt
        || stmt instanceof TirWhileStmt
        || stmt instanceof TirForOfStmt
    ) return _returnTypeOfStmt( stmt.body );

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
                        crossesFunctionBoundary: false,
            },
            tirParam.range
        );

        params.push( simpleParam );
        blockInitStmts.push( tirParam );
    }

    return { blockInitStmts, params };
}

