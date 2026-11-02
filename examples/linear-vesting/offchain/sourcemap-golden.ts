// ===========================================================================
//  Source maps on a real contract: every way the vesting contract can refuse
//  a claim, and the line buildooor reports for it. Local, no node:
//
//    npx pebble compile && npx tsx offchain/sourcemap-golden.ts
//
//  Each case breaks exactly one rule; the reported location must be the
//  statement enforcing it. A valid claim is built first, so a failing case
//  cannot pass by breaking something else.
// ===========================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    Address, Credential, DataI, PrivateKey, TxBuilder, TxOut, UTxO, Value, defaultProtocolParameters,
    type ITxBuildArgs,
} from "@harmoniclabs/buildooor";
import type { Wallet } from "../../_shared/devnet.ts";
import { FLAT, buildClaim, vesting, vestingDatum, type Schedule } from "./vesting.ts";

function demoWallet(name: string, seed: number): Wallet {
    const prv = new PrivateKey(new Uint8Array(32).fill(seed));
    const pub = prv.derivePublicKey();
    return { name, prv, pub, pkh: pub.hash, address: Address.testnet(Credential.keyHash(pub.hash)) };
}

const SOURCE = readFileSync(join(FLAT, "..", "..", "src", "index.pebble"), "utf8").split("\n");

/** 1-based line of the first line containing `snippet` */
function lineOf(snippet: string): number {
    const idx = SOURCE.findIndex((l) => l.includes(snippet));
    if (idx < 0) throw new Error(`not in the source: ${snippet}`);
    return idx + 1;
}

const beneficiary = demoWallet("beneficiary", 1);
const stranger = demoWallet("stranger", 2);
const contract = vesting();

// slot 0 at POSIX 0 and 1-second slots: a slot number is a POSIX time in seconds
const genesisInfos = { systemStartPosixMs: 0, slotLengthMs: 1000, startSlotNo: 0 };
const startSlot = 1_000_000;
const schedule: Schedule = {
    beneficiary: beneficiary.pkh,
    start: BigInt(startSlot) * 1000n,
    end: BigInt(startSlot + 1000) * 1000n,
    total: 100_000_000n,
    claimed: 0n,
};
// halfway through: 50 ADA vested
const halfway = startSlot + 500;
const amount = 20_000_000n;

const vestingUtxo = (id: string) => new UTxO({
    utxoRef: { id: id.repeat(32), index: 0 },
    resolved: { address: contract.address, value: Value.lovelaces(schedule.total), datum: vestingDatum(schedule) },
});
const lockA = vestingUtxo("11");
const funds = new UTxO({
    utxoRef: { id: "22".repeat(32), index: 0 },
    resolved: { address: beneficiary.address, value: Value.lovelaces(50_000_000n) },
});

const txBuilder = new TxBuilder(defaultProtocolParameters, genesisInfos, {
    sourceMaps: [readFileSync(FLAT + ".map", "utf8")],
});

/** a valid claim of `amount`, halfway through the schedule */
const claim = (claimed: bigint = amount): ITxBuildArgs =>
    buildClaim(contract, beneficiary, [funds], lockA, schedule, claimed, halfway, halfway + 100);

/** the valid claim, its continuation output replaced */
const withContinuation = (...cont: TxOut[]): ITxBuildArgs => {
    const args = claim();
    return { ...args, outputs: [...cont, ...args.outputs!.slice(1)] };
};
const continuation = (datum: ReturnType<typeof vestingDatum> | DataI | undefined, lovelaces = schedule.total - amount) =>
    new TxOut({ address: contract.address, value: Value.lovelaces(lovelaces), datum });
const nextDatum = (change: Partial<Schedule>) => vestingDatum({ ...schedule, claimed: schedule.claimed + amount, ...change });

const cases: [name: string, args: () => ITxBuildArgs, statement: string][] = [
    ["claim signed by someone else", () => ({ ...claim(), requiredSigners: [stranger.pkh] }),
        "assert tx.requiredSigners.includes( beneficiary );"],
    ["claim of nothing", () => claim(0n), "assert amount > 0;"],
    ["claim without a lower bound", () => ({ ...claim(), invalidBefore: undefined }),
        "const Finite{ n: txEarliest } = tx.validityInterval.from.boundary;"],
    ["claim of more than vested", () => claim(60_000_000n), "assert amount <= vested - claimed;"],
    ["claim spending two locks", () => {
        const args = claim();
        return { ...args, inputs: [...args.inputs, { utxo: vestingUtxo("33"), inputScript: args.inputs[0].inputScript }] };
    }, "assert tx.inputs.filter( i => i.resolved.address.payment == ownPaymentCreds ).length() == 1;"],
    ["claim without a continuation", () => ({ ...claim(), outputs: claim().outputs!.slice(1) }),
        "const Some{ value: cont } = tx.outputs.find( o => o.address == ownAddr );"],
    ["claim leaving too little locked", () => withContinuation(continuation(nextDatum({}), schedule.total - amount - 1n)),
        "assert cont.value.lovelaces() >= remaining;"],
    ["claim with a continuation without datum", () => withContinuation(continuation(undefined)),
        "const InlineDatum{ datum: contData } = cont.datum;"],
    ["claim with a continuation of another shape", () => withContinuation(continuation(new DataI(1))),
        "const Vesting{"],
    ["claim changing the beneficiary", () => withContinuation(continuation(nextDatum({ beneficiary: stranger.pkh }))),
        "assert b2 == beneficiary;"],
    ["claim changing the start", () => withContinuation(continuation(nextDatum({ start: schedule.start + 1n }))),
        "assert s2 == start;"],
    ["claim changing the end", () => withContinuation(continuation(nextDatum({ end: schedule.end + 1n }))),
        "assert e2 == end;"],
    ["claim changing the total", () => withContinuation(continuation(nextDatum({ total: schedule.total + 1n }))),
        "assert t2 == total;"],
    ["claim miscounting the claimed amount", () => withContinuation(continuation(nextDatum({ claimed: amount - 1n }))),
        "assert c2 == claimed + amount;"],
    // the first continuation found is right; a second one is one too many
    ["claim with two continuations", () => withContinuation(
        continuation(nextDatum({})),
        continuation(nextDatum({}), 2_000_000n)
    ), "assert tx.outputs.filter( o => o.address == ownAddr ).length() == 1;"],
];

let failed = 0;

try { txBuilder.buildSync(claim()); console.log("ok    valid claim"); }
catch (e) { failed++; console.log(`FAIL  valid claim was refused:\n${String((e as Error).message).split("\n\n")[0]}`); }

for (const [name, args, statement] of cases) {
    const expected = `src/index.pebble:${lineOf(statement)}`;
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

console.log(`\n${cases.length + 1 - failed} of ${cases.length + 1} as expected`);
if (failed > 0) process.exit(1);
