// ===========================================================================
//  Source maps on a real contract: every way the escrow can refuse a
//  transaction, and the line buildooor reports for it. Local, no node:
//
//    npx pebble compile && npx tsx offchain/sourcemap-golden.ts
//
//  Each case breaks exactly one rule of one endpoint; the reported location
//  must be the statement enforcing that rule. Valid transactions for the
//  three endpoints are built first, so a failing case cannot pass by breaking
//  something else.
// ===========================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    Address, Credential, PrivateKey, TxBuilder, TxOut, TxOutRef, UTxO, Value, defaultProtocolParameters,
    type ITxBuildArgs,
} from "@harmoniclabs/buildooor";
import type { Wallet } from "../../_shared/devnet.ts";
import { FLAT, buildAccept, buildRefund, buildSettle, escrow, escrowDatum, txOutRefData } from "./escrow.ts";

function demoWallet(name: string, seed: number): Wallet {
    const prv = new PrivateKey(new Uint8Array(32).fill(seed));
    const pub = prv.derivePublicKey();
    return { name, prv, pub, pkh: pub.hash, address: Address.testnet(Credential.keyHash(pub.hash)) };
}

const SOURCE = readFileSync(join(FLAT, "..", "..", "src", "index.pebble"), "utf8").split("\n");

/** 1-based line of the first line containing `snippet` after the line containing `after` */
function lineOf(snippet: string, after: string): number {
    const start = SOURCE.findIndex((l) => l.includes(after));
    const idx = SOURCE.findIndex((l, i) => i > start && l.includes(snippet));
    if (start < 0 || idx < 0) throw new Error(`not in the source: ${after} ... ${snippet}`);
    return idx + 1;
}

const buyer = demoWallet("buyer", 1);
const seller = demoWallet("seller", 2);
const price = 10_000_000n;
const contract = escrow({ buyer: buyer.pkh, seller: seller.pkh, price });

// slot 0 at POSIX 0 and 1-second slots: a slot number is a POSIX time in seconds
const genesisInfos = { systemStartPosixMs: 0, slotLengthMs: 1000, startSlotNo: 0 };
const deadline = 1_000_000;

const escrowUtxo = (id: string) => new UTxO({
    utxoRef: { id: id.repeat(32), index: 0 },
    resolved: { address: contract.address, value: Value.lovelaces(price), datum: escrowDatum(BigInt(deadline) * 1000n) },
});
const walletUtxo = (w: Wallet, id: string) => new UTxO({
    utxoRef: { id: id.repeat(32), index: 0 },
    resolved: { address: w.address, value: Value.lovelaces(50_000_000n) },
});

let savedCases = 0;
const txBuilder = new TxBuilder(defaultProtocolParameters, genesisInfos, {
    sourceMaps: [readFileSync(FLAT + ".map", "utf8")],
    // SAVE_FAILED=<dir>: every refused case is saved there, one file each, for
    // `pebble debug --eval` (see debugger-golden.ts)
    saveFailedEvaluations: process.env.SAVE_FAILED === undefined ? undefined :
        (ev) => writeFileSync(join(process.env.SAVE_FAILED!, `case-${String(++savedCases).padStart(2, "0")}.json`), JSON.stringify(ev)),
});

// ---- the valid transactions the cases start from --------------------------

const escrowA = escrowUtxo("11");
const accept = (): ITxBuildArgs =>
    buildAccept(contract, seller, [walletUtxo(seller, "22")], escrowA, price, deadline - 100, deadline);
const refund = (): ITxBuildArgs =>
    buildRefund(contract, buyer, [walletUtxo(buyer, "33")], escrowA, deadline + 1, deadline + 100);
const settle = (): ITxBuildArgs =>
    buildSettle(contract, buyer, seller, [walletUtxo(buyer, "33")], escrowA, [
        new TxOut({ address: buyer.address, value: Value.lovelaces(4_000_000n) }),
        new TxOut({ address: seller.address, value: Value.lovelaces(6_000_000n) }),
    ]);

/** the accept transaction, its payment to the seller replaced */
const acceptPaying = (payment: TxOut): ITxBuildArgs => ({ ...accept(), outputs: [payment] });

// ---- the cases --------------------------------------------------------------

