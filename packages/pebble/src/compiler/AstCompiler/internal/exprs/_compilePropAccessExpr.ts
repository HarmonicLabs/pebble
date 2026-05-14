import { kMaxLength } from "buffer";
import { PropAccessExpr, OptionalPropAccessExpr, NonNullPropAccessExpr, DotPropAccessExpr } from "../../../../ast/nodes/expr/PropAccessExpr";
import { NonNullExpr } from "../../../../ast/nodes/expr/unary/NonNullExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirCaseExpr, TirCaseMatcher } from "../../../tir/expressions/TirCaseExpr";
import { TirExpr } from "../../../tir/expressions/TirExpr";
import { TirPropAccessExpr } from "../../../tir/expressions/TirPropAccessExpr";
import { TirVariableAccessExpr } from "../../../tir/expressions/TirVariableAccessExpr";
import { TirNamedDeconstructVarDecl } from "../../../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSimpleVarDecl } from "../../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirType } from "../../../tir/types/TirType";
import { getOptTypeArg } from "../../../tir/types/utils/getOptTypeArg";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { getPropAccessReturnType } from "../../utils/getPropAccessReturnType";
import { tryResolveNamespaceChain } from "../../utils/resolveNamespaceChain";
import { _compileExpr } from "./_compileExpr";
import { _compileNonNullExpr } from "./_compileNonNullExpr";
import { TirLitNamedObjExpr } from "../../../tir/expressions/litteral/TirLitNamedObjExpr";
import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { TirSopOptT } from "../../../tir/types/TirNativeType/native/Optional/sop";

export function _compilePropAccessExpr(
    ctx: AstCompilationCtx,
    expr: PropAccessExpr,
    typeHint: TirType | undefined
): TirExpr | undefined
{
    if( expr instanceof OptionalPropAccessExpr ) return _compileOptionalPropAccessExpr( ctx, expr, typeHint );
    if( expr instanceof NonNullPropAccessExpr ) return _compileNonNullPropAccessExpr( ctx, expr, typeHint );
    if( expr instanceof DotPropAccessExpr ) return _compileDotPropAccessExpr( ctx, expr, typeHint );

    const tsEnsureExhautstiveCheck: never = expr;
    console.error( expr );
    throw new Error("unreachable::AstCompiler::_compilePropAccessExpr");
}

export function _compileOptionalPropAccessExpr(
    ctx: AstCompilationCtx,
    expr: OptionalPropAccessExpr,
    _typeHint: TirType | undefined
): TirExpr | undefined
{
    const optionalObjExpr = _compileExpr( ctx, expr.object, undefined );
    if( !optionalObjExpr ) return undefined;

    const optionalObjType = optionalObjExpr.type;
    const objType = getOptTypeArg( optionalObjType );

    if( !objType ) {
        // object type is not optional, compile as a normal prop access

        const returnType = getPropAccessReturnType( ctx, optionalObjType, expr.prop );
        if( !returnType ) return ctx.error(
            DiagnosticCode.Property_0_does_not_exist_on_type_1,
            expr.prop.range, expr.prop.text, optionalObjType.toString()
        );

        return new TirPropAccessExpr(
            optionalObjExpr,
            expr.prop,
            returnType,
            expr.range
        );
    }

    const returnType = getPropAccessReturnType( ctx, objType, expr.prop );
    if( !returnType ) return ctx.error(
        DiagnosticCode.Property_0_does_not_exist_on_type_1,
        expr.prop.range, expr.prop.text, objType.toString()
    );

    const optionalReturnType = new TirSopOptT( returnType );

    /*
    `obj?.prop` is compiled as:
    ```
    case obj
    is Some{ value } => value.prop
    is None => None
    ```
    */
    return new TirCaseExpr(
        optionalObjExpr,
        [
            // is Some{ value } => value.prop
            new TirCaseMatcher(
                // Some{ value }
                new TirNamedDeconstructVarDecl(
                    "Some",
                    new Map([
                        [ "value", new TirSimpleVarDecl("value", objType, undefined, true, optionalObjExpr.range ) ]
                    ]),
                    undefined, // rest
                    optionalObjType,
                    undefined, // no init expr
                    true, // constant
                    expr.range.atEnd()
                ),
                // value.prop
                new TirPropAccessExpr(
                    // value
                    new TirVariableAccessExpr(
                        {
                            variableInfos: {
                                isConstant: true,
                                name: "value",
                                type: objType,
                            },
                            isDefinedOutsideFuncScope: false,
                        },
                        optionalObjExpr.range
                    ),
                    // .prop
                    expr.prop,
                    returnType,
                    expr.range
                ),
                expr.range
            ),
            // is None => None
            new TirCaseMatcher(
                // is None
                new TirNamedDeconstructVarDecl(
                    "None",
                    new Map(),
                    undefined, // rest
                    optionalObjType,
                    undefined, // no init expr
                    true, // constant
                    expr.range
                ),
                // => None
                new TirLitNamedObjExpr(
                    new Identifier("None", optionalObjExpr.range.atEnd()),
                    [],
                    [],
                    optionalObjType as TirSopOptT,
                    optionalObjExpr.range.atEnd()
                ),
                optionalObjExpr.range.atEnd()
            )
        ],
        undefined, // no wildcard case
        optionalReturnType,
        expr.range
    );
}

export function _compileNonNullPropAccessExpr(
    ctx: AstCompilationCtx,
    expr: NonNullPropAccessExpr,
    _typeHint: TirType | undefined
): TirExpr | undefined
{
    const nonNullObjExpr = _compileNonNullExpr(
        ctx,
        new NonNullExpr( expr.object, expr.object.range ),
        undefined
    );
    if( !nonNullObjExpr ) return undefined;
    return _compileDotPropAccessExpr(
        ctx,
        new DotPropAccessExpr( nonNullObjExpr, expr.prop, expr.range ),
        _typeHint
    );
}

export function _compileDotPropAccessExpr(
    ctx: AstCompilationCtx,
    expr: DotPropAccessExpr,
    _typeHint: TirType | undefined
): TirExpr | undefined
{
    // if the LHS is a (chain of) identifier(s) rooted at a namespace, resolve
    // the entire dotted chain through namespaces.
    const nsRes = tryResolveNamespaceChain( ctx, expr );
    if( nsRes )
    {
        if( nsRes.kind === "value" ) return nsRes.expr;
        if( nsRes.kind === "namespace" ) return ctx.error(
            DiagnosticCode.Namespace_path_is_incomplete,
            expr.range
        );
        // "incomplete" — diagnostic already emitted
        return undefined;
    }

    const objExpr = _compileExpr( ctx, expr.object, undefined );
    if( !objExpr ) return undefined;

    const objType = objExpr.type;
    const returnType = getPropAccessReturnType( ctx, objType, expr.prop );
    if( !returnType ) return ctx.error(
        DiagnosticCode.Property_0_does_not_exist_on_type_1,
        expr.prop.range, expr.prop.text, objType.toString()
    );

    return new TirPropAccessExpr(
        objExpr,
        expr.prop,
        returnType,
        expr.range
    );
}