// ===========================================================================
//  Linear Vesting — end-to-end against a local devnet
// ===========================================================================
//  1. lock 100 ADA vesting linearly over a 60s (chain-time) window
//  2. part-way through, claim less than has vested            -> must SUCCEED
//  3. in the same window, try to claim more than has vested    -> must FAIL
//  4. after the window closes, claim the entire remainder      -> must SUCCEED
//
//  Times are derived from the CHAIN's slot, never from wall clock: a devnet's
//  chain time runs independently of the host's, and validity intervals are
//  checked against slots.
// ===========================================================================

import { Value } from "@harmoniclabs/buildooor";
import {
    ensureWallet, ensureFunded, queryUtxos, queryTip, txBuilder,
    signSubmitAwait, awaitTxAtAddr, slotToPosix, posixToSlot, sleep,
} from "../../_shared/devnet.ts";
import {
    vesting, vestingDatum, buildLock, buildClaim, vestedAt, claimableAt,
    type Schedule,
} from "./vesting.ts";

const ADA = 1_000_000n;

function awaitSlot(target: number): number {
    for (;;) {
        const { slot } = queryTip();
        if (slot >= target) return slot;
        sleep(500);
    }
}

const lovelacesAt = (addr: Parameters<typeof queryUtxos>[0]): bigint =>
    queryUtxos(addr).reduce((a, u) => a + u.resolved.value.lovelaces, 0n);

async function main() {
    const c = vesting();
    console.log("Linear Vesting");
    console.log("  script hash :", c.hash.toString());
    console.log("  address     :", c.address.toString());

    const depositor = ensureWallet("vesting-depositor");
    const beneficiary = ensureWallet("vesting-beneficiary");
    ensureFunded(depositor);
    ensureFunded(beneficiary);
    console.log("  beneficiary :", beneficiary.address.toString());

    // ---- 1. lock ----------------------------------------------------------
    const tip0 = queryTip();
    const startMs = BigInt(slotToPosix(tip0.slot));
    const WINDOW = 60_000n;                       // 60s of chain time
    const schedule: Schedule = {
        beneficiary: beneficiary.pkh,
        start: startMs,
        end: startMs + WINDOW,
        total: 100n * ADA,
        claimed: 0n,
    };

    console.log(`\n1. locking ${schedule.total / ADA} ADA, vesting over ${WINDOW / 1000n}s of chain time`);
    const lockHash = await signSubmitAwait(
        buildLock(c, depositor, queryUtxos(depositor.address), schedule),
        [depositor], "vesting-lock", c.address
    );
    let scriptUtxos = awaitTxAtAddr(c.address, lockHash);
    let vUtxo = scriptUtxos.find((u) => u.utxoRef.id.toString() === lockHash)!;
    console.log(`   locked at ${vUtxo.utxoRef.toString()}`);

    // ---- 2. partial claim, strictly under what has vested -----------------
    // wait until ~60% of the window has elapsed on chain
    const sixtyPctSlot = posixToSlot(Number(startMs + (WINDOW * 60n) / 100n));
    console.log(`\n2. waiting for 60% of the window (slot ${sixtyPctSlot})...`);
    const nowSlot = awaitSlot(sixtyPctSlot);

    // the validity interval must be one the node accepts *and* one the script
    // is happy with: lower bound in the past, upper bound in the near future
    const lowerSlot = nowSlot - 20;
    const upperSlot = nowSlot + 200;
    const lowerMs = BigInt(slotToPosix(lowerSlot));

    const vestedThen = vestedAt(schedule, lowerMs);
    const claimable = claimableAt(schedule, lowerMs);
    const amount = (claimable * 80n) / 100n;      // leave headroom
    console.log(`   at lower bound: vested ${vestedThen / ADA} ADA, claimable ${claimable / ADA} ADA`);
    console.log(`   claiming ${amount / ADA} ADA`);

    const balBefore = lovelacesAt(beneficiary.address);
    const claimHash = await signSubmitAwait(
        buildClaim(c, beneficiary, queryUtxos(beneficiary.address), vUtxo, schedule, amount, lowerSlot, upperSlot),
        [beneficiary], "vesting-claim-1", c.address
    );
    scriptUtxos = awaitTxAtAddr(c.address, claimHash);
    vUtxo = scriptUtxos.find((u) => u.utxoRef.id.toString() === claimHash)!;

    const afterFirst: Schedule = { ...schedule, claimed: schedule.claimed + amount };
    const contDatumOk =
        JSON.stringify(vUtxo.resolved.datum?.toJson()) === JSON.stringify(vestingDatum(afterFirst).toJson());
    console.log(`   continuation datum carries claimed=${afterFirst.claimed / ADA} ADA : ${contDatumOk ? "OK" : "MISMATCH"}`);
    if (!contDatumOk) throw new Error("continuation datum mismatch");
    console.log(`   remaining locked: ${vUtxo.resolved.value.lovelaces / ADA} ADA`);
    console.log(`   beneficiary gained ~${(lovelacesAt(beneficiary.address) - balBefore) / ADA} ADA (minus fees)`);

    // ---- 3. NEGATIVE: claim more than has vested --------------------------
    console.log("\n3. attempting to over-claim (must be rejected)");
    const tipNow = queryTip().slot;
    const badLower = tipNow - 20;
    const badClaimable = claimableAt(afterFirst, BigInt(slotToPosix(badLower)));
    const badAmount = badClaimable + 20n * ADA;   // well past what has vested
    let rejected = false;
    try {
        await txBuilder().build(
            buildClaim(c, beneficiary, queryUtxos(beneficiary.address), vUtxo, afterFirst,
                badAmount, badLower, tipNow + 200)
        );
    } catch (e) {
        rejected = true;
        console.log(`   rejected as expected: ${String((e as Error).message).split("\n")[0].slice(0, 100)}`);
    }
    if (!rejected) throw new Error("over-claim was NOT rejected — validator is broken");

    // ---- 4. final claim after the window closes ---------------------------
    const endSlot = posixToSlot(Number(schedule.end));
    console.log(`\n4. waiting for the window to close (slot ${endSlot})...`);
    const afterEnd = awaitSlot(endSlot + 60);

    // the lower bound must sit PAST `end`, otherwise the script still sees a
    // partially-vested schedule and the full remainder is not yet claimable
    const finalLower = endSlot + 5;
    const rest = vUtxo.resolved.value.lovelaces;
    console.log(`   claiming the full remainder: ${rest / ADA} ADA`);
    const finalHash = await signSubmitAwait(
        buildClaim(c, beneficiary, queryUtxos(beneficiary.address), vUtxo, afterFirst,
            rest, finalLower, afterEnd + 200),
        [beneficiary], "vesting-claim-final"
    );
    console.log(`   ${finalHash}`);

    // The schedule is exhausted when THIS run's vesting UTxO is gone. The
    // address itself may still hold UTxOs from other runs — a devnet is
    // shared, so an "address is empty" check would be flaky.
    const spentRef = vUtxo.utxoRef.toString();
    let gone = false;
    for (let i = 0; i < 60; i++) {
        if (!queryUtxos(c.address).some((u) => u.utxoRef.toString() === spentRef)) { gone = true; break; }
        sleep(1000);
    }
    console.log(`   vesting utxo ${spentRef} consumed: ${gone ? "yes" : "NO"}`);
    if (!gone) throw new Error("the vesting utxo was not consumed");

    console.log("\nLinear Vesting e2e: PASS");
}

main().catch((e) => { console.error("\nFAILED:", e); process.exit(1); });
