import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirVariableAccessExpr } from "../../../tir/expressions/TirVariableAccessExpr";
import { TirType } from "../../../tir/types/TirType";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { referenceSymbol } from "../../utils/symbols";

export function _compileVarAccessExpr(
    ctx: AstCompilationCtx,
    expr: Identifier,
    typeHint: TirType | undefined
): TirVariableAccessExpr | undefined
{
    const resolvedValue = ctx.scope.resolveValue( expr.text );

    // a declaration of the module that is still compiling: this use is part of its own
    // definition, through the declarations that definition uses (`f` calls `g`, `g` calls
    // `f`; or a constant whose value needs itself). A function calling ITSELF is fine and
    // does not get here (its name resolves to the function's own scope); two declarations
    // defined in terms of each other have no closed term to compile to, so the use is
    // refused here instead of looping in the backend.
    if( ctx.scope.isBeingDeclared( expr.text ) )
    {
        if( resolvedValue ) referenceSymbol( ctx.program, expr.range, resolvedValue.variableInfos.symbol );
        return ctx.error(
            DiagnosticCode.Mutually_recursive_declarations_are_not_supported_0_is_used_directly_or_indirectly_in_its_own_definition,
            expr.range, expr.text
        );
    }

    if( !resolvedValue ) {
        if( ctx.scope.resolveNamespace( expr.text ) )
        return ctx.error(
            DiagnosticCode.Namespace_path_is_incomplete_expected_a_value_type_function_or_interface,
            expr.range
        );

        // a declaration that failed: its own error says why
        if( ctx.scope.resolvesToFailedValue( expr.text ) )
        {
            referenceSymbol( ctx.program, expr.range, ctx.scope.failedValueSymbol( expr.text ) );
            return undefined;
        }

        return ctx.error(
            DiagnosticCode._0_is_not_defined,
            expr.range, expr.text
        );
    }

    referenceSymbol( ctx.program, expr.range, resolvedValue.variableInfos.symbol );

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