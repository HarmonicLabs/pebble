/**
 * Deterministic work counters for the backend.
 *
 * Compile TIME is machine-dependent and useless as a regression gate, but
 * the amount of WORK the pipeline performs for a given input is fully
 * deterministic: same source in, same counts out, on any machine. These
 * counters exist so tests can assert the pipeline does not silently acquire
 * super-linear behaviour (see `compiler.compileWorkBounds.test.ts`).
 *
 * Incrementing an integer per node visit is far below the noise floor of the
 * work being counted, so this is always on rather than env-gated — a gate
 * would mean the numbers tests assert on are not the numbers production runs.
 */
export const compileWork = {
    /** nodes taken off a rewrite pass's worklist */
    nodeVisits: 0,
    /** items appended to a rewrite pass's worklist */
    worklistPushes: 0,
    /** full-tree walks performed by the letted-placement pass */
    placementScans: 0,
    reset(): void {
        this.nodeVisits = 0;
        this.worklistPushes = 0;
        this.placementScans = 0;
    },
    snapshot(): { nodeVisits: number, worklistPushes: number, placementScans: number } {
        return {
            nodeVisits: this.nodeVisits,
            worklistPushes: this.worklistPushes,
            placementScans: this.placementScans,
        };
    },
};
