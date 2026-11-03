// ===========================================================================
//  The debugger on real contracts: every refused case of the source map
//  goldens, saved by buildooor and replayed with `pebble debug --eval`.
//  The step the debugger marks as failed must be on the line the source map
//  reports, and every statement before it must have run in source order.
//
//    npm run golden:debugger        (after `npm run golden:sourcemap`)
//
//  PEBBLE_CLI overrides the command (default `npx pebble`).
// ===========================================================================

import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PEBBLE = process.env.PEBBLE_CLI ?? "npx pebble";
let failed = 0, total = 0;

for (const project of ["two-party-escrow", "linear-vesting"]) {
    const dir = mkdtempSync(join(tmpdir(), "pebble-failed-"));
    try {
        // the goldens print their own report; only the saved files matter here
        execSync("npx tsx offchain/sourcemap-golden.ts", { cwd: project, env: { ...process.env, SAVE_FAILED: dir }, stdio: "ignore" });
        for (const file of readdirSync(dir).sort()) {
            total++;
            const saved = JSON.parse(readFileSync(join(dir, file), "utf8"));
            const run = JSON.parse(execSync(`${PEBBLE} debug --eval ${join(dir, file)} --json`, { cwd: project, encoding: "utf8" }));
            const step = run.failedStep !== undefined ? run.steps[run.failedStep - 1] : undefined;
            const expected = saved.location?.line;
            const inOrder = run.steps
                .filter((s: any) => s.depth === 1)
                .every((s: any, i: number, all: any[]) => i === 0 || all[i - 1].line <= s.line || all[i - 1].function !== s.function);
            if (step !== undefined && step.line === expected && inOrder)
                console.log(`ok    ${project} ${file}: step ${run.failedStep} of ${run.steps.length}, line ${step.line}  ${step.source}`);
            else {
                failed++;
                console.log(`FAIL  ${project} ${file}: expected line ${expected}, got ${step ? `line ${step.line}` : "no failed step"}${inOrder ? "" : " (steps out of order)"}`);
            }
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

console.log(`\n${total - failed} of ${total} as expected`);
if (failed > 0 || total === 0) process.exit(1);
