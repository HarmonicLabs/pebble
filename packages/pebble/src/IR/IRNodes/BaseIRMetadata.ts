import type { SourceRange } from "../../ast/Source/SourceRange";

/** marks the root of a function's body: evaluating that term enters the function */
export interface IRFnEntryMeta {
    /** `null` when functions with different names were merged into this one */
    name: string | null
    range: SourceRange
    /** for a body the optimizer copied in place of a call: that call */
    callRange?: SourceRange
}

export interface BaseIRMetadata {
    name?: string | undefined
    /**
     * source of this node, for sourcemaps;
     * `null` means deliberately none: the node stands for several source sites
     */
    range?: SourceRange | null
    /** set on the root of a user function's body */
    fnEntry?: IRFnEntryMeta | null
    /** set on the root of an assert condition: the range of the assert statement */
    assertCond?: SourceRange | null
}
