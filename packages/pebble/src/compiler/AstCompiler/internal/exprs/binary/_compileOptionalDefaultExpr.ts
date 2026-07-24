import { Identifier } from "../../../../../ast/nodes/common/Identifier";
import { OptionalDefaultExpr } from "../../../../../ast/nodes/expr/binary/BinaryExpr";
import { DiagnosticCode } from "../../../../../diagnostics/diagnosticMessages.generated";
import { TirLitNamedObjExpr } from "../../../../tir/expressions/litteral/TirLitNamedObjExpr";
import { TirCaseExpr, TirCaseMatcher } from "../../../../tir/expressions/TirCaseExpr";
import { TirExpr } from "../../../../tir/expressions/TirExpr";
import { TirFromDataExpr } from "../../../../tir/expressions/TirFromDataExpr";
import { TirVariableAccessExpr } from "../../../../tir/expressions/TirVariableAccessExpr";
import { TirNamedDeconstructVarDecl } from "../../../../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSimpleVarDecl } from "../../../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirSopOptT } from "../../../../tir/types/TirNativeType/native/Optional/sop";
import { TirType } from "../../../../tir/types/TirType";
import { canAssignTo } from "../../../../tir/types/utils/canAssignTo";
import { getOptTypeArg } from "../../../../tir/types/utils/getOptTypeArg";
import { AstCompilationCtx } from "../../../AstCompilationCtx";
import { _compileExpr } from "../_compileExpr";


export function _compileOptionalDefaultExpr(
    ctx: AstCompilationCtx,
    expr: OptionalDefaultExpr,
    typeHint: TirType | undefined
): TirExpr | undefined
{
    const left = _compileExpr( ctx, expr.left, typeHint ? new TirSopOptT( typeHint ) : undefined );
    if( !left ) return undefined;

    const leftType = left.type;
    const unwrappedType = getOptTypeArg( leftType );

    if( !unwrappedType ) {
        ctx.warning(
            DiagnosticCode.Left_side_of_opeartor_is_not_optional_right_side_is_unused,
            expr.right.range
        );
        return left;
    }

    const optType = new TirSopOptT( unwrappedType );

    const right = _compileExpr( ctx, expr.right, unwrappedType );
    if( !right ) return undefined;

    const isUnwrappedReturn = canAssignTo( right.type, unwrappedType );
    if( !isUnwrappedReturn && !canAssignTo( right.type, optType ) ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        expr.right.range, right.type.toString(), unwrappedType.toString()
    );

    const returnType = isUnwrappedReturn ? unwrappedType : optType;

    const accessSomeValueExpr = new TirVariableAccessExpr(
        {
            variableInfos: {
                name: "value",
                type: unwrappedType,
                isConstant: true
            },
            isDefinedOutsideFuncScope: false,
                        crossesFunctionBoundary: false,
        },
        expr.range
    );

    return new TirCaseExpr(
        left,
        [
            new TirCaseMatcher(
                new TirNamedDeconstructVarDecl(
                    "Some",
                    new Map([
                        ["value", new TirSimpleVarDecl(
                            "value",
                            unwrappedType,
                            undefined, // no init expr
                            true, // isConst
                            expr.range
                        )]
                    ]),
                    undefined, // no rest
                    leftType,
                    undefined, // no init expr
                    true, // isConst
                    expr.range
                ),
                isUnwrappedReturn ?
                accessSomeValueExpr :
                new TirLitNamedObjExpr(
                    new Identifier("Some", expr.range),
                    [ new Identifier("value", left.range) ],
                    [ accessSomeValueExpr ],
                    optType,
                    expr.range
                ),
                expr.range
            ),
            new TirCaseMatcher(
                new TirNamedDeconstructVarDecl(
                    "None",
                    new Map(), // no fields extracted
                    undefined, // no rest
                    leftType,
                    undefined, // no init expr
                    true, // isConst
                    expr.range
                ),
                isUnwrappedReturn ? right : (
                    // ensure we have a sop encoded optional
                    right.type instanceof TirSopOptT ? right :
                    new TirFromDataExpr(
                        right,
                        optType,
                        expr.range
                    )
                ),
                expr.range
            )
        ],
        undefined, // no wildcard case
        returnType,
        expr.range
    );
}
