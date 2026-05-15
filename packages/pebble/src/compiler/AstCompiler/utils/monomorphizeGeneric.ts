import { CommonFlags } from "../../../common";
import { FuncExpr } from "../../../ast/nodes/expr/functions/FuncExpr";
import { Identifier } from "../../../ast/nodes/common/Identifier";
import { ArrowKind } from "../../../ast/nodes/expr/functions/ArrowKind";
import { SourceRange } from "../../../ast/Source/SourceRange";
import { DiagnosticCode } from "../../../diagnostics/diagnosticMessages.generated";
import { GenericTemplate, TypedProgram } from "../../tir/program/TypedProgram";
import { TirFuncT } from "../../tir/types/TirNativeType/native/function";
import { TirType } from "../../tir/types/TirType";
import { substituteTypeParams } from "../../tir/types/utils/substituteTypeParams";
import { AstCompilationCtx } from "../AstCompilationCtx";
import { AstScope } from "../scope/AstScope";
import { _compileFuncExpr } from "../internal/exprs/_compileFuncExpr";

export interface MonomorphizationResult {
    /** the canonical TIR function name registered in `program.functions` */
    tirFuncName: string;
    /** the substituted concrete TirFuncT (no remaining type params) */
    concreteFuncType: TirFuncT;
}

/**
 * Returns a deterministic instance key for memoization & function-table naming.
 */
export function buildMonomorphizationKey(
    templateCanonicalName: string,
    typeArgs: TirType[]
): string
{
    return templateCanonicalName + "$$" + typeArgs.map( t => t.toConcreteTirTypeName() ).join("$$");
}

/**
 * Instantiate a generic function template with the given concrete type
 * arguments, producing (and caching) a fresh concrete TIR function.
 *
 * The strategy is "desugar to a concrete function during AST→TIR":
 *
 * 1. Build a child scope on the template's defining scope where each type
 *    parameter name resolves as a type alias for its concrete type. When the
 *    cloned FuncExpr is re-compiled, every `AstNamedTypeExpr` mentioning a
 *    type parameter resolves to its concrete TIR type.
 * 2. Construct a fresh `FuncExpr` reusing the template's body & signature but
 *    with `typeParams = []` (so the "not implemented: generic functions"
 *    guard in `_compileFuncExpr` does not trip) and a unique instance name.
 * 3. Compile via `_compileFuncExpr` and register the resulting `TirFuncExpr`
 *    in `program.functions` under the instance name.
 *
 * Results are memoized per `(template, type-args)` tuple — repeated calls
 * with the same type arguments return the same instance and do not
 * re-compile.
 */
export function monomorphizeGeneric(
    ctx: AstCompilationCtx,
    template: GenericTemplate,
    typeArgs: TirType[],
    callRange: SourceRange
): MonomorphizationResult | undefined
{
    const program = ctx.program;

    if( typeArgs.length !== template.typeParams.length )
    {
        ctx.error(
            DiagnosticCode.Expected_0_type_arguments_but_got_1,
            callRange,
            String( template.typeParams.length ),
            String( typeArgs.length )
        );
        return undefined;
    }

    // Build the substitution env for substituteTypeParams
    const subst = new Map<symbol, TirType>();
    for( let i = 0; i < template.typeParams.length; i++ )
    {
        subst.set( template.typeParams[i].symbol, typeArgs[i] );
    }

    // Compute concrete signature up-front (used by callers to type the call expr)
    const concreteFuncType = substituteTypeParams( template.placeholderFuncType, subst ) as TirFuncT;

    // Memo key & cache hit
    const instanceName = buildMonomorphizationKey( template.canonicalTirName, typeArgs );
    const cached = program.monomorphizationCache.get( instanceName );
    if( typeof cached === "string" )
    {
        return { tirFuncName: cached, concreteFuncType };
    }

    // Native template path: skip AST cloning entirely.
    if( template.kind === "native" )
    {
        const tirFunc = template.instantiate( typeArgs );
        program.functions.set( instanceName, tirFunc );
        program.monomorphizationCache.set( instanceName, instanceName );
        return { tirFuncName: instanceName, concreteFuncType };
    }

    // Cycle detection: polymorphic recursion (same template + same type args
    // re-entering before the first compile finished) is impossible because
    // recursion at the same type-args hits the memo cache below. Recursion at
    // *different* type-args is allowed and produces a separate instance.
    if( program.monomorphizationInFlight.has( instanceName ) )
    {
        // intentionally rare path; surface as a Not_implemented diagnostic
        ctx.error(
            DiagnosticCode.Not_implemented_0,
            callRange,
            "mutually-recursive monomorphization for " + instanceName
        );
        return undefined;
    }
    program.monomorphizationInFlight.add( instanceName );

    // Pre-register memo so recursive same-args call resolves to the same name
    program.monomorphizationCache.set( instanceName, instanceName );

    try
    {
        // Build child scope where each type-param name aliases its concrete type
        const monoScope: AstScope = template.definingScope.newChildScope({
            ...template.definingScope.infos,
            isFunctionDeclScope: false,
            isMethodScope: false
        });

        for( let i = 0; i < template.typeParams.length; i++ )
        {
            const tparam = template.typeParams[i];
            const concrete = typeArgs[i];
            const concreteKey = concrete.toConcreteTirTypeName();
            if( !program.types.has( concreteKey ) )
            {
                program.types.set( concreteKey, concrete );
            }
            monoScope.defineUnambigousType(
                tparam.name,
                concreteKey,
                concrete.hasDataEncoding(),
                new Map() // no methods on a bare type alias
            );
        }

        // Register the instance in the parent (defining) scope under the
        // instance name so the body's own recursive `id(...)` call (which
        // resolves through the parent chain) sees a concrete value of the
        // already-substituted type. Without this, recursive calls would
        // re-trigger the generic placeholder path and infinite-loop the
        // monomorphizer.
        // Use the mono scope (not the defining scope) so the entry is local
        // to this instantiation.
        monoScope.defineValue({
            name: instanceName,
            type: concreteFuncType,
            isConstant: true,
        });

        const cloneExpr = new FuncExpr(
            new Identifier( instanceName, template.astFuncExpr.name.range ),
            template.astFuncExpr.flags,
            [], // intentionally empty: this clone is the monomorphized concrete fn
            template.astFuncExpr.signature,
            template.astFuncExpr.body,
            template.astFuncExpr.arrowKind ?? ArrowKind.None,
            template.astFuncExpr.range
        );

        // Pre-seed program.functions with the concrete signature so
        // `_compileFuncExpr` picks it up via `program.functions.get(...).sig()`.
        // We will replace this with the real TirFuncExpr after compile.
        // (placeholder is not strictly required; _compileFuncExpr falls back to
        //  inferring from the signature if not present — leaving this out for
        //  simplicity)

        const monoCtx = AstCompilationCtx.fromScope( program, monoScope );
        const tirFuncExpr = _compileFuncExpr(
            monoCtx,
            cloneExpr,
            undefined,
            false // isMethod
        );

        if( !tirFuncExpr )
        {
            program.monomorphizationCache.delete( instanceName );
            return undefined;
        }

        program.functions.set( instanceName, tirFuncExpr );

        return { tirFuncName: instanceName, concreteFuncType };
    }
    finally
    {
        program.monomorphizationInFlight.delete( instanceName );
    }
}
