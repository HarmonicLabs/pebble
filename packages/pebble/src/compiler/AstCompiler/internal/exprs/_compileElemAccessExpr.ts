import { ElemAccessExpr } from "../../../../ast/nodes/expr/ElemAccessExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirCallExpr } from "../../../tir/expressions/TirCallExpr";
import { TirCaseExpr, TirCaseMatcher } from "../../../tir/expressions/TirCaseExpr";
import { TirElemAccessExpr } from "../../../tir/expressions/TirElemAccessExpr";
import { TirExpr } from "../../../tir/expressions/TirExpr";
import { TirFailExpr } from "../../../tir/expressions/TirFailExpr";
import { TirNativeFunc } from "../../../tir/expressions/TirNativeFunc";
import { TirToDataExpr } from "../../../tir/expressions/TirToDataExpr";
import { TirVariableAccessExpr } from "../../../tir/expressions/TirVariableAccessExpr";
import { TirNamedDeconstructVarDecl } from "../../../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSimpleVarDecl } from "../../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirLinearMapT } from "../../../tir/types/TirNativeType/native/linearMap";
import { TirListT } from "../../../tir/types/TirNativeType/native/list";
import { TirSopOptT } from "../../../tir/types/TirNativeType/native/Optional/sop";
import { TirType } from "../../../tir/types/TirType";
import { canAssignTo } from "../../../tir/types/utils/canAssignTo";
import { getLinearMapTypeArgs } from "../../../tir/types/utils/getListTypeArg";
import { getListTypeArg } from "../../../tir/types/utils/getListTypeArg";
import { getUnaliased } from "../../../tir/types/utils/getUnaliased";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileExpr } from "./_compileExpr";

export function _compileElemAccessExpr(
    ctx: AstCompilationCtx,
    expr: ElemAccessExpr,
    typeHint: TirType | undefined
): TirExpr | undefined
{
    const int_t = ctx.program.stdTypes.int;

    const arrLikeExpr = _compileExpr( ctx, expr.arrLikeExpr, undefined );
    if( !arrLikeExpr ) return undefined;

    const arrLikeType = getUnaliased( arrLikeExpr.type );

    // LinearMap<K,V>: map[key] desugars to map.lookup(key)!
    const mapTypeArgs = getLinearMapTypeArgs( arrLikeType );
    if( mapTypeArgs )
    {
        const [ kT, vT ] = mapTypeArgs;
        const indexExpr = _compileExpr( ctx, expr.indexExpr, kT );
        if( !indexExpr ) return undefined;
        if( !canAssignTo( indexExpr.type, kT ) ) return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            expr.indexExpr.range, indexExpr.type.toString(), kT.toString()
        );

        const optType = new TirSopOptT( vT );
        // _lookupLinearMap expects data-encoded key
        const keyAsData = new TirToDataExpr( indexExpr, expr.indexExpr.range );
        const lookupCall = new TirCallExpr(
            TirNativeFunc._lookupLinearMap( kT, vT ),
            [ keyAsData, arrLikeExpr ],
            optType,
            expr.range
        );

        // unwrap: case lookup is Some{ value } => value, None => fail
        return new TirCaseExpr(
            lookupCall,
            [
                new TirCaseMatcher(
                    new TirNamedDeconstructVarDecl(
                        "Some",
                        new Map([
                            ["value", new TirSimpleVarDecl(
                                "value", vT, undefined, true, expr.range
                            )]
                        ]),
                        undefined, optType, undefined, true, expr.range
                    ),
                    new TirVariableAccessExpr(
                        {
                            variableInfos: { name: "value", type: vT, isConstant: true },
                            isDefinedOutsideFuncScope: false,
                        },
                        expr.range
                    ),
                    expr.range
                ),
                new TirCaseMatcher(
                    new TirNamedDeconstructVarDecl(
                        "None",
                        new Map(), undefined, optType, undefined, true, expr.range
                    ),
                    new TirFailExpr( undefined, vT, expr.range ),
                    expr.range
                )
            ],
            undefined,
            vT,
            expr.range
        );
    }

    // List<T>: list[index]
    const litsTypeHint = typeHint ? new TirListT( typeHint ) : undefined;
    const elemsType = getListTypeArg( arrLikeType );
    if( !elemsType ) return ctx.error(
        DiagnosticCode.This_expression_cannot_be_indexed,
        expr.arrLikeExpr.range
    );

    const indexExpr = _compileExpr( ctx, expr.indexExpr, int_t );
    if( !indexExpr ) return undefined;
    if( !canAssignTo( indexExpr.type, int_t ) ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        expr.indexExpr.range, indexExpr.type.toString(), int_t.toString()
    );

    return new TirElemAccessExpr(
        arrLikeExpr,
        indexExpr,
        elemsType,
        expr.range
    );
}