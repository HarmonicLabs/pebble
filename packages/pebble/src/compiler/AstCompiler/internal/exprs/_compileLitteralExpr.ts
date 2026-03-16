import { LitArrExpr } from "../../../../ast/nodes/expr/litteral/LitArrExpr";
import { LitContextExpr } from "../../../../ast/nodes/expr/litteral/LitContextExpr";
import { LitFailExpr } from "../../../../ast/nodes/expr/litteral/LitFailExpr";
import { LitFalseExpr } from "../../../../ast/nodes/expr/litteral/LitFalseExpr";
import { LitHexBytesExpr } from "../../../../ast/nodes/expr/litteral/LitHexBytesExpr";
import { LitIntExpr } from "../../../../ast/nodes/expr/litteral/LitIntExpr";
import { LitNamedObjExpr } from "../../../../ast/nodes/expr/litteral/LitNamedObjExpr";
import { LitObjExpr } from "../../../../ast/nodes/expr/litteral/LitObjExpr";
import { LitStrExpr } from "../../../../ast/nodes/expr/litteral/LitStrExpr";
import { LitteralExpr } from "../../../../ast/nodes/expr/litteral/LitteralExpr";
import { LitThisExpr } from "../../../../ast/nodes/expr/litteral/LitThisExpr";
import { LitTrueExpr } from "../../../../ast/nodes/expr/litteral/LitTrueExpr";
import { LitUndefExpr } from "../../../../ast/nodes/expr/litteral/LitUndefExpr";
import { LitVoidExpr } from "../../../../ast/nodes/expr/litteral/LitVoidExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirLitArrExpr } from "../../../tir/expressions/litteral/TirLitArrExpr";
import { TirLitFailExpr } from "../../../tir/expressions/litteral/TirLitFailExpr";
import { TirLitFalseExpr } from "../../../tir/expressions/litteral/TirLitFalseExpr";
import { TirLitHexBytesExpr } from "../../../tir/expressions/litteral/TirLitHexBytesExpr";
import { TirLitIntExpr } from "../../../tir/expressions/litteral/TirLitIntExpr";
import { TirLitNamedObjExpr } from "../../../tir/expressions/litteral/TirLitNamedObjExpr";
import { TirLitObjExpr } from "../../../tir/expressions/litteral/TirLitObjExpr";
import { TirLitStrExpr } from "../../../tir/expressions/litteral/TirLitStrExpr";
import { TirLitThisExpr } from "../../../tir/expressions/litteral/TirLitThisExpr";
import { TirLitTrueExpr } from "../../../tir/expressions/litteral/TirLitTrueExpr";
import { TirLitUndefExpr } from "../../../tir/expressions/litteral/TirLitUndefExpr";
import { TirLitVoidExpr } from "../../../tir/expressions/litteral/TirLitVoidExpr";
import { TirExpr, isTirExpr } from "../../../tir/expressions/TirExpr";
import { TirListT } from "../../../tir/types/TirNativeType/native/list";
import { TirDataOptT } from "../../../tir/types/TirNativeType/native/Optional/data";
import { TirSopOptT } from "../../../tir/types/TirNativeType/native/Optional/sop";
import { TirDataStructType, TirSoPStructType, TirStructType } from "../../../tir/types/TirStructType";
import { TirType, isTirType } from "../../../tir/types/TirType";
import { canAssignTo, isStructOrStructAlias, getStructType, canAssignToOptional, canAssignToList } from "../../../tir/types/utils/canAssignTo";
import { getListTypeArg } from "../../../tir/types/utils/getListTypeArg";
import { getUnaliased } from "../../../tir/types/utils/getUnaliased";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileExpr } from "./_compileExpr";

