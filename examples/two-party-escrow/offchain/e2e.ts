// ===========================================================================
//  Two-Party Escrow — end-to-end against a local devnet
// ===========================================================================
//  Exercises every endpoint plus the two time guards:
//
//    A. deposit -> refund BEFORE the deadline                 -> must FAIL
//       deposit -> accept BEFORE the deadline                 -> must SUCCEED
//    B. deposit -> accept AFTER the deadline                  -> must FAIL
//       deposit -> refund AFTER the deadline                  -> must SUCCEED
//    C. deposit -> settle signed by both parties              -> must SUCCEED
//
//  Times come from the CHAIN's slot, never from wall clock.
// ===========================================================================

import { TxOut, Value } from "@harmoniclabs/buildooor";
import {
    ensureWallet, ensureFunded, queryUtxos, queryTip, txBuilder,
    signSubmitAwait, awaitTxAtAddr, slotToPosix, posixToSlot, sleep,
} from "../../_shared/devnet.ts";
import {
    escrow, buildDeposit, buildAccept, buildRefund, buildSettle,
    type EscrowParams,
} from "./escrow.ts";

const ADA = 1_000_000n;
const PRICE = 75n * ADA;          // the CAPE scenario's price

function awaitSlot(target: number): number {
    for (;;) {
        const { slot } = queryTip();
        if (slot >= target) return slot;
        sleep(500);
    }
}

async function mustFail(label: string, build: () => Promise<unknown>): Promise<void> {
    let rejected = false;
    try { await build(); }
    catch (e) {
        rejected = true;
        console.log(`   ${label}: rejected as expected — ${String((e as Error).message).split("\n")[0].slice(0, 90)}`);
    }
    if (!rejected) throw new Error(`${label}: expected rejection but the tx built successfully`);
}

async function main() {
    const buyer = ensureWallet("escrow-buyer");
    const seller = ensureWallet("escrow-seller");
    ensureFunded(buyer);
    ensureFunded(seller);

    const params: EscrowParams = { buyer: buyer.pkh, seller: seller.pkh, price: PRICE };
    const c = escrow(params);

    console.log("Two-Party Escrow");
    console.log("  script hash :", c.hash.toString());
    console.log("  address     :", c.address.toString());
    console.log("  buyer       :", buyer.pkh.toString());
    console.log("  seller      :", seller.pkh.toString());
    console.log(`  price       : ${PRICE / ADA} ADA`);

    const deposit = async (label: string, deadlineMs: bigint) => {
        const h = await signSubmitAwait(
            buildDeposit(c, buyer, queryUtxos(buyer.address), PRICE + 5n * ADA, deadlineMs),
            [buyer], label, c.address
        );
        const utxos = awaitTxAtAddr(c.address, h);
        return utxos.find((u) => u.utxoRef.id.toString() === h)!;
    };

    // =======================================================================
    //  A. accept before the deadline (and refund must not work yet)
    // =======================================================================
    console.log("\nA. accept before the deadline");
    let tip = queryTip().slot;
    const deadlineA = BigInt(slotToPosix(tip)) + 60_000n;      // 60s of chain time
    const utxoA = await deposit("escrow-deposit-A", deadlineA);
    console.log(`   deposited at ${utxoA.utxoRef.toString()}`);

    tip = queryTip().slot;
    await mustFail("early refund", () => txBuilder().build(
        buildRefund(c, buyer, queryUtxos(buyer.address), utxoA, tip - 20, tip + 200)
    ));

    tip = queryTip().slot;
    const acceptHash = await signSubmitAwait(
        // upper bound must sit at or before the deadline
        buildAccept(c, seller, queryUtxos(seller.address), utxoA, PRICE,
            tip - 20, Math.min(tip + 200, posixToSlot(Number(deadlineA)))),
        [seller], "escrow-accept"
    );
    console.log(`   accepted: ${acceptHash}`);
    awaitTxAtAddr(seller.address, acceptHash);
    console.log("   seller paid, payment tagged with the escrow's own TxOutRef");

    // =======================================================================
    //  B. refund after the deadline (and accept must no longer work)
    // =======================================================================
    console.log("\nB. refund after the deadline");
    tip = queryTip().slot;
    const deadlineB = BigInt(slotToPosix(tip)) + 30_000n;      // 30s of chain time
    const utxoB = await deposit("escrow-deposit-B", deadlineB);

    // `refund` requires the lower bound to be STRICTLY past the deadline, so
    // derive it from the deadline rather than from the tip — a bound that
    // lands exactly on the deadline is rejected.
    const refundLower = posixToSlot(Number(deadlineB)) + 10;
    console.log(`   waiting for the deadline to pass (slot ${refundLower})...`);
    tip = awaitSlot(refundLower + 20);

    await mustFail("late accept", () => txBuilder().build(
        buildAccept(c, seller, queryUtxos(seller.address), utxoB, PRICE, refundLower, tip + 200)
    ));

    const refundHash = await signSubmitAwait(
        buildRefund(c, buyer, queryUtxos(buyer.address), utxoB, refundLower, tip + 200),
        [buyer], "escrow-refund"
    );
    console.log(`   refunded: ${refundHash}`);
    awaitTxAtAddr(buyer.address, refundHash);

    // =======================================================================
    //  C. mutual settlement, any time, any split
    // =======================================================================
    console.log("\nC. settle with both signatures");
    tip = queryTip().slot;
    const deadlineC = BigInt(slotToPosix(tip)) + 600_000n;     // far away
    const utxoC = await deposit("escrow-deposit-C", deadlineC);

    const half = utxoC.resolved.value.lovelaces / 2n;
    const settleHash = await signSubmitAwait(
        buildSettle(c, buyer, seller, queryUtxos(buyer.address), utxoC, [
            new TxOut({ address: buyer.address, value: Value.lovelaces(half) }),
            new TxOut({ address: seller.address, value: Value.lovelaces(half) }),
        ]),
        [buyer, seller], "escrow-settle"
    );
    console.log(`   settled 50/50: ${settleHash}`);

    // Check THIS run's three escrows are gone. The address may still hold
    // UTxOs from other runs — a devnet is shared, so an "address is empty"
    // check would be flaky.
    const mine = [utxoA, utxoB, utxoC].map((u) => u.utxoRef.toString());
    let allGone = false;
    for (let i = 0; i < 60; i++) {
        const here = new Set(queryUtxos(c.address).map((u) => u.utxoRef.toString()));
        if (!mine.some((r) => here.has(r))) { allGone = true; break; }
        sleep(1000);
    }
    console.log(`\n   all three escrows consumed: ${allGone ? "yes" : "NO"}`);
    if (!allGone) throw new Error("some escrow utxos were not consumed");

    console.log("\nTwo-Party Escrow e2e: PASS");
}

main().catch((e) => { console.error("\nFAILED:", e); process.exit(1); });
