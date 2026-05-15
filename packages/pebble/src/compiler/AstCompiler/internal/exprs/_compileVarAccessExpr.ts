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

        console.trace( ctx.scope.allVariables(), expr.text );
        return ctx.error(
            DiagnosticCode._0_is_not_defined,
            expr.range, expr.text
        );
    }
    // const { variableInfos, isDefinedOutsideFuncScope } = resolvedValue;
    return new TirVariableAccessExpr(
        resolvedValue,
        expr.range
    );
}