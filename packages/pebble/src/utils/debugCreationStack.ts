/**
 * Capture the current stack trace — but ONLY when IR/TIR node
 * creation-stack debugging is explicitly enabled (env
 * `PEBBLE_DEBUG_IR_STACKS`).
 *
 * Several node constructors used to do `this._creationStack = new Error().stack`
 * UNCONDITIONALLY. `IRVar` is created thousands of times when compiling a real
 * contract, and under a source-map-aware runtime (ts-jest / tsx) every `.stack`
 * access pays the full source-map resolution cost — profiling the masterpiece
 * compile showed ~35% of the time spent in `source-map-support`, dwarfing the
 * actual compilation. The stacks are only ever read from a debug error path
 * (`_debug_assertClosedIR`), so gate the capture: off by default (a plain
 * `undefined`, essentially free), on when a developer wants it.
 */
const ENABLED = !!process.env.PEBBLE_DEBUG_IR_STACKS;

export function debugCreationStack(): string | undefined
{
    return ENABLED ? ( new Error() ).stack : undefined;
}
