// ===========================================================================
//  Linear Vesting — end-to-end on PREPROD
// ===========================================================================
//  Same flow as the devnet e2e, against the public preprod network:
//    1. lock 100 ADA vesting linearly over a window
//    2. part-way through, claim less than has vested          -> must SUCCEED
//    3. in the same window, claim more than has vested        -> must FAIL
//    4. after the window closes, claim the entire remainder   -> must SUCCEED
//
//  Transaction hashes are written to examples/onchain-evidence/.
// ===========================================================================

import { TxOut, UTxO, Value } from "@harmoniclabs/buildooor";
import {
    loadCliKey, utxosAt, lovelacesAt, txBuilder, submit, submittedTxs,
    chainNow, posixToSlot, slotToPosix, waitSlot, writeEvidence, sleep,
} from "../../_shared/preprod.ts";
import { vesting, vestingDatum, buildLock, buildClaim, vestedAt, claimableAt, type Schedule } from "./vesting.ts";

const ADA = 1_000_000n;
const WINDOW_MS = 8n * 60n * 1000n;        // 8 minutes of chain time
const LOCK = 100n * ADA;

/**
 * A pure-ADA utxo with no datum and no reference script — safe as an input and
 * as collateral. `value.toJson()` is an OBJECT keyed by policy id
 * (`{"":{"":"lovelaces"}}`), so count its keys; it has no `.length`.
 */
const isPlain = (u: UTxO): boolean =>
    !u.resolved.datum && !u.resolved.refScript &&
    Object.keys(u.resolved.value.toJson() as Record<string, unknown>).length === 1;

async function main() {
    const c = vesting();
    const w = loadCliKey("preprod");

    console.log("Linear Vesting — PREPROD");
    console.log("  script hash :", c.hash.toString());
    console.log("  address     :", c.address.toString());
    console.log("  wallet      :", w.address.toString());
    console.log("  balance     :", (Number(await lovelacesAt(w.address)) / 1e6).toFixed(2), "ADA");

    // ---- 1. lock ----------------------------------------------------------
    const t0 = await chainNow();
    const schedule: Schedule = {
        beneficiary: w.pkh,
        start: BigInt(t0.posixMs),
        end: BigInt(t0.posixMs) + WINDOW_MS,
        total: LOCK,
        claimed: 0n,
    };
    console.log(`\n1. locking ${LOCK / ADA} ADA, vesting over ${WINDOW_MS / 1000n}s`);
    console.log(`   start ${new Date(Number(schedule.start)).toISOString()}  end ${new Date(Number(schedule.end)).toISOString()}`);

    const lockHash = await submit(
        buildLock(c, w, (await utxosAt(w.address)).filter(isPlain).slice(0, 5), schedule),
        [w], "vesting-lock"
    );

    let vUtxo = (await utxosAt(c.address)).find((u) => u.utxoRef.id.toString() === lockHash)!;
    console.log(`   locked at ${vUtxo.utxoRef.toString()}`);

    // ---- 2. partial claim -------------------------------------------------
    const sixtyPct = Number(schedule.start + (WINDOW_MS * 60n) / 100n);
    const sixtySlot = await posixToSlot(sixtyPct);
    console.log(`\n2. waiting for 60% of the window (slot ${sixtySlot})...`);
    const nowSlot = await waitSlot(sixtySlot);

    const lowerSlot = nowSlot - 60;
    const upperSlot = nowSlot + 600;
    const lowerMs = BigInt(await slotToPosix(lowerSlot));
    const claimable = claimableAt(schedule, lowerMs);
    const amount = (claimable * 80n) / 100n;
    console.log(`   vested ${vestedAt(schedule, lowerMs) / ADA} ADA, claimable ${claimable / ADA} ADA -> claiming ${amount / ADA} ADA`);

    const claimHash = await submit(
        buildClaim(c, w, (await utxosAt(w.address)).filter(isPlain).slice(0, 5),
            vUtxo, schedule, amount, lowerSlot, upperSlot),
        [w], "vesting-claim-partial"
    );

    vUtxo = (await utxosAt(c.address)).find((u) => u.utxoRef.id.toString() === claimHash)!;
    const afterFirst: Schedule = { ...schedule, claimed: schedule.claimed + amount };
    const datumOk = JSON.stringify(vUtxo.resolved.datum?.toJson())
        === JSON.stringify(vestingDatum(afterFirst).toJson());
    console.log(`   continuation datum claimed=${afterFirst.claimed / ADA} ADA : ${datumOk ? "OK" : "MISMATCH"}`);
    if (!datumOk) throw new Error("continuation datum mismatch");
    console.log(`   remaining locked: ${vUtxo.resolved.value.lovelaces / ADA} ADA`);

    // ---- 3. NEGATIVE: over-claim (rejected before it ever reaches chain) ---
    console.log("\n3. attempting to over-claim (must be rejected)");
    const nSlot = (await chainNow()).slot;
    const badAmount = claimableAt(afterFirst, BigInt(await slotToPosix(nSlot - 60))) + 20n * ADA;
    let rejected = false;
    try {
        await (await txBuilder()).build(
            buildClaim(c, w, (await utxosAt(w.address)).filter(isPlain).slice(0, 5),
                vUtxo, afterFirst, badAmount, nSlot - 60, nSlot + 600)
        );
    } catch (e) {
        rejected = true;
        console.log(`   rejected: ${String((e as Error).message).split("\n")[0].slice(0, 90)}`);
    }
    if (!rejected) throw new Error("over-claim was NOT rejected");

    // ---- 4. final claim ---------------------------------------------------
    const endSlot = await posixToSlot(Number(schedule.end));
    console.log(`\n4. waiting for the window to close (slot ${endSlot})...`);
    const afterEnd = await waitSlot(endSlot + 30);

    const rest = vUtxo.resolved.value.lovelaces;
    console.log(`   claiming the remainder: ${rest / ADA} ADA`);
    const finalHash = await submit(
        buildClaim(c, w, (await utxosAt(w.address)).filter(isPlain).slice(0, 5),
            vUtxo, afterFirst, rest, endSlot + 5, afterEnd + 600),
        [w], "vesting-claim-final"
    );

    const spentRef = vUtxo.utxoRef.toString();
    let gone = false;
    for (let i = 0; i < 30; i++) {
        if (!(await utxosAt(c.address)).some((u) => u.utxoRef.toString() === spentRef)) { gone = true; break; }
        await sleep(10_000);
    }
    console.log(`   vesting utxo consumed: ${gone ? "yes" : "NO"}`);
    if (!gone) throw new Error("vesting utxo not consumed");

    writeEvidence("linear-vesting.json", {
        network: "preprod",
        contract: "linear-vesting",
        compiler: "@harmoniclabs/pebble@0.4.3",
        scriptHash: c.hash.toString(),
        scriptAddress: c.address.toString(),
        beneficiary: w.pkh.toString(),
        schedule: {
            startPosixMs: Number(schedule.start),
            endPosixMs: Number(schedule.end),
            totalLovelace: Number(schedule.total),
        },
        negativeTestsRejected: ["over-claim beyond vested amount"],
        transactions: submittedTxs().map((t) => ({
            ...t,
            explorer: `https://preprod.cardanoscan.io/transaction/${t.hash}`,
        })),
    });

    console.log("\nLinear Vesting PREPROD: PASS");
}

main().catch((e) => { console.error("\nFAILED:", e); process.exit(1); });
