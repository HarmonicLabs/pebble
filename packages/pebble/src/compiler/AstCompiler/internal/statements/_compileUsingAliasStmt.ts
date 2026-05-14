import { UsingAliasStmt } from "../../../../ast/nodes/statements/UsingStmt";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { resolveNamespacePath } from "../../utils/resolveNamespacePath";

/**
 * `using <alias> = <NamespacePath>;`
 *
 * binds `<alias>` in the current scope as a namespace alias for the
 * namespace at `<NamespacePath>`.
 *
 * compile-time only — no IR is emitted.
 */
export function _compileUsingAliasStmt(
    ctx: AstCompilationCtx,
    stmt: UsingAliasStmt
): [] | undefined
{
    const resolved = resolveNamespacePath( ctx, stmt.rhs );
    if( !resolved )
    {
        ctx.error(
            DiagnosticCode._0_is_not_a_namespace,
            stmt.rhs.range, stmt.rhs.segments[0].text
        );
        return undefined;
    }

    const ok = ctx.scope.defineNamespace({
        name: stmt.aliasName.text,
        publicScope: resolved.namespace.publicScope
    });
    if( !ok )
    {
        ctx.error(
            DiagnosticCode.Constructor_name_0_is_already_declared_in_this_scope,
            stmt.aliasName.range, stmt.aliasName.text
        );
        return undefined;
    }

    return [];
}
