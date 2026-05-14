import { Identifier } from "../../../ast/nodes/common/Identifier";
import { UsingPath } from "../../../ast/nodes/statements/UsingStmt";
import { DiagnosticCode } from "../../../diagnostics/diagnosticMessages.generated";
import { AstScope, NamespaceSymbol } from "../scope/AstScope";
import { AstCompilationCtx } from "../AstCompilationCtx";

export interface ResolvedNamespacePath {
    /** the namespace the path resolves to */
    namespace: NamespaceSymbol;
    /** the chain of resolved namespaces (one per segment of the path) */
    chain: NamespaceSymbol[];
}

/**
 * walks a dotted namespace path against the given scope.
 *
 * - returns the final `NamespaceSymbol` if every segment resolves to a namespace.
 * - if the first segment is not a namespace, returns `undefined`
 *   (no diagnostic emitted; the caller can fall back to a different
 *   resolution strategy, e.g. struct lookup).
 * - if a later segment is missing or is not a namespace, emits a
 *   diagnostic and returns `undefined`.
 */
export function resolveNamespacePath(
    ctx: AstCompilationCtx,
    path: UsingPath
): ResolvedNamespacePath | undefined
{
    const segments = path.segments;
    if( segments.length === 0 ) return undefined;

    const head = segments[0];
    const first = ctx.scope.resolveNamespace( head.text );
    if( !first ) return undefined;

    const chain: NamespaceSymbol[] = [ first ];
    let current: NamespaceSymbol = first;

    for( let i = 1; i < segments.length; i++ )
    {
        const seg = segments[i];
        const inner = current.publicScope.namespaces.get( seg.text );
        if( !inner )
        {
            ctx.error(
                DiagnosticCode.Namespace_0_has_no_exported_member_1,
                seg.range, current.name, seg.text
            );
            return undefined;
        }
        chain.push( inner );
        current = inner;
    }

    return { namespace: current, chain };
}

/**
 * looks up a member name in a namespace's public scope.
 *
 * the member can be any of:
 *   - a value (variable)
 *   - a function
 *   - a type
 *   - an interface
 *   - a nested namespace
 *
 * binds the resolved member into `target` (under either `originalName`
 * or `aliasName` if provided). emits a diagnostic and returns `false`
 * if no such member is exported, or if a conflicting binding already
 * exists in `target`.
 */
export function bindNamespaceMember(
    ctx: AstCompilationCtx,
    ns: NamespaceSymbol,
    originalName: Identifier,
    aliasName: Identifier | undefined,
    target: AstScope
): boolean
{
    const pub = ns.publicScope;
    const name = originalName.text;
    const localName = aliasName?.text ?? name;

    const variable = pub.variables.get( name );
    const fn = pub.functions.get( name );
    const tirFunc = fn ? pub.program.functions.get( fn ) : undefined;
    const ty = pub.types.get( name );
    const iface = pub.interfaces.get( name );
    const nested = pub.namespaces.get( name );

    if( !variable && !fn && !ty && !iface && !nested )
    {
        ctx.error(
            DiagnosticCode.Namespace_0_has_no_exported_member_1,
            originalName.range, ns.name, name
        );
        return false;
    }

    let ok = true;

    if( variable )
    {
        ok = target.defineValue({ ...variable, name: localName }) && ok;
    }
    if( fn )
    {
        target.functions.set( localName, fn );
        if( tirFunc )
        {
            target.defineValue({
                isConstant: true,
                name: localName,
                type: tirFunc.type,
            });
        }
    }
    if( ty )
    {
        ok = target.defineType( localName, ty ) && ok;
    }
    if( iface )
    {
        if( target.interfaces.has( localName ) ) ok = false;
        else target.interfaces.set( localName, iface );
    }
    if( nested )
    {
        ok = target.defineNamespace({
            name: localName,
            publicScope: nested.publicScope
        }) && ok;
    }

    return ok;
}
