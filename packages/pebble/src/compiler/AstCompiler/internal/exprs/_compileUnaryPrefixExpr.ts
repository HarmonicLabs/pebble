import { UnaryExclamation } from "../../../../ast/nodes/expr/unary/UnaryExclamation";
import { UnaryMinus } from "../../../../ast/nodes/expr/unary/UnaryMinus";
import { UnaryPlus } from "../../../../ast/nodes/expr/unary/UnaryPlus";
import { UnaryPrefixExpr } from "../../../../ast/nodes/expr/unary/UnaryPrefixExpr";
import { UnaryTilde } from "../../../../ast/nodes/expr/unary/UnaryTilde";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirUnaryExclamation } from "../../../tir/expressions/unary/TirUnaryExclamation";
import { TirUnaryMinus } from "../../../tir/expressions/unary/TirUnaryMinus";
import { TirUnaryPlus } from "../../../tir/expressions/unary/TirUnaryPlus";
import { TirUnaryPrefixExpr } from "../../../tir/expressions/unary/TirUnaryPrefixExpr";
import { TirUnaryTilde } from "../../../tir/expressions/unary/TirUnaryTilde";
import { TirType } from "../../../tir/types/TirType";
import { TirValueT } from "../../../tir/types/TirNativeType/native/value";
import { canAssignTo, canAssignToOptional } from "../../../tir/types/utils/canAssignTo";
import { getUnaliased } from "../../../tir/types/utils/getUnaliased";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileExpr } from "./_compileExpr";

export function _compileUnaryPrefixExpr(
    ctx: AstCompilationCtx,
    expr: UnaryPrefixExpr,
    _typeHint: TirType | undefined
): TirUnaryPrefixExpr | undefined
{
    const bool_t = ctx.program.stdTypes.bool;
    const int_t = ctx.program.stdTypes.int;
    const bytes_t = ctx.program.stdTypes.bytes;
        
    if( expr instanceof UnaryExclamation )
    {
        const operand = _compileExpr( ctx, expr.operand, bool_t );
        if( !operand ) return undefined;
        const operandType = operand.type;
        if(!(
            canAssignTo( operandType, bool_t )
            || canAssignToOptional( operandType )
        )) {
            return ctx.error(
                DiagnosticCode.Type_0_is_not_assignable_to_type_1,
                expr.operand.range, operand.type.toString(), "boolean | Optional<T>"
            );
        }
        return new TirUnaryExclamation(
            operand,
            bool_t,
            expr.range
        );
    }
    else if(
        expr instanceof UnaryPlus
        || expr instanceof UnaryMinus
    )
    {
        // Probe without hint so we can spot `-Value` (TirValueT) before
        // failing the int check.
        const operand = _compileExpr( ctx, expr.operand, undefined );
        if( !operand ) return undefined;
        const operandType = operand.type;
        const unaliasedTy = getUnaliased( operandType );

        if( unaliasedTy instanceof TirValueT )
        {
            // unary plus on Value is the identity; unary minus negates it.
            if( expr instanceof UnaryPlus ) return new TirUnaryPlus( operand, operandType, expr.range );
            if( expr instanceof UnaryMinus ) return new TirUnaryMinus( operand, operandType, expr.range );
        }

        if( !canAssignTo( operandType, int_t ) ) {
            return ctx.error(
                DiagnosticCode.Type_0_is_not_assignable_to_type_1,
                expr.operand.range, operand.type.toString(), "int"
            );
        }
        if( expr instanceof UnaryPlus ) return new TirUnaryPlus( operand, int_t, expr.range );
        if( expr instanceof UnaryMinus ) return new TirUnaryMinus( operand, int_t, expr.range );
    }
    else if( expr instanceof UnaryTilde )
    {
        const operand = _compileExpr( ctx, expr.operand, bytes_t );
        if( !operand ) return undefined;
        const operandType = operand.type;
        if( !canAssignTo( operandType, bytes_t ) ) {
            return ctx.error(
                DiagnosticCode.Type_0_is_not_assignable_to_type_1,
                expr.operand.range, operand.type.toString(), "bytes"
            );
        }
        return new TirUnaryTilde( operand, int_t, expr.range );
    }

    const tsEnsureExhautstiveCheck: never = expr;
    console.error( expr );
    throw new Error("unreachable::AstCompiler::_compileUnaryPrefixExpr");
}