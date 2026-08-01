// ===========================================================================
//  Two-Party Escrow — end-to-end on PREPROD
// ===========================================================================
//  A. deposit -> refund BEFORE the deadline                   -> must FAIL
//     deposit -> accept BEFORE the deadline                   -> must SUCCEED
//  B. deposit -> accept AFTER the deadline                    -> must FAIL
//     deposit -> refund AFTER the deadline                    -> must SUCCEED
//  C. deposit -> settle signed by both parties                -> must SUCCEED
//
//  The buyer is the funded preprod key; the seller is a second wallet derived
//  deterministically from it and funded once, so `settle` really does need two
//  distinct signatures.
// ===========================================================================

import { TxOut, UTxO, Value } from "@harmoniclabs/buildooor";
import {
    loadCliKey, derivedWallet, utxosAt, lovelacesAt, txBuilder, submit, submittedTxs,
    chainNow, posixToSlot, slotToPosix, waitSlot, writeEvidence, awaitTx, sleep,
    type Wallet,
} from "../../_shared/preprod.ts";
import { escrow, buildDeposit, buildAccept, buildRefund, buildSettle, type EscrowParams } from "./escrow.ts";

const ADA = 1_000_000n;
const PRICE = 75n * ADA;                   // the CAPE scenario's price
const SELLER_FLOAT = 60n * ADA;            // enough for fees + collateral

// `value.toJson()` is an OBJECT keyed by policy id (`{"":{"":"lovelaces"}}`),
// so count its keys — it has no `.length`.
const isPlain = (u: UTxO): boolean =>
    !u.resolved.datum && !u.resolved.refScript &&
    Object.keys(u.resolved.value.toJson() as Record<string, unknown>).length === 1;

const plain = async (w: Wallet, n = 5): Promise<UTxO[]> =>
    (await utxosAt(w.address)).filter(isPlain).slice(0, n);

/** returns the human-readable LABEL (not the raw error) for the evidence file */
async function mustFail(label: string, build: () => Promise<unknown>): Promise<string> {
    try { await build(); }
    catch (e) {
        console.log(`   ${label}: rejected — ${String((e as Error).message).split("\n")[0].slice(0, 90)}`);
        return label;
    }
    throw new Error(`${label}: expected rejection but the transaction built`);
}

