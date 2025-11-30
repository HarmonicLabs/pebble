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
import { handleRootRecursiveTerm } from "./subRoutines/handleRecursiveTerms";
import { CompilerOptions, completeCompilerOptions, defaultOptions } from "./CompilerOptions";
import { replaceHoistedWithLetted } from "./subRoutines/replaceHoistedWithLetted";
import { IRApp, IRCase, IRConstr, IRFunc, IRNative, IRVar } from "../IRNodes";
import { replaceForcedNativesWithHoisted } from "./subRoutines/replaceForcedNativesWithHoisted";
import { performUplcOptimizationsAndReturnRoot } from "./subRoutines/performUplcOptimizationsAndReturnRoot/performUplcOptimizationsAndReturnRoot";
import { rewriteNativesAppliedToConstantsAndReturnRoot } from "./subRoutines/rewriteNativesAppliedToConstantsAndReturnRoot";
import { _debug_assertClosedIR, onlyHoistedAndLetted, prettyIR, prettyIRJsonStr } from "../utils";
import { ToUplcCtx } from "./ctx/ToUplcCtx";
import { removeUnusedVarsAndReturnRoot } from "./subRoutines/removeUnusedVarsAndReturnRoot/removeUnusedVarsAndReturnRoot";
import { IRRecursive } from "../IRNodes/IRRecursive";

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
    // debugAsserts && _debug_assertions( term );

    // removing unused variables BEFORE going into the rest of the compilation
    // helps letted terms to find a better spot (and possibly be inlined instead of hoisted)
    term = removeUnusedVarsAndReturnRoot( term );
    // debugAsserts && _debug_assertions( term );

    _makeAllNegativeNativesHoisted( term );

    term = replaceNativesAndReturnRoot( term );
    // re-call rewrite to optimize introduced hoisted
    term = rewriteNativesAppliedToConstantsAndReturnRoot( term );

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

    // replaced hoisted terms might include new letted terms
    while(
        includesNode(
            term,
            node => 
                node instanceof IRLetted
                || node instanceof IRHoisted
        )
    ) {
        term = handleLettedAndReturnRoot( term );
        term = handleHoistedAndReturnRoot( term );
    }

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
    term = performUplcOptimizationsAndReturnRoot( term, options );

    if(
        options.addMarker &&
        options.targetUplcVersion.major >= 1 &&
        options.targetUplcVersion.minor >= 1 &&
        options.targetUplcVersion.patch >= 0
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