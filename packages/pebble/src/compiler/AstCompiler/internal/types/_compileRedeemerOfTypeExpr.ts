import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { AstRedeemerOfTypeExpr } from "../../../../ast/nodes/types/AstRedeemerOfTypeExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirType } from "../../../tir/types/TirType";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { AstContractSymbol, NamespaceSymbol } from "../../scope/AstScope";

/**
 * Resolves `redeemerof C` / `redeemerof C.State` (optionally behind a
 * namespace: `redeemerof ns.C.State`).
 *
 * - `redeemerof C` → the contract's MERGED direct-methods redeemer union
 * - `redeemerof C.State` → that state's spend-methods redeemer union
 *
 * anything deeper (`redeemerof C.method`, `redeemerof C.State.x`) is a
 * dedicated diagnostic: per-method redeemer types do not exist.
 *
 * the redeemer unions are data-encoded structs, so the same TIR type is
 * returned for both encoding flavors.
 */
export function _compileRedeemerOfTypeExpr(
    ctx: AstCompilationCtx,
    typeExpr: AstRedeemerOfTypeExpr
): TirType | undefined
{
    const target = typeExpr.target;
    const segments: Identifier[] = [ ...target.path, target.name ];

    // find the contract symbol: first segment directly in scope, or behind
    // a namespace chain
    let contract: AstContractSymbol | undefined = undefined;
    let consumed = 0;

    contract = ctx.scope.resolveContract( segments[0].text );
    if( contract ) consumed = 1;
    else
    {
        let ns = ctx.scope.resolveNamespace( segments[0].text );
        if( ns )
        {
            let i = 1;
            while( i < segments.length )
            {
                const nested: NamespaceSymbol | undefined = ns.publicScope.namespaces.get( segments[i].text );
                if( !nested ) break;
                ns = nested;
                i++;
            }
            if( i < segments.length )
            {
                contract = ns!.publicScope.contracts.get( segments[i].text );
                if( contract ) consumed = i + 1;
            }
        }
    }

    if( !contract )
    {
        return ctx.error(
            DiagnosticCode._0_is_not_a_contract_redeemerof_can_only_be_applied_to_an_exported_contract_or_one_of_its_states,
            segments[0].range, segments[0].text
        );
    }

    if( target.tyArgs.length > 0 )
    {
        return ctx.error(
            DiagnosticCode._redeemerof_expects_a_contract_or_a_contract_state_per_method_redeemer_types_do_not_exist,
            target.name.range
        );
    }

    const remaining = segments.slice( consumed );

    if( remaining.length === 0 )
    {
        if( typeof contract.directRedeemerTirName !== "string" )
        {
            return ctx.error(
                DiagnosticCode.Contract_0_has_no_methods_it_has_no_redeemer_type,
                typeExpr.range, contract.name
            );
        }
        return ctx.program.types.get( contract.directRedeemerTirName );
    }

    if( remaining.length === 1 )
    {
        const stateName = remaining[0].text;
        if( !contract.stateNames.includes( stateName ) )
        {
            return ctx.error(
                DiagnosticCode.Contract_0_has_no_state_1,
                remaining[0].range, contract.name, stateName
            );
        }
        const tirName = contract.stateRedeemerTirNames.get( stateName );
        if( typeof tirName !== "string" )
        {
            return ctx.error(
                DiagnosticCode.State_0_of_contract_1_has_no_spend_methods_it_has_no_redeemer_type,
                remaining[0].range, stateName, contract.name
            );
        }
        return ctx.program.types.get( tirName );
    }

    // remaining.length > 1 — attempts like `redeemerof C.State.method`
    return ctx.error(
        DiagnosticCode._redeemerof_expects_a_contract_or_a_contract_state_per_method_redeemer_types_do_not_exist,
        remaining[1].range
    );
}
