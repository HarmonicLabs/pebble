import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirVariableAccessExpr } from "../../../tir/expressions/TirVariableAccessExpr";
import { TirType } from "../../../tir/types/TirType";
import { AstCompilationCtx } from "../../AstCompilationCtx";

export function _compileVarAccessExpr(
    ctx: AstCompilationCtx,
    expr: Identifier,
    typeHint: TirType | undefined
): TirVariableAccessExpr | undefined
{
    const resolvedValue = ctx.scope.resolveValue( expr.text );
    if( !resolvedValue ) {
        if( ctx.scope.resolveNamespace( expr.text ) )
        return ctx.error(
            DiagnosticCode.Namespace_path_is_incomplete_expected_a_value_type_function_or_interface,
            expr.range
        );

        return ctx.error(
            DiagnosticCode._0_is_not_defined,
            expr.range, expr.text
        );
    }

    // lambdas may only CAPTURE `const` bindings: a `const` is a real
    // let-binding computed once at its declaration, so accessing it from a
    // closure is a plain variable read. A mutable `let` crossing a function
    // boundary has no sound meaning (closures cannot observe later
    // reassignments) — reject it.
    if(
        resolvedValue.crossesFunctionBoundary
        && !resolvedValue.variableInfos.isConstant
    ) {
        return ctx.error(
            DiagnosticCode.Lambdas_can_only_capture_const_bindings_0_is_a_mutable_let_Copy_it_into_a_const_before_the_lambda,
            expr.range, expr.text
        );
    }

    // const { variableInfos, isDefinedOutsideFuncScope } = resolvedValue;
    return new TirVariableAccessExpr(
        resolvedValue,
        expr.range
    );
}