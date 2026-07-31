import { AstNamedTypeExpr } from "../../../../ast/nodes/types/AstNamedTypeExpr";
import { AstTypeExpr } from "../../../../ast/nodes/types/AstTypeExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirType } from "../../../tir/types/TirType";
import { getStructType } from "../../../tir/types/utils/canAssignTo";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { PossibleTirTypes } from "../../scope/AstScope";

/**
 * Resolves a QUALIFIED named type expression (`typeExpr.path.length > 0`),
 * i.e. a TS-style dotted type name.
 *
 * Two resolution strategies, tried in order:
 *
 * 1. **namespace member**: the path walks namespaces
 *    (`import * as lib from "..."` then `lib.SomeType`); the final name is
 *    resolved as a type in the last namespace's public scope.
 *
 * 2. **`Type.Constructor` narrowing** (single qualifier only): the qualifier
 *    resolves to a struct (or a contract's synthesized state-datum union) in
 *    scope, and the name is one of its constructors. The result is the
 *    struct type NARROWED to that single constructor — its `parentCtorIdx`
 *    keeps the constructor's tag in the parent union, so decoding/matching
 *    a value of the narrowed type checks the right tag.
 *    This is what makes `od as Contract.State` (bug 9 of
 *    the-cardano-masterpiece) and `od as Struct.Variant` work.
 *
 * `compileTypeArg` is the flavor-specific compiler (data / sop encoded) of
 * the caller, used to compile generic type args on the last segment.
 */
export function _compileQualifiedNamedTypeExpr(
    ctx: AstCompilationCtx,
    typeExpr: AstNamedTypeExpr,
    preferSopEncoding: boolean,
    compileTypeArg: ( ctx: AstCompilationCtx, tyExpr: AstTypeExpr ) => TirType | undefined
): TirType | undefined
{
    const path = typeExpr.path;
    const name = typeExpr.name;

    const pickTirName = ( possible: PossibleTirTypes ): string | undefined =>
        preferSopEncoding
            ? ( possible.sopTirName ?? possible.dataTirName )
            : ( possible.dataTirName ?? possible.sopTirName );

    // 1) namespace chain
    const headNs = ctx.scope.resolveNamespace( path[0].text );
    if( headNs )
    {
        let current = headNs;
        for( let i = 1; i < path.length; i++ )
        {
            const nested = current.publicScope.namespaces.get( path[i].text );
            if( !nested )
            {
                return ctx.error(
                    DiagnosticCode.Namespace_0_has_no_exported_member_1,
                    path[i].range, current.name, path[i].text
                );
            }
            current = nested;
        }
        // NON-walking lookup: a qualified path `M.T` must resolve `T` as a
        // member of `M`'s own public scope, NOT walk up into the enclosing
        // file scope. `resolveType` walks parents, and `publicScope` is a
        // child of the file scope, so it used to resolve ANY file-level type
        // (or non-exported type via `Lib.M.Private`) through any namespace
        // path — a scope leak (audit BUG 37).
        const possible = current.publicScope.resolveLocalType( name.text );
        if( !possible )
        {
            return ctx.error(
                DiagnosticCode.Namespace_0_has_no_exported_member_1,
                name.range, current.name, name.text
            );
        }
        return _fromPossibleTirTypes( ctx, typeExpr, possible, pickTirName, compileTypeArg );
    }

    // 2) `Type.Constructor` narrowing (only meaningful with a single qualifier)
    if( path.length === 1 )
    {
        const possible = ctx.scope.resolveType( path[0].text );
        if( possible )
        {
            const tirName = pickTirName( possible );
            const baseType = typeof tirName === "string"
                ? ctx.program.types.get( tirName )
                : undefined;
            const structType = getStructType( baseType );
            if( structType )
            {
                const ctorIdx = structType.constructors.findIndex(
                    ctor => ctor.name === name.text
                );
                if( ctorIdx >= 0 )
                {
                    if( typeExpr.tyArgs.length > 0 )
                    {
                        return ctx.error(
                            DiagnosticCode._0_is_not_defined,
                            name.range, typeExpr.toAstName()
                        );
                    }
                    return structType.narrowTo([ structType.parentCtorIdx( ctorIdx ) ]);
                }
            }
            return ctx.error(
                DiagnosticCode.Property_0_does_not_exist_on_type_1,
                name.range, name.text, path[0].text
            );
        }
    }

    return ctx.error(
        DiagnosticCode._0_is_not_defined,
        path[0].range, path[0].text
    );
}

function _fromPossibleTirTypes(
    ctx: AstCompilationCtx,
    typeExpr: AstNamedTypeExpr,
    possible: PossibleTirTypes,
    pickTirName: ( possible: PossibleTirTypes ) => string | undefined,
    compileTypeArg: ( ctx: AstCompilationCtx, tyExpr: AstTypeExpr ) => TirType | undefined
): TirType | undefined
{
    if( possible.isGeneric )
    {
        if( typeExpr.tyArgs.length === 0 )
        {
            return ctx.error(
                DiagnosticCode._0_is_not_defined,
                typeExpr.name.range, typeExpr.toAstName()
            );
        }
        const compiledArgs: TirType[] = [];
        for( const aExpr of typeExpr.tyArgs )
        {
            const a = compileTypeArg( ctx, aExpr );
            if( !a ) return undefined;
            compiledArgs.push( a );
        }
        const tirName = pickTirName( possible );
        if( typeof tirName !== "string" ) return undefined;
        return ctx.program.getAppliedGeneric( tirName, compiledArgs );
    }

    const tirName = pickTirName( possible );
    if( typeof tirName !== "string" ) return undefined;
    return ctx.program.types.get( tirName );
}
