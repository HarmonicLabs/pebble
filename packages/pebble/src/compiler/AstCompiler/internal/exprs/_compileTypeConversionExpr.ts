import { TypeConversionExpr } from "../../../../ast/nodes/expr/TypeConversionExpr";
import { AstNamedTypeExpr } from "../../../../ast/nodes/types/AstNamedTypeExpr";
import { AstRedeemerOfTypeExpr } from "../../../../ast/nodes/types/AstRedeemerOfTypeExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirTypeConversionExpr } from "../../../tir/expressions/TirTypeConversionExpr";
import { TirType } from "../../../tir/types/TirType";
import { canAssignTo } from "../../../tir/types/utils/canAssignTo";
import { canCastTo } from "../../../tir/types/utils/canCastTo";
import { _compileDataEncodedConcreteType } from "../types/_compileDataEncodedConcreteType";
import { _compileSopEncodedConcreteType } from "../types/_compileSopEncodedConcreteType";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileExpr } from "./_compileExpr";

export function _compileTypeConversionExpr(
    ctx: AstCompilationCtx,
    ast: TypeConversionExpr,
    typeHint: TirType | undefined
): TirTypeConversionExpr | undefined
{
    const data_t = ctx.program.stdTypes.data;

    // qualified target type (`Ns.Type`, `Struct.Constructor`, `Contract.State`),
    // a `redeemerof ...` operator, or a GENERIC application
    // (`as LinearMap<bytes, bytes>`, `as Box<int>`): the plain by-name
    // lookup below can't see them (generic templates are never registered
    // in `program.types` — BUG 47) — go through the type compilers, which
    // resolve all of these.
    if(
        ast.asType instanceof AstRedeemerOfTypeExpr
        || (
            ast.asType instanceof AstNamedTypeExpr
            && ( ast.asType.path.length > 0 || ast.asType.tyArgs.length > 0 )
        )
    )
    {
        const expr = _compileExpr( ctx, ast.expr, undefined );
        if( !expr ) return undefined;

        const targetType = canAssignTo( expr.type, data_t )
            ? _compileDataEncodedConcreteType( ctx, ast.asType )
            : _compileSopEncodedConcreteType( ctx, ast.asType );
        if( !targetType ) return undefined;

        if( !canCastTo( expr.type, targetType ) ) return ctx.error(
            DiagnosticCode.Type_0_cannot_be_converted_to_type_1,
            ast.expr.range, expr.type.toString(), targetType.toString()
        );

        return new TirTypeConversionExpr(
            expr,
            targetType,
            ast.range
        );
    }

    const possibleTargetTypeTirNames = ctx.scope.resolveType( ast.asType.toAstName() )
    if( !possibleTargetTypeTirNames ) {
        return ctx.error(
            DiagnosticCode._0_is_not_defined,
            ast.asType.range,
            ast.asType.toAstName()
        );
    }

    // data-only types (e.g. the prelude structs: TxOutRef, Address, ...)
    // register a `sopTirName` whose type is never added to the program —
    // the cast must NOT require the SOP variant to exist (BUG 21: `as
    // TxOutRef` failed with "'TxOutRef' is not defined" while the name
    // resolved fine in type position).
    const sopTargetType = ctx.program.types.get( possibleTargetTypeTirNames.sopTirName );

    const dataTargetType = typeof possibleTargetTypeTirNames.dataTirName === "string" ?
        ctx.program.types.get( possibleTargetTypeTirNames.dataTirName ) :
        undefined;

    if( !sopTargetType && !dataTargetType ) return ctx.error(
        DiagnosticCode._0_is_not_defined,
        ast.asType.range,
        ast.asType.toAstName()
    );

    const expr = _compileExpr( ctx, ast.expr, dataTargetType );
    if( !expr ) return undefined;

    const targetType: TirType = (
        dataTargetType
        && canAssignTo( expr.type, data_t )
    ) ? dataTargetType : ( sopTargetType ?? dataTargetType! );

    if( !canCastTo( expr.type, targetType ) ) return ctx.error(
        DiagnosticCode.Type_0_cannot_be_converted_to_type_1,
        ast.expr.range, expr.type.toString(), targetType.toString()
    );

    return new TirTypeConversionExpr(
        expr,
        targetType,
        ast.range
    );
}