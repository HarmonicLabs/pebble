import { isClosedTerm, prettyUPLC, type UPLCTerm } from "@harmoniclabs/uplc";
import type { IRTerm } from "../IRTerm";
import { IRLetted } from "../IRNodes/IRLetted";
import { IRHoisted } from "../IRNodes/IRHoisted";
import { IRConst } from "../IRNodes/IRConst";
import { _modifyChildFromTo } from "./_internal/_modifyChildFromTo";
import { _makeAllNegativeNativesHoisted } from "./_internal/_makeAllNegativeNativesHoisted";
import { includesNode } from "./_internal/includesNode";
import { handleLettedAndReturnRoot } from "./subRoutines/handleLetted";
import { handleHoistedAndReturnRoot } from "./subRoutines/handleHoistedAndReturnRoot";
import { replaceNativesAndReturnRoot } from "./subRoutines/replaceNatives";
import { replaceClosedLettedWithHoisted } from "./subRoutines/replaceClosedLettedWithHoisted";
import { hoistForcedNatives } from "./subRoutines/hoistForcedNatives";
import { iterTree } from "./_internal/iterTree";
import { isForcedNativeTag } from "../IRNodes/IRNative/isForcedNative";
import { handleRootRecursiveTerm } from "./subRoutines/handleRecursiveTerms";
import { CompilerOptions, completeCompilerOptions, defaultOptions } from "./CompilerOptions";
import { replaceHoistedWithLetted } from "./subRoutines/replaceHoistedWithLetted";
import { IRApp, IRCase, IRConstr, IRFunc, IRNative, IRVar } from "../IRNodes";
import { replaceForcedNativesWithHoisted } from "./subRoutines/replaceForcedNativesWithHoisted";
import { performUplcOptimizationsAndReturnRoot } from "./subRoutines/performUplcOptimizationsAndReturnRoot/performUplcOptimizationsAndReturnRoot";
import { rewriteNativesAppliedToConstantsAndReturnRoot } from "./subRoutines/rewriteNativesAppliedToConstantsAndReturnRoot";
import { eliminateDataRoundTripsAndReturnRoot } from "./subRoutines/eliminateDataRoundTripsAndReturnRoot";
import { rewriteToCaseOverConstAndReturnRoot } from "./subRoutines/rewriteToCaseOverConstAndReturnRoot";
import { rewriteHeadTailInCaseConsAndReturnRoot } from "./subRoutines/rewriteHeadTailInCaseConsAndReturnRoot";
import { introduceCaseForDualHeadTailAndReturnRoot } from "./subRoutines/introduceCaseForDualHeadTailAndReturnRoot";
import { inlineSingleUseLetBindingsAndReturnRoot } from "./subRoutines/inlineSingleUseLetBindingsAndReturnRoot";
import { _debug_assertClosedIR, onlyHoistedAndLetted, prettyIR, prettyIRJsonStr, prettyIRText } from "../utils";
import { ToUplcCtx } from "./ctx/ToUplcCtx";
import { removeUnusedVarsAndReturnRoot } from "./subRoutines/removeUnusuedVarsAndReturnRoot/removeUnusuedVarsAndReturnRoot";
import { IRRecursive } from "../IRNodes/IRRecursive";
import { ensureProperlyForcedBuiltinsAndReturnRoot } from "./subRoutines/performUplcOptimizationsAndReturnRoot/ensureProperlyForcedBuiltinsAndReturnRoot";



