import { AstTypeExpr } from "../../../../ast/nodes/types/AstTypeExpr";
import { UsingPath, UsingStmt } from "../../../../ast/nodes/statements/UsingStmt";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { getStructType } from "../../../tir/types/utils/canAssignTo";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { bindNamespaceMember, resolveNamespacePath } from "../../utils/resolveNamespacePath";
import { _compileDataEncodedConcreteType } from "../types/_compileDataEncodedConcreteType";
import { _compileSopEncodedConcreteType } from "../types/_compileSopEncodedConcreteType";
import { AstNamedTypeExpr } from "../../../../ast/nodes/types/AstNamedTypeExpr";

/**
 * `using` only introduces symbols in scope.
 *
 * we don't represent `using` statements in the TIR.
 *
 * the RHS can be either:
 *  - a struct type expression (legacy behavior, brings constructors into scope)
 *  - a namespace path (new behavior, destructures the namespace's exported
 *    members into the current scope)
 *
 * @returns {[]} an empty array if compilation succeeded
 * @returns {undefined} `undefined` if compilation failed
 */
export function _compileUsingStmt(
    ctx: AstCompilationCtx,
    stmt: UsingStmt
): [] | undefined
{
    const rhs = stmt.rhs;

    if( rhs instanceof UsingPath )
    {
        // namespace path. if the head is a namespace, destructure
        // its public members; otherwise fall through to the struct path
        // (this supports the single-identifier case where a name could
        //  be either a struct or a namespace).
        const ns = resolveNamespacePath( ctx, rhs );
        if( ns )
        {
            return _compileUsingNamespaceDestructure( ctx, stmt, ns.namespace );
        }

        // single-segment fallback: treat as a struct type ref
        if( rhs.segments.length === 1 )
        {
            const ident = rhs.segments[0];
            const fakeTypeExpr = new AstNamedTypeExpr( ident, [], ident.range );
            return _compileUsingStructDestructure( ctx, stmt, fakeTypeExpr );
        }

        ctx.error(
            DiagnosticCode._0_is_not_a_namespace,
            rhs.range, rhs.segments[0].text
        );
        return undefined;
    }

    // RHS is an AstTypeExpr (existing struct-destructure code path)
    return _compileUsingStructDestructure( ctx, stmt, rhs );
}

function _compileUsingStructDestructure(
    ctx: AstCompilationCtx,
    stmt: UsingStmt,
    rhs: AstTypeExpr
): [] | undefined
{
    const structOrAliasType = (
        _compileSopEncodedConcreteType( ctx, rhs )
        ?? _compileDataEncodedConcreteType( ctx, rhs )
    );
    if( !structOrAliasType ) return undefined;

    // un-alias
    const structType = getStructType( structOrAliasType );
    if( !structType || !structType.isConcrete() ) return ctx.error(
        DiagnosticCode.Type_0_does_not_have_constructors,
        rhs.range, structOrAliasType.toString()
    );

    const defCtorNames = structType.constructors.map( c => c.name );
    const sameStmtCtorNames: string[] = [];

    for( const stmtCtor of stmt.constructorNames )
    {
        const stmtCtorNameId = stmtCtor.constructorName;
        const stmtCtorName = stmtCtorNameId.text;
        const stmtReassignedCtorName = stmtCtor.renamedConstructorName;

        if( !defCtorNames.includes( stmtCtorName ) ) return ctx.error(
            DiagnosticCode.Constructor_0_is_not_part_of_the_definition_of_1,
            stmtCtorNameId.range, stmtCtorName, structType.toString(),
        );
        if( sameStmtCtorNames.includes( stmtCtorName ) ) return ctx.error(
            DiagnosticCode.Constructor_0_was_already_specified,
            stmtCtorNameId.range, stmtCtorName
        );
        sameStmtCtorNames.push( stmtCtorName );

        const valid = ctx.scope.defineAviableConstructorIfValid(
            stmtReassignedCtorName?.text ?? stmtCtorName,
            stmtCtorName,
            structOrAliasType
        );
        if( !valid )
        return ctx.error(
            DiagnosticCode.Constructor_name_0_is_already_declared_in_this_scope,
            stmtCtorNameId.range, stmtCtorName
        );
    }

    return [];
}

function _compileUsingNamespaceDestructure(
    ctx: AstCompilationCtx,
    stmt: UsingStmt,
    ns: import("../../scope/AstScope").NamespaceSymbol
): [] | undefined
{
    const seen = new Set<string>();
    for( const decl of stmt.constructorNames )
    {
        const name = decl.constructorName;
        if( seen.has( name.text ) ) return ctx.error(
            DiagnosticCode.Constructor_0_was_already_specified,
            name.range, name.text
        );
        seen.add( name.text );

        const ok = bindNamespaceMember(
            ctx,
            ns,
            name,
            decl.renamedConstructorName,
            ctx.scope
        );
        if( !ok ) return undefined;
    }
    return [];
}