export function _compileLitteralExpr(
    ctx: AstCompilationCtx,
    expr: LitteralExpr,
    typeHint: TirType | undefined
): TirExpr | undefined
{
    if( expr instanceof LitVoidExpr ) return new TirLitVoidExpr( expr.range );
    if( expr instanceof LitUndefExpr ) return _compileLitteralUndefExpr( ctx, expr, typeHint );
    if( expr instanceof LitTrueExpr ) return new TirLitTrueExpr( expr.range );
    if( expr instanceof LitFalseExpr ) return new TirLitFalseExpr( expr.range );
    if( expr instanceof LitStrExpr ) return new TirLitStrExpr( expr.string, expr.range );
    if( expr instanceof LitIntExpr ) return new TirLitIntExpr( expr.integer, expr.range );
    if( expr instanceof LitHexBytesExpr ) return new TirLitHexBytesExpr( expr.bytes, expr.range );
    if( expr instanceof LitThisExpr )
    {
        const this_tir_name = ctx.scope.resolveType("this")?.sopTirName;
        if( !this_tir_name ) return ctx.error(
            DiagnosticCode._this_cannot_be_referenced_in_current_location,
            expr.range
        );

        const this_t = ctx.program.types.get( this_tir_name )
        if( !this_t ) return ctx.error(
            DiagnosticCode._this_cannot_be_referenced_in_current_location,
            expr.range
        );

        return new TirLitThisExpr(
            this_t,
            expr.range
        );
    }
    if( expr instanceof LitArrExpr ) return _compileLitteralArrayExpr( ctx, expr, typeHint );
    if( expr instanceof LitObjExpr ) return _compileLitteralObjExpr( ctx, expr, typeHint );
    if( expr instanceof LitNamedObjExpr ) return _compileLitteralNamedObjExpr( ctx, expr, typeHint );
    if( expr instanceof LitFailExpr ) return new TirLitFailExpr( expr.range );

    if( expr instanceof LitContextExpr )
    throw new Error("Litteral `context` should have been handled while desugaring.");

    const tsEnsureExhautstiveCheck: never = expr;
    throw new Error("unreachable::AstCompiler::_compileLitteralExpr");
}

export function _compileLitteralUndefExpr(
    ctx: AstCompilationCtx,
    expr: LitUndefExpr,
    typeHint: TirType | undefined
): TirLitUndefExpr | undefined
{
    if( !isTirType( typeHint ) )
    {
        return ctx.error(
            DiagnosticCode.Litteral_value_undefined_must_be_explicitly_cast_to_an_Optional_type,
            expr.range
        );
    }
    
    typeHint = getUnaliased( typeHint );
    if(!(
        typeHint instanceof TirSopOptT
        || typeHint instanceof TirDataOptT
    ))
    {
        return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            expr.range, "Optional<T>", typeHint.toString()
        );
    }

    return new TirLitUndefExpr(
        typeHint,
        expr.range
    );
}

