import { Identifier } from "../../../ast/nodes/common/Identifier";
import { DotPropAccessExpr } from "../../../ast/nodes/expr/PropAccessExpr";
import { PebbleExpr } from "../../../ast/nodes/expr/PebbleExpr";
import { DiagnosticCode } from "../../../diagnostics/diagnosticMessages.generated";
import { TirExpr } from "../../tir/expressions/TirExpr";
import { TirVariableAccessExpr } from "../../tir/expressions/TirVariableAccessExpr";
import { AstCompilationCtx } from "../AstCompilationCtx";
import { NamespaceSymbol } from "../scope/AstScope";

export type NamespaceChainResolution =
    | { kind: "namespace"; namespace: NamespaceSymbol }
    | { kind: "value"; expr: TirExpr }
    /** the chain points to a non-value (type / interface / nested ns
     *  used in non-expression position). callers should typically error. */
    | { kind: "incomplete" }
    | undefined;

/**
 * if `expr` is `Identifier` or a chain of `DotPropAccessExpr` ending in an
 * `Identifier`, AND the head identifier resolves to a namespace in scope,
 * walks the chain through namespace `publicScope`s and returns the resolved
 * member. otherwise returns `undefined` so the caller can fall back to
 * normal value/property-access compilation.
 *
 * the resolution does NOT emit diagnostics on plain "not a namespace"
 * outcomes — those are silent failures so the caller can choose another
 * resolution strategy.
 */
export function tryResolveNamespaceChain(
    ctx: AstCompilationCtx,
    expr: PebbleExpr
): NamespaceChainResolution
{
    const segments = _collectChainSegments( expr );
    if( !segments ) return undefined;

    const head = ctx.scope.resolveNamespace( segments[0].text );
    if( !head ) return undefined;

    // head is a namespace; from here on, any failure emits a diagnostic
    let current: NamespaceSymbol = head;
    for( let i = 1; i < segments.length; i++ )
    {
        const seg = segments[i];
        const name = seg.text;
        const pub = current.publicScope;

        const nested = pub.namespaces.get( name );
        if( nested )
        {
            current = nested;
            continue;
        }

        const variable = pub.variables.get( name );
        if( variable )
        {
            // last segment must end here; if not, the chain is invalid
            if( i !== segments.length - 1 )
            {
                ctx.error(
                    DiagnosticCode.Property_0_does_not_exist_on_type_1,
                    seg.range, segments[i + 1].text, variable.type.toString()
                );
                return { kind: "incomplete" };
            }
            return {
                kind: "value",
                expr: new TirVariableAccessExpr(
                    { variableInfos: variable, isDefinedOutsideFuncScope: true },
                    seg.range
                )
            };
        }

        const tirFuncName = pub.functions.get( name );
        if( tirFuncName )
        {
            if( i !== segments.length - 1 )
            {
                // function-typed member can't be further dotted
                ctx.error(
                    DiagnosticCode.Namespace_path_is_incomplete,
                    seg.range
                );
                return { kind: "incomplete" };
            }
            const funcExpr = pub.program.functions.get( tirFuncName );
            if( !funcExpr )
            {
                ctx.error(
                    DiagnosticCode.Namespace_0_has_no_exported_member_1,
                    seg.range, current.name, name
                );
                return { kind: "incomplete" };
            }
            return {
                kind: "value",
                expr: new TirVariableAccessExpr(
                    {
                        variableInfos: {
                            isConstant: true,
                            name: tirFuncName,
                            type: funcExpr.type,
                        },
                        isDefinedOutsideFuncScope: true,
                    },
                    seg.range
                )
            };
        }

        // not a namespace, not a value, not a function — likely a type or
        // interface. either way it can't be used as a value here.
        if( pub.types.has( name ) || pub.interfaces.has( name ) )
        {
            ctx.error(
                DiagnosticCode.Namespace_path_is_incomplete,
                seg.range
            );
            return { kind: "incomplete" };
        }

        ctx.error(
            DiagnosticCode.Namespace_0_has_no_exported_member_1,
            seg.range, current.name, name
        );
        return { kind: "incomplete" };
    }

    // chain consumed entirely as namespaces (no leaf member)
    return { kind: "namespace", namespace: current };
}

function _collectChainSegments( expr: PebbleExpr ): Identifier[] | undefined
{
    if( expr instanceof Identifier ) return [ expr ];
    if( expr instanceof DotPropAccessExpr )
    {
        const inner = _collectChainSegments( expr.object );
        if( !inner ) return undefined;
        inner.push( expr.prop );
        return inner;
    }
    // anything other than a plain dotted-identifier chain disqualifies
    // namespace resolution.
    return undefined;
}
