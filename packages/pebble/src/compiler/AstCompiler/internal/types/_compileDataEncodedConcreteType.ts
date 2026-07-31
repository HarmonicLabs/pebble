import { AstNamedTypeExpr } from "../../../../ast/nodes/types/AstNamedTypeExpr";
import { AstRedeemerOfTypeExpr } from "../../../../ast/nodes/types/AstRedeemerOfTypeExpr";
import { _compileQualifiedNamedTypeExpr } from "./_compileQualifiedNamedTypeExpr";
import { _compileRedeemerOfTypeExpr } from "./_compileRedeemerOfTypeExpr";
import { AstVoidType, AstBooleanType, AstIntType, AstBytesType, AstNativeOptionalType, AstListType, AstLinearMapType, AstFuncType } from "../../../../ast/nodes/types/AstNativeTypeExpr";
import { AstTypeExpr } from "../../../../ast/nodes/types/AstTypeExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirLinearMapT } from "../../../tir/types/TirNativeType/native/linearMap";
import { TirListT } from "../../../tir/types/TirNativeType/native/list";
import { TirDataOptT } from "../../../tir/types/TirNativeType/native/Optional/data";
import { TirSopOptT } from "../../../tir/types/TirNativeType/native/Optional/sop";
import { TirType } from "../../../tir/types/TirType";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { getDataFuncSignature } from "./getDataFuncSignature";


export function _compileDataEncodedConcreteType(
    ctx: AstCompilationCtx,
    typeExpr: AstTypeExpr,
    optionalsAsSop: boolean = false
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
        const compiledArg = _compileDataEncodedConcreteType( ctx, typeExpr.typeArg );
        if(!(
            compiledArg
            // && compiledArg.isConcrete()
            && compiledArg.hasDataEncoding()
        )) return undefined;

        return ctx.program.getAppliedGeneric(
            optionalsAsSop ? TirSopOptT.toTirTypeKey() : TirDataOptT.toTirTypeKey(),
            [ compiledArg ]
        );
    }
    if( typeExpr instanceof AstListType )
    {
        const compiledArg = _compileDataEncodedConcreteType( ctx, typeExpr.typeArg );
        if(!(
            compiledArg
            // && compiledArg.isConcrete()
            && compiledArg.hasDataEncoding()
        )) return undefined;
        
        return ctx.program.getAppliedGeneric(
            TirListT.toTirTypeKey(),
            [ compiledArg ]
        );
    }
    if( typeExpr instanceof AstLinearMapType )
    {
        const kArg = _compileDataEncodedConcreteType( ctx, typeExpr.keyTypeArg );
        const vArg = _compileDataEncodedConcreteType( ctx, typeExpr.valTypeArg );
        if(!(
            kArg
            && vArg
            // && kArg.isConcrete()
            // && vArg.isConcrete()
            && kArg.hasDataEncoding()
            && vArg.hasDataEncoding()
        )) return undefined;

        return ctx.program.getAppliedGeneric(
            TirLinearMapT.toTirTypeKey(),
            [ kArg, vArg ]
        );
    }
    if( typeExpr instanceof AstFuncType )
    {
        // higher-order function type annotation `(a: T) => R` — see the
        // matching branch in `_compileSopEncodedConcreteType`. A function
        // value has no data encoding, but the ANNOTATION still resolves to a
        // `TirFuncT` (the same one a declaration with that signature yields).
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
                false, // prefer data encoding
                ( ctx, tyExpr ) => _compileDataEncodedConcreteType( ctx, tyExpr, optionalsAsSop )
            );
        }

        // generic type parameters take precedence: `T` in a generic function
        // body resolves directly to its TirTypeParam, leaving substitution
        // to `monomorphizeGeneric` at call time.
        const typeParam = ctx.scope.resolveTypeParam( typeExpr.name.text );
        if( typeParam ) return typeParam;

        const possibleTirNames = ctx.scope.resolveType( typeExpr.name.text );
        if( !possibleTirNames ) return ctx.error(
            DiagnosticCode._0_is_not_defined,
            typeExpr.name.range, typeExpr.name.text
        );

        if( possibleTirNames.isGeneric )
        {
            // Generic named type with explicit type-args, e.g. `List<int>` —
            // compile each arg and apply the generic.
            if( typeExpr.tyArgs.length === 0 ) return ctx.error(
                DiagnosticCode._0_is_not_defined,
                typeExpr.name.range, typeExpr.name.text
            );
            const compiledArgs: import("../../../tir/types/TirType").TirType[] = [];
            for( const aExpr of typeExpr.tyArgs )
            {
                const a = _compileDataEncodedConcreteType( ctx, aExpr, optionalsAsSop );
                if( !a ) return undefined;
                compiledArgs.push( a );
            }
            const applied = ctx.program.getAppliedGeneric(
                possibleTirNames.dataTirName ?? possibleTirNames.sopTirName,
                compiledArgs
            );
            return applied;
        }

        if( typeof possibleTirNames.dataTirName !== "string" ) return undefined;

        return ctx.program.types.get( possibleTirNames.dataTirName );
    }

    const tsEnsureExhautstiveCheck: never = typeExpr;
    console.error( typeExpr );
    throw new Error("unreachable::AstCompiler::_compileDataEncodedConcreteType");
}