export function _compileLitteralNamedObjExpr(
    ctx: AstCompilationCtx,
    expr: LitNamedObjExpr,
    typeHint: TirType | undefined
): TirLitNamedObjExpr | undefined
{
    let structType: TirStructType | undefined = undefined;
    if( isTirType( typeHint ) )
    {
        if( !isStructOrStructAlias( typeHint ) )
        {
            return ctx.error(
                DiagnosticCode.Named_object_litteral_is_not_assignable_to_0,
                expr.range, typeHint.toString()
            );
        }
        structType = getStructType( typeHint );
    } else typeHint = undefined;
    const constructorName = expr.name.text;
    let inferredStructType: TirStructType | undefined = undefined;

    // Type.Constructor{ ... } syntax — resolve type directly
    if( expr.typeName )
    {
        const possibleTypes = ctx.scope.resolveType( expr.typeName.text );
        if( possibleTypes )
        {
            const dataTirName = possibleTypes.dataTirName;
            const sopTirName = possibleTypes.sopTirName;
            inferredStructType = getStructType(
                (dataTirName ? ctx.program.types.get( dataTirName ) : undefined)
                ?? ctx.program.types.get( sopTirName )
            );
        }
        if( !inferredStructType )
        {
            return ctx.error(
                DiagnosticCode._0_is_not_defined,
                expr.typeName.range, expr.typeName.text
            );
        }
    }
    else
    {
        inferredStructType = getStructType(
            ctx.scope.inferStructTypeFromConstructorName( constructorName )?.structType
        );
    }
    if( !inferredStructType )
    {
        return ctx.error(
            DiagnosticCode._0_is_not_defined,
            expr.name.range, constructorName
        );
    }
    if( typeHint )
    {
        if( !canAssignTo( inferredStructType, typeHint ) )
        {
            return ctx.error(
                DiagnosticCode.Named_object_litteral_is_not_assignable_to_0,
                expr.range, typeHint.toString()
            );
        }
    }

    structType = inferredStructType;
    if( !isTirType( typeHint ) ) typeHint = structType ?? inferredStructType;

    const constructorIndex = structType?.constructors.findIndex( c => c.name === constructorName ) ?? -1;
    if( constructorIndex < 0 )
    {
        return ctx.error(
            DiagnosticCode._0_is_not_defined,
            expr.name.range, constructorName
        );
    }

    const fieldValues = __commonCompileStructFieldValues(
        ctx,
        expr,
        typeHint,
        structType,
        constructorIndex
    );
    if( !Array.isArray( fieldValues ) ) return undefined;

    typeHint = getUnaliased( typeHint );
    // TirDataStructType | TirSoPStructType
    if(!(
        typeHint instanceof TirDataStructType
        || typeHint instanceof TirSoPStructType
    )) {
        return ctx.error(
            DiagnosticCode.Named_object_litteral_is_not_assignable_to_0,
            expr.range, typeHint.toString()
        );
    }

    return new TirLitNamedObjExpr(
        expr.name,
        expr.fieldNames,
        fieldValues,
        typeHint,
        expr.range
    );
}

export function _compileLitteralObjExpr(
    ctx: AstCompilationCtx,
    expr: LitObjExpr,
    typeHint: TirType | undefined
): TirLitObjExpr | undefined
{
    if( !isTirType( typeHint ) )
    {
        return ctx.error(
            DiagnosticCode.Unnamed_object_litteral_must_be_explicitly_cast_to_a_type,
            expr.range
        );
    }
    if( !isStructOrStructAlias( typeHint ) )
    {
        return ctx.error(
            DiagnosticCode.Unnamed_object_litteral_is_not_assignable_to_0,
            expr.range, typeHint.toString()
        );
    }
    const structType = getStructType( typeHint )!;
    if( structType.constructors.length !== 1 )
    {
        return ctx.error(
            DiagnosticCode.Unnamed_object_litteral_is_not_assignable_to_0_An_explicit_constrctor_must_be_used,
            expr.range, typeHint.toString()
        );
    }
    const fieldValues = __commonCompileStructFieldValues(
        ctx,
        expr,
        typeHint,
        structType,
        0
    );
    if( !Array.isArray( fieldValues ) ) return undefined;

    typeHint = getUnaliased( typeHint );
    // TirDataStructType | TirSoPStructType
    if(!(
        typeHint instanceof TirDataStructType
        || typeHint instanceof TirSoPStructType
    )) {
        return ctx.error(
            DiagnosticCode.Named_object_litteral_is_not_assignable_to_0,
            expr.range, typeHint.toString()
        );
    }

    return new TirLitObjExpr(
        expr.fieldNames,
        fieldValues,
        typeHint,
        expr.range
    );
}

