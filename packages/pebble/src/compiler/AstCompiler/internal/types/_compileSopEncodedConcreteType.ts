import { AstNamedTypeExpr } from "../../../../ast/nodes/types/AstNamedTypeExpr";
import { AstRedeemerOfTypeExpr } from "../../../../ast/nodes/types/AstRedeemerOfTypeExpr";
import { _compileQualifiedNamedTypeExpr } from "./_compileQualifiedNamedTypeExpr";
import { _compileRedeemerOfTypeExpr } from "./_compileRedeemerOfTypeExpr";
import { AstVoidType, AstBooleanType, AstIntType, AstBytesType, AstNativeOptionalType, AstListType, AstLinearMapType, AstFuncType } from "../../../../ast/nodes/types/AstNativeTypeExpr";
import { AstTypeExpr } from "../../../../ast/nodes/types/AstTypeExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirLinearMapT } from "../../../tir/types/TirNativeType/native/linearMap";
import { TirListT } from "../../../tir/types/TirNativeType/native/list";
import { TirSopOptT } from "../../../tir/types/TirNativeType/native/Optional/sop";
import { TirType } from "../../../tir/types/TirType";
import { TirSoPStructType } from "../../../tir/types/TirStructType";
import { getUnaliased } from "../../../tir/types/utils/getUnaliased";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileDataEncodedConcreteType } from "./_compileDataEncodedConcreteType";
import { getDataFuncSignature } from "./getDataFuncSignature";
import { referenceSymbol } from "../../utils/symbols";


/** `Optional<…>`, as the parser gives it: the native form, or the reserved name with its argument */
function isOptionalTypeExpr( typeExpr: AstTypeExpr ): boolean
{
    return typeExpr instanceof AstNativeOptionalType || (
        typeExpr instanceof AstNamedTypeExpr
        && typeExpr.path.length === 0
        && typeExpr.name.text === "Optional"
    );
}