const cases: [name: string, args: () => ITxBuildArgs, endpoint: string, statement: string][] = [
    ["accept without the seller's signature", () => ({ ...accept(), requiredSigners: [buyer.pkh] }),
        "spend accept", "assert tx.requiredSigners.includes( sellerPkh );"],
    ["accept without an upper bound", () => ({ ...accept(), invalidAfter: undefined }),
        "spend accept", "const Finite{ n: txLatest } = tx.validityInterval.to.boundary;"],
    ["accept after the deadline", () => ({ ...accept(), invalidAfter: deadline + 1 }),
        "spend accept", "assert txLatest <= deadline;"],
    ["accept spending two escrows", () => {
        const args = accept();
        const second = escrowUtxo("44");
        return { ...args, inputs: [...args.inputs, { utxo: second, inputScript: args.inputs[0].inputScript }] };
    }, "spend accept", "assert tx.inputs.filter( i => i.resolved.address.payment == ownPaymentCreds ).length() == 1;"],
    // the change goes to the buyer too: no output pays the seller
    ["accept paying someone else", () => ({ ...acceptPaying(
        new TxOut({ address: buyer.address, value: Value.lovelaces(price), datum: txOutRefData(escrowA.utxoRef) })
    ), changeAddress: buyer.address }), "spend accept", "const Some{ value: payOut } = tx.outputs.find( o =>"],
    // with the change going to the seller, the change output is the payment found: it pays
    // enough but carries no tag
    ["accept paid only by the change", () => acceptPaying(
        new TxOut({ address: buyer.address, value: Value.lovelaces(price), datum: txOutRefData(escrowA.utxoRef) })
    ), "spend accept", "const InlineDatum{ datum: tagData } = payOut.datum;"],
    ["accept underpaying the seller", () => acceptPaying(
        new TxOut({ address: seller.address, value: Value.lovelaces(price - 1n), datum: txOutRefData(escrowA.utxoRef) })
    ), "spend accept", "assert payOut.value.lovelaces() >= this.price;"],
    ["accept paying without a datum", () => acceptPaying(
        new TxOut({ address: seller.address, value: Value.lovelaces(price) })
    ), "spend accept", "const InlineDatum{ datum: tagData } = payOut.datum;"],
    ["accept tagged with another transaction", () => acceptPaying(
        new TxOut({ address: seller.address, value: Value.lovelaces(price), datum: txOutRefData(new TxOutRef({ id: "55".repeat(32), index: 0 })) })
    ), "spend accept", "assert tagId == spendingRef.id;"],
    ["accept tagged with another output", () => acceptPaying(
        new TxOut({ address: seller.address, value: Value.lovelaces(price), datum: txOutRefData(new TxOutRef({ id: "11".repeat(32), index: 1 })) })
    ), "spend accept", "assert tagIndex == spendingRef.index;"],
    ["refund without the buyer's signature", () => ({ ...refund(), requiredSigners: [seller.pkh] }),
        "spend refund", "assert tx.requiredSigners.includes( this.buyer );"],
    ["refund without a lower bound", () => ({ ...refund(), invalidBefore: undefined }),
        "spend refund", "const Finite{ n: txEarliest } = tx.validityInterval.from.boundary;"],
    ["refund before the deadline", () => ({ ...refund(), invalidBefore: deadline - 100 }),
        "spend refund", "assert txEarliest > deadline;"],
    ["settle without the buyer's signature", () => ({ ...settle(), requiredSigners: [seller.pkh] }),
        "spend settle", "assert tx.requiredSigners.includes( this.buyer );"],
    ["settle without the seller's signature", () => ({ ...settle(), requiredSigners: [buyer.pkh] }),
        "spend settle", "assert tx.requiredSigners.includes( this.seller );"],
];

let failed = 0;

for (const [name, args] of [["accept", accept], ["refund", refund], ["settle", settle]] as const) {
    try { txBuilder.buildSync(args()); console.log(`ok    valid ${name}`); }
    catch (e) { failed++; console.log(`FAIL  valid ${name} was refused:\n${String((e as Error).message).split("\n\n")[0]}`); }
}

for (const [name, args, endpoint, statement] of cases) {
    const expected = `src/index.pebble:${lineOf(statement, endpoint)}`;
    let message = "";
    try { txBuilder.buildSync(args()); }
    catch (e) { message = String((e as Error)?.message ?? e); }
    const at = /failed at (src\/index\.pebble:\d+):\d+/.exec(message)?.[1];
    if (at === expected) console.log(`ok    ${name}: ${at}`);
    else {
        failed++;
        console.log(`FAIL  ${name}: expected ${expected}, got ${at ?? (message ? "no location" : "no failure")}`);
        if (message) console.log("      " + message.split("\n\n")[0].replace(/\n/g, "\n      "));
    }
}

console.log(`\n${cases.length + 3 - failed} of ${cases.length + 3} as expected`);
if (failed > 0) process.exit(1);