export function __commonCompileStructFieldValues(
    ctx: AstCompilationCtx,
    expr: LitObjExpr | LitNamedObjExpr,
    realType: TirType, // possibly aliased
    structType: TirStructType,
    constructorIndex: number
): TirExpr[] | undefined
{
    if( constructorIndex < 0 || constructorIndex >= structType.constructors.length )
        throw new Error("unreachable::__commonCompileStructFieldValues");

    const constructorDef = structType.constructors[constructorIndex];
    for( const exprField of expr.fieldNames )
    {
        if( !constructorDef.fields.some( realField => realField.name === exprField.text ) )
        {
            return ctx.error<string, string, TirStructType>(
                DiagnosticCode.Field_0_is_not_part_of_the_1_constructor_for_2_struct,
                exprField.range, exprField.text, constructorDef.name, structType
            );
        }
    }
    if( expr.fieldNames.length !== constructorDef.fields.length )
    {
        return ctx.error(
            DiagnosticCode.Unnamed_object_litteral_is_not_assignable_to_0_The_fields_do_not_match_the_the_type_definition,
            expr.range, realType.toString()
        );
    }
    const fieldValues: TirExpr[] = new Array( constructorDef.fields.length );
    for( let i = 0; i < constructorDef.fields.length; i++ )
    {
        const fieldDef = constructorDef.fields[i];
        const initAstExprIdx = expr.fieldNames.findIndex( name => name.text === fieldDef.name );
        if( initAstExprIdx === -1 )
        {
            return ctx.error<string, string, TirStructType>(
                DiagnosticCode.Field_0_is_missing_but_required_by_the_1_constructor_of_the_2_struct,
                expr.range, fieldDef.name, constructorDef.name, structType
            );
        }
        const initExpr = _compileExpr( ctx, expr.values[initAstExprIdx], fieldDef.type );
        if( !initExpr ) return undefined;
        if( !canAssignTo( initExpr.type, fieldDef.type ) )
        {
            return ctx.error(
                DiagnosticCode.Type_0_is_not_assignable_to_type_1,
                expr.values[initAstExprIdx].range, initExpr.type, fieldDef.type
            );
        }
        fieldValues[i] = initExpr;
    }
    return fieldValues;
}

export function _compileLitteralArrayExpr(
    ctx: AstCompilationCtx,
    expr: LitArrExpr,
    typeHint: TirType | undefined
): TirExpr | undefined
{
    let listType: TirType | undefined = typeHint;
    let elemsType: TirType | undefined = undefined;
    if( listType )
    {
        if( !canAssignToList( listType ) )
            return ctx.error(
                DiagnosticCode.Type_0_is_not_assignable_to_type_1,
                expr.range, "List<T>", listType.toString()
            );
        else
            elemsType = getListTypeArg( listType );
    }

    if( expr.elems.length === 0 )
    {
        if( !listType ) return ctx.error(
            DiagnosticCode.Empty_array_litteral_must_be_explicitly_cast_to_a_type,
            expr.range
        );

        return new TirLitArrExpr(
            [],
            listType,
            expr.range,
        );
    }

    const fstCompiledExpr = _compileExpr( ctx, expr.elems[0], elemsType );
    if( !fstCompiledExpr ) return undefined;
    
    if( !elemsType ) elemsType = fstCompiledExpr.type;
    else if( !canAssignTo( fstCompiledExpr.type, elemsType ) ) {
        return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            expr.elems[0].range, fstCompiledExpr.type, elemsType
        );
    }

    if( !listType  ) listType  = new TirListT( elemsType! ); 

    const restElems = expr.elems.slice( 1 );
    const compiledRestElems = restElems.map( elem => {
        const compiled = _compileExpr( ctx, elem, elemsType );
        if( !compiled ) return undefined;
        if( !canAssignTo( compiled.type, elemsType! ) )
        {
            return ctx.error(
                DiagnosticCode.Type_0_is_not_assignable_to_type_1,
                elem.range, compiled.type, elemsType
            );
        }
        return compiled;
    });
    if( compiledRestElems.some( x => !isTirExpr( x )) ) return undefined;

    return new TirLitArrExpr(
        [ fstCompiledExpr, ...(compiledRestElems as TirExpr[]) ],
        listType,
        expr.range
    );
}