export function _compileSopEncodedConcreteType(
    ctx: AstCompilationCtx,
    typeExpr: AstTypeExpr
): TirType | undefined
{
    if( typeExpr instanceof AstRedeemerOfTypeExpr )
        return _compileRedeemerOfTypeExpr( ctx, typeExpr );
    if( typeExpr instanceof AstVoidType ) return ctx.program.stdTypes.void;
    if( typeExpr instanceof AstBooleanType ) return ctx.program.stdTypes.bool;
    if( typeExpr instanceof AstIntType ) return ctx.program.stdTypes.int;
    if( typeExpr instanceof AstBytesType ) return ctx.program.stdTypes.bytes;
    if( typeExpr instanceof AstNativeOptionalType )
    {
        const compiledArg = _compileSopEncodedConcreteType( ctx, typeExpr.typeArg );
        if(!(
            compiledArg
            && compiledArg.isConcrete()
        )) return undefined;

        return ctx.program.getAppliedGeneric(
            TirSopOptT.toTirTypeKey(),
            [ compiledArg ]
        );
    }
    if( typeExpr instanceof AstListType )
    {
        // native list only supports low leve uplc types (no constrs, no functions etc.)
        const compiledArg = _compileDataEncodedConcreteType( ctx, typeExpr.typeArg );
        if(!(
            compiledArg
            && compiledArg.isConcrete()
        )) return undefined;
        
        return ctx.program.getAppliedGeneric(
            TirListT.toTirTypeKey(),
            [ compiledArg ]
        );
    }
    if( typeExpr instanceof AstLinearMapType )
    {
        // native linearMap only supports low leve uplc types (no constrs, no functions etc.)
        const kArg = _compileDataEncodedConcreteType( ctx, typeExpr.keyTypeArg );
        const vArg = _compileDataEncodedConcreteType( ctx, typeExpr.valTypeArg );
        if(!(
            kArg
            && vArg
            && kArg.isConcrete()
            && vArg.isConcrete()
        )) return undefined;

        return ctx.program.getAppliedGeneric(
            TirLinearMapT.toTirTypeKey(),
            [ kArg, vArg ]
        );
    }
    if( typeExpr instanceof AstFuncType )
    {
        // higher-order function type annotation `(a: T) => R`. Compile it to
        // the SAME `TirFuncT` a function DECLARATION with that signature
        // would produce, so a top-level function or a lambda can be passed
        // for it and type-check identically.
        return getDataFuncSignature( ctx, typeExpr );
    }
    if( typeExpr instanceof AstNamedTypeExpr ) // struct, aliases and respective params
    {
        // qualified name (`Ns.Type`, `Struct.Constructor`, `Contract.State`)
        if( typeExpr.path.length > 0 )
        {
            return _compileQualifiedNamedTypeExpr(
                ctx,
                typeExpr,
                true, // prefer sop encoding
                _compileSopEncodedConcreteType
            );
        }

        // generic type parameters take precedence over named-type lookup
        const typeParam = ctx.scope.resolveTypeParam( typeExpr.name.text );
        if( typeParam ) return typeParam;

        const possibleTirNames = ctx.scope.resolveType( typeExpr.name.text );
        if( !possibleTirNames ) return ctx.error(
            DiagnosticCode._0_is_not_defined,
            typeExpr.name.range, typeExpr.name.text
        );
        referenceSymbol( ctx.program, typeExpr.name.range, possibleTirNames.symbol );

        if( possibleTirNames.isGeneric )
        {
            if( typeExpr.tyArgs.length === 0 ) return ctx.error(
                DiagnosticCode._0_is_not_defined,
                typeExpr.name.range, typeExpr.name.text
            );
            // user generic STRUCTS follow the same convention as non-generic
            // user structs (see the non-generic tail below): the DATA
            // encoding is preferred in every position, so annotations and
            // function signatures resolve `Box<int>` to the SAME type.
            // Native generics (`Optional`) keep the per-position sop key.
            const genericKey = possibleTirNames.isGenericStruct
                ? ( possibleTirNames.dataTirName ?? possibleTirNames.sopTirName )
                : possibleTirNames.sopTirName;
            const arity = ctx.program.getGenericArity( genericKey );
            if( typeof arity === "number" && typeExpr.tyArgs.length !== arity ) return ctx.error(
                DiagnosticCode.Generic_type_0_requires_1_type_argument_s,
                typeExpr.name.range, typeExpr.name.text, arity.toString()
            );
            // `List<T>` and `LinearMap<K, V>` reach this branch too (written with a
            // name, they parse as named generics). Their elements are low-level UPLC
            // values, never constructor terms: an `Optional` among their type
            // arguments is the DATA one, as in the `AstListType` / `AstLinearMapType`
            // branches above. Compiled as SoP, a `List<Optional<int>>` got an element
            // type no list can hold: the first literal or `prepend` crashed the back
            // end. (Every other argument resolves as it did: a struct to its data
            // encoding, and a type with none — a BLS12-381 element — to itself.)
            const holdsValues =
                genericKey === TirListT.toTirTypeKey()
                || genericKey === TirLinearMapT.toTirTypeKey();
            const compiledArgs: import("../../../tir/types/TirType").TirType[] = [];
            for( const aExpr of typeExpr.tyArgs )
            {
                const a = holdsValues && isOptionalTypeExpr( aExpr )
                    ? _compileDataEncodedConcreteType( ctx, aExpr )
                    : _compileSopEncodedConcreteType( ctx, aExpr );
                if( !a ) return undefined;
                // ...and never a runtime struct either: it is a constructor term,
                // which no UPLC list holds. Accepted here, the first literal of
                // the list failed in the back end ("SoP struct cannot be
                // represented as uplc constants"), with no place to point at.
                if( holdsValues && getUnaliased( a ) instanceof TirSoPStructType ) return ctx.error(
                    DiagnosticCode.A_0_holds_plain_values_and_1_is_a_runtime_struct_which_has_no_data_encoding_Declare_it_as_a_data_struct_or_keep_such_values_in_a_recursive_runtime_struct,
                    aExpr.range, typeExpr.name.text, a.toString()
                );
                compiledArgs.push( a );
            }
            const applied = ctx.program.getAppliedGeneric(
                genericKey,
                compiledArgs
            );
            return applied;
        }

        // named user types prefer their DATA encoding in every position;
        // a runtime-only type (`runtime struct`) has no data encoding and
        // resolves to its SoP type instead (without the fallback a runtime
        // struct FIELD typed with another runtime struct — including itself,
        // for recursive declarations — would silently drop).
        const namedTirName = possibleTirNames.dataTirName ?? possibleTirNames.sopTirName;
        if( typeof namedTirName !== "string" ) return undefined;

        return ctx.program.types.get( namedTirName );
    }

    const tsEnsureExhautstiveCheck: never = typeExpr;
    console.error( typeExpr );
    throw new Error("unreachable::AstCompiler::_compileSopEncodedConcreteType");
}