async function main() {
    const buyer = loadCliKey("preprod");
    const seller = await derivedWallet(buyer, "escrow-seller");
    const params: EscrowParams = { buyer: buyer.pkh, seller: seller.pkh, price: PRICE };
    const c = escrow(params);

    console.log("Two-Party Escrow — PREPROD");
    console.log("  script hash :", c.hash.toString());
    console.log("  address     :", c.address.toString());
    console.log("  buyer       :", buyer.pkh.toString());
    console.log("  seller      :", seller.pkh.toString());
    console.log("  seller addr :", seller.address.toString());

    // ---- 0. make sure the seller can pay its own fees ---------------------
    if (await lovelacesAt(seller.address) < 30n * ADA) {
        console.log(`\n0. funding the seller with ${SELLER_FLOAT / ADA} ADA`);
        await submit({
            inputs: (await plain(buyer)).map((utxo) => ({ utxo })),
            outputs: [new TxOut({ address: seller.address, value: Value.lovelaces(SELLER_FLOAT) })],
            changeAddress: buyer.address,
        }, [buyer], "seller-funding");
    }
    console.log(`   seller balance: ${(Number(await lovelacesAt(seller.address)) / 1e6).toFixed(2)} ADA`);

    const deposit = async (label: string, deadlineMs: bigint): Promise<UTxO> => {
        const h = await submit(
            buildDeposit(c, buyer, await plain(buyer), PRICE + 5n * ADA, deadlineMs),
            [buyer], label
        );
        return (await utxosAt(c.address)).find((u) => u.utxoRef.id.toString() === h)!;
    };

    const rejections: string[] = [];

    // =======================================================================
    //  A. accept before the deadline
    // =======================================================================
    console.log("\nA. accept before the deadline");
    let now = await chainNow();
    const deadlineA = BigInt(now.posixMs) + 20n * 60n * 1000n;      // 20 min out
    const utxoA = await deposit("escrow-A-deposit", deadlineA);
    console.log(`   deposited ${utxoA.utxoRef.toString()}`);

    now = await chainNow();
    rejections.push(await mustFail("early refund", async () => (await txBuilder()).build(
        buildRefund(c, buyer, await plain(buyer), utxoA, now.slot - 60, now.slot + 600)
    )));

    now = await chainNow();
    await submit(
        buildAccept(c, seller, await plain(seller), utxoA, PRICE,
            now.slot - 60, Math.min(now.slot + 600, await posixToSlot(Number(deadlineA)))),
        [seller], "escrow-A-accept"
    );
    console.log("   accepted — seller paid, payment tagged with the escrow's TxOutRef");

    // =======================================================================
    //  B. refund after the deadline
    // =======================================================================
    console.log("\nB. refund after the deadline");
    now = await chainNow();
    const deadlineB = BigInt(now.posixMs) + 5n * 60n * 1000n;       // 5 min out
    const utxoB = await deposit("escrow-B-deposit", deadlineB);

    const refundLower = (await posixToSlot(Number(deadlineB))) + 10;
    console.log(`   waiting for the deadline to pass (slot ${refundLower})...`);
    const past = await waitSlot(refundLower + 30);

    rejections.push(await mustFail("late accept", async () => (await txBuilder()).build(
        buildAccept(c, seller, await plain(seller), utxoB, PRICE, refundLower, past + 600)
    )));

    await submit(
        buildRefund(c, buyer, await plain(buyer), utxoB, refundLower, past + 600),
        [buyer], "escrow-B-refund"
    );
    console.log("   refunded to the buyer");

    // =======================================================================
    //  C. mutual settlement
    // =======================================================================
    console.log("\nC. settle with both signatures");
    now = await chainNow();
    const utxoC = await deposit("escrow-C-deposit", BigInt(now.posixMs) + 60n * 60n * 1000n);

    const half = utxoC.resolved.value.lovelaces / 2n;
    await submit(
        buildSettle(c, buyer, seller, await plain(buyer), utxoC, [
            new TxOut({ address: buyer.address, value: Value.lovelaces(half) }),
            new TxOut({ address: seller.address, value: Value.lovelaces(half) }),
        ]),
        [buyer, seller], "escrow-C-settle"
    );
    console.log("   settled 50/50");

    // all three escrows consumed?
    const mine = [utxoA, utxoB, utxoC].map((u) => u.utxoRef.toString());
    let allGone = false;
    for (let i = 0; i < 30; i++) {
        const here = new Set((await utxosAt(c.address)).map((u) => u.utxoRef.toString()));
        if (!mine.some((r) => here.has(r))) { allGone = true; break; }
        await sleep(10_000);
    }
    console.log(`\n   all three escrows consumed: ${allGone ? "yes" : "NO"}`);
    if (!allGone) throw new Error("some escrow utxos were not consumed");

    writeEvidence("two-party-escrow.json", {
        network: "preprod",
        contract: "two-party-escrow",
        compiler: "@harmoniclabs/pebble@0.4.3",
        scriptHash: c.hash.toString(),
        scriptAddress: c.address.toString(),
        params: {
            buyerPkh: buyer.pkh.toString(),
            sellerPkh: seller.pkh.toString(),
            priceLovelace: Number(PRICE),
        },
        negativeTestsRejected: rejections,
        transactions: submittedTxs().map((t) => ({
            ...t,
            explorer: `https://preprod.cardanoscan.io/transaction/${t.hash}`,
        })),
    });

    console.log("\nTwo-Party Escrow PREPROD: PASS");
}

main().catch((e) => { console.error("\nFAILED:", e); process.exit(1); });
