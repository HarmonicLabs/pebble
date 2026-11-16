import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { TirShowExpr } from "../../../tir/expressions/TirShowExpr";
import { TirCallExpr } from "../../../tir/expressions/TirCallExpr";
import { TirNativeFunc } from "../../../tir/expressions/TirNativeFunc";
import { TirBytesT } from "../../../tir/types/TirNativeType/native/bytes";
import { bytes_t } from "../../../tir/program/stdScope/stdScope";
import { LitArrExpr } from "../../../../ast/nodes/expr/litteral/LitArrExpr";
import { LitContextExpr } from "../../../../ast/nodes/expr/litteral/LitContextExpr";
import { LitFailExpr } from "../../../../ast/nodes/expr/litteral/LitFailExpr";
import { LitFalseExpr } from "../../../../ast/nodes/expr/litteral/LitFalseExpr";
import { LitHexBytesExpr } from "../../../../ast/nodes/expr/litteral/LitHexBytesExpr";
import { LitIntExpr } from "../../../../ast/nodes/expr/litteral/LitIntExpr";
import { LitNamedObjExpr } from "../../../../ast/nodes/expr/litteral/LitNamedObjExpr";
import { LitObjExpr } from "../../../../ast/nodes/expr/litteral/LitObjExpr";
import { LitMapExpr } from "../../../../ast/nodes/expr/litteral/LitMapExpr";
import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { LitStrExpr } from "../../../../ast/nodes/expr/litteral/LitStrExpr";
import { LitteralExpr } from "../../../../ast/nodes/expr/litteral/LitteralExpr";
import { TemplateStrExpr } from "../../../../ast/nodes/expr/litteral/TemplateStrExpr";
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
import { TirTypeParam } from "../../../tir/types/TirTypeParam";
import { canAssignTo, isStructOrStructAlias, getStructType, canAssignToOptional, canAssignToList } from "../../../tir/types/utils/canAssignTo";
import { getLinearMapTypeArgs, getListTypeArg } from "../../../tir/types/utils/getListTypeArg";
import { TirLinearMapT } from "../../../tir/types/TirNativeType/native/linearMap";
import { TirVariableAccessExpr } from "../../../tir/expressions/TirVariableAccessExpr";
import { linearMapPrependTemplateName } from "../../../tir/program/stdScope/populateStdNamespace";
import { monomorphizeGeneric } from "../../utils/monomorphizeGeneric";
import { getUnaliased } from "../../../tir/types/utils/getUnaliased";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileExpr } from "./_compileExpr";
import { referenceSymbol } from "../../utils/symbols";

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
    if( expr instanceof LitMapExpr ) return _compileLitteralMapExpr( ctx, expr, typeHint );
    if( expr instanceof LitNamedObjExpr ) return _compileLitteralNamedObjExpr( ctx, expr, typeHint );
    if( expr instanceof LitFailExpr ) return new TirLitFailExpr( expr.range );
    if( expr instanceof TemplateStrExpr ) return _compileTemplateStrExpr( ctx, expr );

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

    // Type.Constructor{ ... } syntax — resolve type directly.
    // With a namespace path (`M.S.C{ ... }`, BUG 48) the type resolves
    // through the namespaces' PUBLIC scopes, using local (non-walking)
    // lookups so `M.S` only reaches members of `M` (same rule as qualified
    // type annotations, audit BUG 37).
    if( expr.typeName )
    {
        let possibleTypes: import("../../scope/AstScope").PossibleTirTypes | undefined = undefined;
        if( expr.typePath.length > 0 )
        {
            let ns = ctx.scope.resolveNamespace( expr.typePath[0].text );
            for( let i = 1; ns && i < expr.typePath.length; i++ )
            {
                ns = ns.publicScope.namespaces.get( expr.typePath[i].text );
            }
            if( !ns ) return ctx.error(
                DiagnosticCode._0_is_not_defined,
                expr.typePath[0].range,
                expr.typePath.map( p => p.text ).join(".")
            );
            possibleTypes = ns.publicScope.types.get( expr.typeName.text );
        }
        else possibleTypes = ctx.scope.resolveType( expr.typeName.text );

        if( possibleTypes )
        {
            const dataTirName = possibleTypes.dataTirName;
            const sopTirName = possibleTypes.sopTirName;
            inferredStructType = getStructType(
                (dataTirName ? ctx.program.types.get( dataTirName ) : undefined)
                ?? ctx.program.types.get( sopTirName )
            );
        }
    }
    else
    {
        inferredStructType = getStructType(
            ctx.scope.inferStructTypeFromConstructorName( constructorName )?.structType
        );
    }

    // Generic-struct construction: both the constructor registry (populated
    // by `using`, concrete structs only) and `resolveType(name)` (a generic
    // TEMPLATE never lives in `program.types`) miss for a generic struct.
    // When an explicit type hint already supplies the applied concrete
    // struct (e.g. `const b: Box<int> = Box{ v: 5 }`) and it has a matching
    // constructor, construct with it directly.
    if(
        !inferredStructType
        && structType
        && structType.constructors.some( c => c.name === constructorName )
        && ( !expr.typeName || structType.appliedGeneric?.baseName === expr.typeName.text )
    ) {
        inferredStructType = structType;
    }

    if( !inferredStructType )
    {
        return ctx.error(
            DiagnosticCode._0_is_not_defined,
            expr.typeName ? expr.typeName.range : expr.name.range,
            expr.typeName ? expr.typeName.text : constructorName
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

    const symbols = ctx.program.symbols;
    if( symbols )
    {
        const struct = symbols.structOf( structType );
        if( expr.typeName ) referenceSymbol( ctx.program, expr.typeName.range, struct );
        referenceSymbol( ctx.program, expr.name.range, symbols.constructorOf( struct, constructorName ) );
        for( const fieldName of expr.fieldNames )
            referenceSymbol( ctx.program, fieldName.range, symbols.fieldOf( struct, constructorName, fieldName.text ) );
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

/** the empty `LinearMap`: the empty (constant) list of pairs of data */
function _emptyLinearMap( mapType: TirType, range: LitObjExpr["range"] ): TirExpr
{
    return new TirLitArrExpr( [], mapType, range );
}

function _bareIdentifierMapKeyError( ctx: AstCompilationCtx, key: Identifier ): undefined
{
    return ctx.error(
        DiagnosticCode.A_bare_identifier_cannot_be_the_key_of_a_map_literal_Write_0_value_to_use_the_value_of_the_variable_as_the_key,
        key.range, key.text
    );
}

/**
 * A map literal, `{ #01: 10, #02: 20 }`: a `LinearMap<K, V>`, its entries in the order
 * the source has them (duplicate keys are kept, as an association list keeps them).
 *
 * It is the entries prepended, last first, to the empty map:
 * `prepend( k0, v0, prepend( k1, v1, {} ) )`, where `prepend` is `std.linearMap.prepend`
 * (it encodes the key and the value as data, as every entry of a map is). No new kind of
 * expression: everything after this point already knows calls and constant lists.
 *
 * A key is an expression, but never a bare identifier: `{ a: 1 }` is how a struct's
 * fields are written, and reading `a` as a variable there would give the same text two
 * meanings. `{ (a): 1 }` uses the value of `a`. (The parser refuses one next to other
 * keys; `_compileLitteralObjExpr` refuses a literal that has nothing else.)
 */
export function _compileLitteralMapExpr(
    ctx: AstCompilationCtx,
    expr: LitMapExpr,
    typeHint: TirType | undefined
): TirExpr | undefined
{
    let mapType: TirType | undefined = typeHint;
    let keyType: TirType | undefined = undefined;
    let valueType: TirType | undefined = undefined;
    if( mapType )
    {
        const typeArgs = getLinearMapTypeArgs( mapType );
        if( !typeArgs ) return ctx.error(
            DiagnosticCode.A_map_literal_is_not_assignable_to_0,
            expr.range, mapType.toString()
        );
        [ keyType, valueType ] = typeArgs;
        // a type that only asks for some map types nothing: the entries do
        if( !keyType.isConcrete() || !valueType.isConcrete() )
        {
            mapType = undefined;
            keyType = undefined;
            valueType = undefined;
        }
    }

    const nEntries = expr.keys.length;
    const keys = new Array<TirExpr>( nEntries );
    const values = new Array<TirExpr>( nEntries );
    for( let i = 0; i < nEntries; i++ )
    {
        // (the parser refuses a bare identifier as a key; an `Identifier` here is what a
        // contract's `this.param` was rewritten to)
        const astKey = expr.keys[i];
        const key = _compileExpr( ctx, astKey, keyType );
        if( !key ) return undefined;
        const value = _compileExpr( ctx, expr.values[i], valueType );
        if( !value ) return undefined;

        // no expected type: the first entry gives the map's
        if( !keyType ) keyType = key.type;
        if( !valueType ) valueType = value.type;

        if( !canAssignTo( key.type, keyType ) ) return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            astKey.range, key.type, keyType
        );
        if( !canAssignTo( value.type, valueType ) ) return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            expr.values[i].range, value.type, valueType
        );
        keys[i] = key;
        values[i] = value;
    }

    // the parser makes a `LitMapExpr` of a literal with one entry at least (the empty `{}`
    // is a `LitObjExpr`): the first entry gave the types, if the expected type did not
    if( !keyType || !valueType ) throw new Error( "unreachable: a map literal with no entry" );
    if( !mapType ) mapType = new TirLinearMapT( keyType, valueType );

    const template = ctx.program.genericTemplates.get( linearMapPrependTemplateName );
    if( !template ) throw new Error( "map literal: 'std.linearMap.prepend' is not registered" );
    const prepend = monomorphizeGeneric( ctx, template, [ keyType, valueType ], expr.range );
    if( !prepend ) return undefined;

    let map: TirExpr = _emptyLinearMap( mapType, expr.range );
    for( let i = nEntries - 1; i >= 0; i-- )
    {
        map = new TirCallExpr(
            new TirVariableAccessExpr(
                {
                    variableInfos: {
                        name: prepend.tirFuncName,
                        type: prepend.concreteFuncType,
                        isConstant: true,
                    },
                    isDefinedOutsideFuncScope: true,
                    crossesFunctionBoundary: false,
                },
                expr.range
            ),
            [ keys[i], values[i], map ],
            mapType,
            expr.range
        );
    }
    return map;
}

export function _compileLitteralObjExpr(
    ctx: AstCompilationCtx,
    expr: LitObjExpr,
    typeHint: TirType | undefined
): TirExpr | undefined
{
    if( !isTirType( typeHint ) )
    {
        return ctx.error(
            DiagnosticCode.Unnamed_object_litteral_must_be_explicitly_cast_to_a_type,
            expr.range
        );
    }
    // Typed as a map, a brace literal is a map literal. Its keys here are all bare
    // identifiers (the parser makes a `LitMapExpr` of any other), which a map's keys
    // never are: only the empty one, `{}`, is a map.
    if( getLinearMapTypeArgs( typeHint ) )
    {
        if( expr.fieldNames.length > 0 ) return _bareIdentifierMapKeyError( ctx, expr.fieldNames[0] );
        return _emptyLinearMap( typeHint, expr.range );
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
    // a hint that only asks for some list (`for...of` gives `List<T>`) types nothing: the
    // elements do. Taken as is, `[ 1, 2, 3 ]` got the type `List<T>`
    if( elemsType instanceof TirTypeParam && expr.elems.length > 0 )
    {
        listType = undefined;
        elemsType = undefined;
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

/**
 * Compile a template string `` `text ${e1} more ${e2} ...` `` into a chain
 * of `appendByteString` calls.
 *
 * Each text fragment becomes a `TirLitHexBytesExpr` containing its UTF-8
 * encoding. Each interpolation is compiled and, if its type is not already
 * `bytes`, wrapped in a `TirShowExpr` so it lowers via the built-in `Show`
 * interface (or the user's `type X implements Show { ... }` override).
 *
 * Empty fragments collapse out — we don't emit `appendByteString("", x)`.
 */
function _compileTemplateStrExpr(
    ctx: AstCompilationCtx,
    expr: TemplateStrExpr,
): TirExpr | undefined
{

    const pieces: TirExpr[] = [];

    for( let i = 0; i < expr.parts.length; i++ )
    {
        const text = expr.parts[i];
        if( text.length > 0 )
        {
            pieces.push(
                new TirLitHexBytesExpr( fromUtf8( text ), expr.range )
            );
        }
        if( i < expr.exprs.length )
        {
            const sub = _compileExpr( ctx, expr.exprs[i], undefined );
            if( !sub ) return undefined;
            const subType = getUnaliased( sub.type );
            if( subType instanceof TirBytesT )
            {
                // Already valid UTF-8 by convention — pass through.
                pieces.push( sub );
            }
            else
            {
                // Auto-show via the built-in Show interface dispatch.
                pieces.push( new TirShowExpr( sub, expr.exprs[i].range ) );
            }
        }
    }

    if( pieces.length === 0 )
    {
        // Empty template — emit empty bytes.
        return new TirLitHexBytesExpr( new Uint8Array(0), expr.range );
    }

    // Left-fold appendByteString.
    let acc: TirExpr = pieces[0];
    for( let i = 1; i < pieces.length; i++ )
    {
        acc = new TirCallExpr(
            TirNativeFunc.appendByteString,
            [ acc, pieces[i] ],
            bytes_t,
            expr.range,
        );
    }
    return acc;
}
