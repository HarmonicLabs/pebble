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
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileDataEncodedConcreteType } from "./_compileDataEncodedConcreteType";
import { getDataFuncSignature } from "./getDataFuncSignature";


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
            const compiledArgs: import("../../../tir/types/TirType").TirType[] = [];
            for( const aExpr of typeExpr.tyArgs )
            {
                const a = _compileSopEncodedConcreteType( ctx, aExpr );
                if( !a ) return undefined;
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