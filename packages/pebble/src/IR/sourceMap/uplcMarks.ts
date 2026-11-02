import { Application, Case, Constr, Delay, Force, Lambda, UPLCTerm } from "@harmoniclabs/uplc";
import type { SourceRange } from "../../ast/Source/SourceRange";
import type { BaseIRMetadata, IRFnEntryMeta } from "../IRNodes/BaseIRMetadata";

/** source information of one UPLC term, taken from the IR node that created it */
export interface UplcMark {
    range: SourceRange | null | undefined
    fnEntry?: IRFnEntryMeta | null
    assertCond?: SourceRange | null
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
        if( rootMark.assertCond === undefined && meta.assertCond !== undefined ) rootMark.assertCond = meta.assertCond;
        return;
    }

    marks.set( root, { range: meta.range, fnEntry: meta.fnEntry, assertCond: meta.assertCond } );
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
