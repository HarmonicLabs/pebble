import { NonNullExpr } from "../../../../ast/nodes/expr/unary/NonNullExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirCaseExpr, TirCaseMatcher } from "../../../tir/expressions/TirCaseExpr";
import { TirExpr } from "../../../tir/expressions/TirExpr";
import { TirFailExpr } from "../../../tir/expressions/TirFailExpr";
import { TirVariableAccessExpr } from "../../../tir/expressions/TirVariableAccessExpr";
import { TirNamedDeconstructVarDecl } from "../../../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSimpleVarDecl } from "../../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirType } from "../../../tir/types/TirType";
import { getOptTypeArg } from "../../../tir/types/utils/getOptTypeArg";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileExpr } from "./_compileExpr";


export function _compileNonNullExpr(
    ctx: AstCompilationCtx,
    expr: NonNullExpr,
    typeHint: TirType | undefined
): TirExpr | undefined
{
    const operand = _compileExpr( ctx, expr.operand, typeHint );
    if( !operand ) return undefined;
    
    const optionalType = operand.type;
    const nonNullType = getOptTypeArg( optionalType );
    if( !nonNullType )
    {
        ctx.warning(
            DiagnosticCode.Non_null_opeartor_used_on_expression_of_type_0_which_is_not_optional_this_will_be_omitted_during_compilation,
            expr.operand.range, optionalType.toString()
        );
        return operand;
    }

    return new TirCaseExpr(
        operand,
        [
            new TirCaseMatcher(
                new TirNamedDeconstructVarDecl(
                    "Some",
                    new Map([
                        ["value", new TirSimpleVarDecl(
                            "value",
                            nonNullType,
                            undefined, // no init expr
                            true, // isConst
                            expr.range
                        )]
                    ]),
                    undefined, // no rest
                    optionalType,
                    undefined, // no init expr
                    true, // isConst
                    expr.range
                ),
                new TirVariableAccessExpr(
                    {
                        variableInfos: {
                            name: "value",
                            type: nonNullType,
                            isConstant: true
                        },
                        isDefinedOutsideFuncScope: false,
                        crossesFunctionBoundary: false,
                    },
                    expr.range
                ),
                expr.range
            ),
            new TirCaseMatcher(
                new TirNamedDeconstructVarDecl(
                    "None",
                    new Map(), // no fields extracted
                    undefined, // no rest
                    optionalType,
                    undefined, // no init expr
                    true, // isConst
                    expr.range
                ),
                new TirFailExpr(
                    undefined, // no message
                    nonNullType,
                    expr.range,
                ),
                expr.range
            )
        ],
        undefined, // no wildcard case
        nonNullType,
        expr.range
    );
}