export function compileIRToUPLC(
    term: IRTerm,
    paritalOptions: Partial<CompilerOptions> = defaultOptions
): UPLCTerm
{
    // most of the time we are just compiling small
    // pre-execuded terms (hence constants)
    if( term instanceof IRConst ) return term.toUPLC();

    ///////////////////////////////////////////////////////////////////////////////
    // ------------------------------------------------------------------------- //
    // --------------------------------- init  --------------------------------- //
    // ------------------------------------------------------------------------- //
    ///////////////////////////////////////////////////////////////////////////////

    const options = completeCompilerOptions( paritalOptions );


    // const debugAsserts = (options as any).debugAsserts ?? false;

    // unwrap top level letted and hoisted;
    while( term instanceof IRLetted || term instanceof IRHoisted )
    {
        // replace with value
        term = term instanceof IRLetted ? term.value : term.hoisted;

        // forget the parent; this is the new root
        term.parent = undefined;
    }

    // debugAsserts && _debug_assertions( term );

    ///////////////////////////////////////////////////////////////////////////////
    // ------------------------------------------------------------------------- //
    // ----------------------------- optimizations ----------------------------- //
    // ------------------------------------------------------------------------- //
    ///////////////////////////////////////////////////////////////////////////////

    // term = preEvaluateDefinedTermsAndReturnRoot( term );
    term = rewriteNativesAppliedToConstantsAndReturnRoot( term );
    // struct-literal construction consumed in place produces
    // decode-after-encode chains; eliminate them before anything else
    // duplicates or shares them (see eliminateDataRoundTrips docs)
    term = eliminateDataRoundTripsAndReturnRoot( term );
    // debugAsserts && _debug_assertions( term );

    // removing unused variables BEFORE going into the rest of the compilation
    // helps letted terms to find a better spot (and possibly be inlined instead of hoisted)
    term = removeUnusedVarsAndReturnRoot( term );
    // debugAsserts && _debug_assertions( term );

    _makeAllNegativeNativesHoisted( term );

    term = replaceNativesAndReturnRoot( term );
    // re-call rewrite to optimize introduced hoisted
    term = rewriteNativesAppliedToConstantsAndReturnRoot( term );
    // the rewrite above can itself introduce custom (negative-tag) natives
    // (eg. `equalsInteger(x, 0)` -> `_isZero(x)`, `addInteger(x, 1)` ->
    // `_increment(x)`); lower those too, otherwise they survive as bare
    // IRNatives and crash the later forcing pass with
    // "getNRequiredForces ... input was: -<tag>". This only surfaced in
    // contracts complex enough for the rewrite to fire on shared/hoisted bodies.
    term = replaceNativesAndReturnRoot( term );

    // Lower `strictIfThenElse` triple-apps to `IRCase` BEFORE
    // `replaceForcedNativesWithHoisted` would otherwise hoist
    // `(force ifThenElse)` into a shared variable that's no longer
    // pattern-matchable as a native. (`strictChooseList` is already
    // lowered to `IRCase` unconditionally by the earlier
    // `rewriteNativesAppliedToConstantsAndReturnRoot` pass.)
    term = rewriteToCaseOverConstAndReturnRoot( term );

    // Inside `case L of cons h t -> body`, replace any `headList(L)` /
    // `tailList(L)` calls within `body` with `h` / `t`. Drop the now-dead
    // `h`/`t` bindings via a fresh unused-vars sweep.
    term = rewriteHeadTailInCaseConsAndReturnRoot( term );
    term = removeUnusedVarsAndReturnRoot( term );

    // For every IRFunc body where the same list L is accessed via BOTH
    // `headList(L)` and `tailList(L)`, wrap the body in
    // `case L of cons h t -> body' | nil -> error` and substitute the two
    // builtin calls with `h` / `t`. Empirically (bench.headTailVsCase):
    // one case dispatch costs ~128K CPU vs ~160K for two builtin calls,
    // and only ~9 bytes vs ~16. The previous head/tail-in-case-cons pass
    // can then make a second sweep to substitute any further internal
    // references the new case introduced.
    term = introduceCaseForDualHeadTailAndReturnRoot( term );
    term = rewriteHeadTailInCaseConsAndReturnRoot( term );
    term = removeUnusedVarsAndReturnRoot( term );

    // debugAsserts && _debug_assertions( term );

    // unwrap top level letted and hoisted;
    // some natives may be converted to hoisted;
    // this is really just an edge case
    while( term instanceof IRLetted || term instanceof IRHoisted )
    {
        // replace with value
        term = term instanceof IRLetted ? term.value : term.hoisted;

        // forget the parent; this is the new root
        term.parent = undefined;
    }
    
    if(
        term instanceof IRNative ||
        term instanceof IRConst // while we are at it
    ) return term.toUPLC();

    ///////////////////////////////////////////////////////////////////////////////
    // ------------------------------------------------------------------------- //
    // ------------------------------- hoisting -------------------------------- //
    // ------------------------------------------------------------------------- //
    ///////////////////////////////////////////////////////////////////////////////

    // hoist `(force (builtin ifThenElse))` or `(force (force (builtin fstPair)))` etc
    replaceForcedNativesWithHoisted( term );

    // debugAsserts && _debug_assertions( term );

    if( options.delayHoists ) replaceHoistedWithLetted( term );
    else replaceClosedLettedWithHoisted( term );

    // debugAsserts && _debug_assertions( term );

    // if(
    //     // debugAsserts
    //     && options.delayHoists
    //     && includesNode( term, node => node instanceof IRHoisted )
    // ) {
    //     throw new Error("debug assertion failed: hoisted nodes found while delayHoists is true");
    // }

    // handle letted before hoisted because the tree is smaller
    // and we also have less letted dependecies to handle
    term = handleLettedAndReturnRoot( term );

    // debugAsserts && _debug_assertions( term );

    term = handleHoistedAndReturnRoot( term );

    // debugAsserts && _debug_assertions( term );

    // replaced hoisted terms might include new letted terms.
    //
    // ALSO: handling letted/hoisted terms can re-materialize custom
    // (negative-tag) IRNatives from cached/cloned values that the earlier
    // `replaceNativesAndReturnRoot` sweeps never saw (this shows up in
    // contracts with enough methods for bodies to be shared — the natives
    // then survive to the forcing pass and crash with
    // "getNRequiredForces ... input was: -<tag>"). Lower them here too;
    // `nativeToIR` introduces fresh IRHoisted wrappers, so the loop keeps
    // draining until natives, letted and hoisted are ALL gone.
    while(
        includesNode(
            term,
            node =>
                node instanceof IRLetted
                || node instanceof IRHoisted
                || ( node instanceof IRNative && node.tag < 0 )
        )
    ) {
        term = replaceNativesAndReturnRoot( term );
        term = handleLettedAndReturnRoot( term );
        term = handleHoistedAndReturnRoot( term );
    }

    // second round-trip sweep: the letted/hoisted drain exposes
    // encoder/decoder adjacencies that were wrapped in letted/hoisted
    // nodes at the early sweep (constructions bound as letted values)
    term = eliminateDataRoundTripsAndReturnRoot( term );

    // debugAsserts && _debug_assertions( term );

    ///////////////////////////////////////////////////////////////////////////////
    // ------------------------------------------------------------------------- //
    // --------------------------- translate to UPLC --------------------------- //
    // ------------------------------------------------------------------------- //
    ///////////////////////////////////////////////////////////////////////////////

    // introduces new hoisted terms
    // however we cannot do this before
    // because in order to hanlde letted at the best
    // we need to know where the `IRRecursive` nodes are
    term = handleRootRecursiveTerm( term );
    // if( options.delayHoists ) replaceHoistedWithLetted( term );

    // handle new hoisted terms
    term = handleHoistedAndReturnRoot( term )

    // debugAsserts && _debug_assertions( term );

    // strictly necessary to check the options
    // otherwise forced natives where already hoisted
    // will be re-hosited; causeing uselsess evaluations
    if( !options.delayHoists ) term = hoistForcedNatives( term );

    // debugAsserts && _debug_assertions( term );

    // at this point we expect the IR to be translable 1:1 to UPLC

    // The loop is needed because after inlining some params, 
    // new params in outer (or sibling) functions can become 
    // single‑use; a single bottom‑up pass doesn’t 
    // “see” those future states.
    //
    // ALWAYS AT LEAST 1 ITERATION
    // const maxInlineIterations = Math.max( 3, 1 );
    // for(
    //     let somethingWasInlined = true,
    //         inlineIterations = 0;
    //     somethingWasInlined
    //     && inlineIterations < maxInlineIterations;
    //     inlineIterations++
    // ) {
    //     const inlineResult = inlineSingleUseAndReturnRoot( term );
    //     term = inlineResult.term;
    //     somethingWasInlined = inlineResult.somethingWasInlined;
    // }

    term = removeUnusedVarsAndReturnRoot( term );

    // After `handleLettedAndReturnRoot` lowers `IRLetted` into the
    // `IRApp(IRFunc([p], body), value)` shape, this is the first point
    // where the let-as-application pattern is syntactically visible.
    // Run the inliner here (NOT earlier, where lets are still IRLetted
    // nodes the inliner doesn't recognize). Single-use uses trapped
    // inside nested closures are skipped — see the pass for details.
    term = inlineSingleUseLetBindingsAndReturnRoot( term );
    // inlining brings encoders adjacent to their decoders: final sweep
    term = eliminateDataRoundTripsAndReturnRoot( term );
    term = removeUnusedVarsAndReturnRoot( term );

    term = performUplcOptimizationsAndReturnRoot( term, options );

    // the optimization passes can create fresh single-use bindings
    // (case-of-known-constr rewrites etc.) — inline them too
    term = inlineSingleUseLetBindingsAndReturnRoot( term );

    // Rewrite strictIfThenElse into IRCase-over-Const, and prune
    // trailing IRError continuations from any IRCase.
    term = rewriteToCaseOverConstAndReturnRoot( term );

    term = ensureProperlyForcedBuiltinsAndReturnRoot( term );


    if(
        options.addMarker &&
        options.targetUplcVersion.isV3Friendly()
    )
    {
        term = new IRCase(
            new IRConstr( 0, [] ),
            [
                term,
                // never evaluated
                IRConst.int( 42 )
            ]
        );
    }

    // let irJson = prettyIR( term );
    // console.log(
    //     "final IR before UPLC translation:\n",
    //     irJson.text,
    //     JSON.stringify( onlyHoistedAndLetted( irJson ) )
    // );

    // debugAsserts && _debug_assertions( term );

    // Debug aid: dump the final IR (pretty text, symbol descriptions) to
    // stderr between markers when PEBBLE_DUMP_FINAL_IR is set. Used by the
    // benchmark/optimization tooling in the-cardano-masterpiece.
    if( process.env.PEBBLE_DUMP_FINAL_IR ) {
        console.error( "===IR-DUMP-BEGIN===\n" + prettyIRText( term, 2 ) + "\n===IR-DUMP-END===" );
    }

    // const srcmap = {};
    const uplc = term.toUPLC( ToUplcCtx.root() );

    if( !isClosedTerm( uplc ) ) {
        console.error(
            prettyUPLC( uplc ),
        );
        throw new Error(
            "compileIRToUPLC: final UPLC term is not closed:\n" +
            "This is a compiler internal error; please open an issue on github so we can fix this."
        );
    }

    // console.log( "srcmap", srcmap );

    return uplc;
}

function _debug_assertions( term: IRTerm ): void
{
    _debug_assertClosedIR( term );
    _debug_assertNoDoubleVars( term );
}

function _debug_assertNoDoubleVars( term: IRTerm ): void
{
    const seen = new Set<symbol>();
    const stack: IRTerm[] = [ term ];
    let current: IRTerm = term;
    while( current = stack.pop()! )
    {
        if(
            current instanceof IRFunc
            || current instanceof IRRecursive
        ) {
            for( const p of current.params )
            {
                if( seen.has( p ) ) {
                    throw new Error("debug assertion failed: double variable detected");
                }
                seen.add( p );
            }
        }

        stack.push( ...current.children() );
    }
}