import type { SourceRange } from "../../ast/Source/SourceRange";
import type { DebugBinding, DebugFunction } from "../../compiler/debug/DebugInfo";

/** marks the root of a function's body: evaluating that term enters the function */
export interface IRFnEntryMeta {
    /** `null` when functions with different names were merged into this one */
    name: string | null
    range: SourceRange
    /** for a body the optimizer copied in place of a call: that call */
    callRange?: SourceRange
    /** the function, when debug information is collected */
    debugFn?: DebugFunction
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
    /**
     * set on a case whose branches that would fail were dropped (a missing branch fails just
     * the same): the failure it stands for when no branch matches (the assert, the match)
     */
    failRange?: SourceRange | null
    /**
     * debug information: the variables (bindings) whose value this node computes, such as a
     * `const` initializer the optimizer copied where the variable was used
     */
    varValue?: readonly DebugBinding[]
    /** debug information: set on the root of a loop body, evaluating it starts an iteration */
    loopEntry?: DebugFunction | null
    /**
     * debug information: the uses of a variable this node was copied in place of (an inlined
     * `const`): evaluating it evaluates them
     */
    useRanges?: readonly SourceRange[]
}
