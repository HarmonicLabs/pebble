// ===========================================================================
//  A refund before the deadline, built locally: no node needed.
//
//  The escrow refuses it, and buildooor, given the script's source map, says
//  where in the Pebble source:
//
//    npm run demo:sourcemap       (from examples/: compiles, then runs this file)
//
//    script '…' consumed with Spend redeemer and index '0'
//    failed at src/index.pebble:81:13
//        at TwoPartyEscrow (src/index.pebble:81:13)
// ===========================================================================

import { readFileSync } from "node:fs";
import {
    Address, Credential, PrivateKey, TxBuilder, UTxO, Value, defaultProtocolParameters,
} from "@harmoniclabs/buildooor";
import type { Wallet } from "../../_shared/devnet.ts";
import { FLAT, buildRefund, escrow, escrowDatum } from "./escrow.ts";

/** a wallet for the demo: nothing is signed, only the keys' hashes matter */
function demoWallet(name: string, seed: number): Wallet {
    const prv = new PrivateKey(new Uint8Array(32).fill(seed));
    const pub = prv.derivePublicKey();
    return { name, prv, pub, pkh: pub.hash, address: Address.testnet(Credential.keyHash(pub.hash)) };
}

const buyer = demoWallet("buyer", 1);
const seller = demoWallet("seller", 2);
const price = 10_000_000n;
const contract = escrow({ buyer: buyer.pkh, seller: seller.pkh, price });

// slot 0 at POSIX 0 and 1-second slots: a slot number is a POSIX time in seconds
const genesisInfos = { systemStartPosixMs: 0, slotLengthMs: 1000, startSlotNo: 0 };
const deadlineSlot = 1_000_000;

const escrowUtxo = new UTxO({
    utxoRef: { id: "11".repeat(32), index: 0 },
    resolved: {
        address: contract.address,
        value: Value.lovelaces(price),
        datum: escrowDatum(BigInt(deadlineSlot) * 1000n),
    },
});
const buyerUtxo = new UTxO({
    utxoRef: { id: "22".repeat(32), index: 0 },
    resolved: { address: buyer.address, value: Value.lovelaces(50_000_000n) },
});

const txBuilder = new TxBuilder(defaultProtocolParameters, genesisInfos, {
    sourceMaps: [readFileSync(FLAT + ".map", "utf8")],
});

// the buyer asks for the refund 100 seconds BEFORE the deadline
try {
    txBuilder.buildSync(
        buildRefund(contract, buyer, [buyerUtxo], escrowUtxo, deadlineSlot - 100, deadlineSlot + 100)
    );
    console.error("unexpected: the escrow accepted a refund before the deadline");
    process.exit(1);
} catch (e) {
    // the head of the error: what failed and where (the rest lists the script's arguments)
    const message = String((e as Error)?.message ?? e);
    console.log(message.split("\n\n")[0]);
    if (!/failed at src\/index\.pebble:\d+:\d+/.test(message)) process.exit(1);
}
