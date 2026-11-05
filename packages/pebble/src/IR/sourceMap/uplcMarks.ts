import { Application, Case, Constr, Delay, Force, Lambda, UPLCTerm } from "@harmoniclabs/uplc";
import type { SourceRange } from "../../ast/Source/SourceRange";
import type { BaseIRMetadata, IRFnEntryMeta, IRTracePoint } from "../IRNodes/BaseIRMetadata";
import type { DebugBinding, DebugFunction } from "../../compiler/debug/DebugInfo";
import { unionBindings } from "./unionBindings";

/** source information of one UPLC term, taken from the IR node that created it */
export interface UplcMark {
    range: SourceRange | null | undefined
    fnEntry?: IRFnEntryMeta | null
    assertCond?: SourceRange | null
    /** with `assertCond`: the term computes the condition negated (see `BaseIRMetadata`) */
    assertNegated?: true
    /** a case with no branch for some values: the failure that stands for */
    failRange?: SourceRange | null
    /** debug information: variables whose value the term computes */
    varValue?: readonly DebugBinding[]
    /** debug information: the term starts an iteration of this loop */
    loopEntry?: DebugFunction | null
    /** debug information: uses of a variable the term was copied in place of */
    useRanges?: readonly SourceRange[]
    /** traces the compiler removed that would have run at the term, in the order they ran */
    tracePoints?: readonly IRTracePoint[]
}

export type UplcMarks = Map<UPLCTerm, UplcMark>;

/**
 * Records `meta` for the terms of `root` that are not in `marks` yet: the node's children
 * were converted (and recorded) first, so those are the ones the node itself created.
 * Markers go to the root term only.
 */
export function recordOwnTerms( root: UPLCTerm, meta: BaseIRMetadata, marks: UplcMarks ): void
{
    const rootMark = marks.get( root );
    if( rootMark !== undefined )
    {
        // the node created no term of its own (e.g. a function without parameters)
        if( rootMark.fnEntry === undefined && meta.fnEntry !== undefined ) rootMark.fnEntry = meta.fnEntry;
        if( rootMark.assertCond === undefined && meta.assertCond !== undefined )
        {
            rootMark.assertCond = meta.assertCond;
            if( meta.assertNegated ) rootMark.assertNegated = true;
        }
        if( rootMark.failRange === undefined && meta.failRange !== undefined ) rootMark.failRange = meta.failRange;
        if( meta.varValue !== undefined ) rootMark.varValue = unionBindings( rootMark.varValue, meta.varValue );
        if( rootMark.loopEntry === undefined && meta.loopEntry !== undefined ) rootMark.loopEntry = meta.loopEntry;
        if( meta.useRanges !== undefined ) rootMark.useRanges = ( rootMark.useRanges ?? [] ).concat( meta.useRanges );
        // the node encloses the one that made the term: its traces ran first
        if( meta.tracePoints ) rootMark.tracePoints = [ ...meta.tracePoints, ...( rootMark.tracePoints ?? [] ) ];
        return;
    }

    const mark: UplcMark = { range: meta.range, fnEntry: meta.fnEntry, assertCond: meta.assertCond };
    if( meta.assertNegated && meta.assertCond !== undefined ) mark.assertNegated = true;
    if( meta.failRange !== undefined ) mark.failRange = meta.failRange;
    if( meta.varValue !== undefined ) mark.varValue = meta.varValue;
    if( meta.loopEntry !== undefined ) mark.loopEntry = meta.loopEntry;
    if( meta.useRanges !== undefined ) mark.useRanges = meta.useRanges;
    if( meta.tracePoints ) mark.tracePoints = meta.tracePoints;
    marks.set( root, mark );
    const stack: UPLCTerm[] = uplcChildren( root ).slice();
    while( stack.length > 0 )
    {
        const t = stack.pop()!;
        if( marks.has( t ) ) continue;
        marks.set( t, { range: meta.range } );
        const children = uplcChildren( t );
        for( let i = 0; i < children.length; i++ ) stack.push( children[i] );
    }
}

function uplcChildren( t: UPLCTerm ): readonly UPLCTerm[]
{
    if( t instanceof Application ) return [ t.func, t.arg ];
    if( t instanceof Lambda ) return [ t.body ];
    if( t instanceof Delay ) return [ t.delayedTerm ];
    if( t instanceof Force ) return [ t.forced ];
    if( t instanceof Constr ) return t.terms;
    if( t instanceof Case ) return [ t.constrTerm, ...t.continuations ];
    return [];
}
