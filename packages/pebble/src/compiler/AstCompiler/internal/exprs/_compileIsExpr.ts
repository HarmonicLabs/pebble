import { IsExpr } from "../../../../ast/nodes/expr/IsExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirIsExpr } from "../../../tir/expressions/TirIsExpr";
import { TirType } from "../../../tir/types/TirType";
import { getEnumType } from "../../../tir/types/TirEnumType";
import { getStructType } from "../../../tir/types/utils/canAssignTo";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileExpr } from "./_compileExpr";

export function _compileIsExpr(
    ctx: AstCompilationCtx,
    expr: IsExpr,
    _typeHint: TirType | undefined
): TirIsExpr | undefined
{
    const bool_t = ctx.program.stdTypes.bool;

    const target = _compileExpr( ctx, expr.instanceExpr, undefined );
    if( !target ) return undefined;

    const enumType = getEnumType( target.type );
    if( enumType )
    {
        const memberName = expr.ofConstr.text;
        const memberIdx = enumType.indexOf( memberName );
        if( memberIdx < 0 ) return ctx.error(
            DiagnosticCode.Constructor_0_is_not_part_of_the_definition_of_1,
            expr.ofConstr.range, memberName, enumType.toString()
        );

        if( enumType.members.length === 1 )
        {
            ctx.warning(
                DiagnosticCode.This_check_is_redundant_Struct_0_has_only_one_possible_constructor,
                expr.range, enumType.toString()
            );
        }

        return new TirIsExpr(
            target,
            memberName,
            memberIdx,
            expr.range,
            bool_t
        );
    }

    const structType = getStructType( target.type );
    if( !structType ) return ctx.error(
        DiagnosticCode.Cannot_use_is_operator_on_a_value_that_is_not_a_struct_type,
        expr.instanceExpr.range
    );

    const targetCtorName = expr.ofConstr.text;

    const localIdx = structType.constructors.findIndex(
        ctor => ctor.name === targetCtorName
    );
    if( localIdx < 0 ) return ctx.error(
        DiagnosticCode.Constructor_0_is_not_part_of_the_definition_of_1,
        expr.ofConstr.range, targetCtorName, structType.toString()
    );

    if( structType.constructors.length === 1 )
    {
        ctx.warning(
            DiagnosticCode.This_check_is_redundant_Struct_0_has_only_one_possible_constructor,
            expr.range, structType.toString()
        );
    }

    const parentCtorIdx = structType.parentCtorIdx( localIdx );

    return new TirIsExpr(
        target,
        targetCtorName,
        parentCtorIdx,
        expr.range,
        bool_t
    );
}
