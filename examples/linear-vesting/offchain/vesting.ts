// ===========================================================================
//  Linear Vesting — offchain (buildooor)
// ===========================================================================
//  Encodings must stay in step with src/index.pebble:
//
//    datum     LinearVesting has ONE state, `Vesting`, so the datum is
//              Constr(0, [ beneficiary:B, start:I, end:I, total:I, claimed:I ])
//              (states are numbered in declaration order)
//
//    redeemer  `Vesting` has ONE spend endpoint, `claim( amount: int )`, so
//              the redeemer is Constr(0, [ amount:I ])
//              (spend endpoints are numbered per state, in declaration order)
// ===========================================================================

import {
    Address, DataConstr, DataB, DataI, PubKeyHash, TxOut, UTxO, Value,
    type ITxBuildArgs,
} from "@harmoniclabs/buildooor";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadContract, type Contract, type Wallet } from "../../_shared/devnet.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FLAT = join(__dirname, "..", "out", "out.flat");

/** LinearVesting takes no `param`s, so nothing is applied */
export const vesting = (): Contract => loadContract(FLAT);

// ---- datum / redeemer ------------------------------------------------------

export interface Schedule {
    beneficiary: PubKeyHash;
    start: bigint;    // POSIX ms
    end: bigint;      // POSIX ms
    total: bigint;    // lovelace subject to the schedule
    claimed: bigint;  // lovelace already withdrawn
}

export const vestingDatum = (s: Schedule): DataConstr =>
    new DataConstr(0, [
        new DataB(s.beneficiary.toBuffer()),
        new DataI(s.start),
        new DataI(s.end),
        new DataI(s.total),
        new DataI(s.claimed),
    ]);

export const claimRedeemer = (amount: bigint): DataConstr =>
    new DataConstr(0, [new DataI(amount)]);

/** the same arithmetic the validator performs, for building/asserting offchain */
export function vestedAt(s: Schedule, posixMs: bigint): bigint {
    const duration = s.end - s.start;
    const elapsed = posixMs - s.start;
    if (elapsed <= 0n) return 0n;
    if (elapsed >= duration) return s.total;
    return (s.total * elapsed) / duration;   // truncating, as on-chain
}

export const claimableAt = (s: Schedule, posixMs: bigint): bigint =>
    vestedAt(s, posixMs) - s.claimed;

// ---- transactions ----------------------------------------------------------

/** lock `total` lovelace under a linear schedule */
export function buildLock(
    c: Contract,
    depositor: Wallet,
    depositorUtxos: UTxO[],
    s: Schedule
): ITxBuildArgs {
    return {
        inputs: depositorUtxos.map((utxo) => ({ utxo })),
        outputs: [
            new TxOut({
                address: c.address,
                value: Value.lovelaces(s.total),
                datum: vestingDatum(s),
            }),
        ],
        changeAddress: depositor.address,
    };
}

/**
 * Withdraw `amount` of the vested balance.
 *
 * `validFromMs` becomes the transaction's validity LOWER bound, which is the
 * only notion of elapsed time the validator has. It must be a time at which
 * `amount` has actually vested, and it must not be in the future or the node
 * will reject the transaction outright.
 */
export function buildClaim(
    c: Contract,
    beneficiary: Wallet,
    beneficiaryUtxos: UTxO[],
    vestingUtxo: UTxO,
    s: Schedule,
    amount: bigint,
    invalidBefore: number,     // slot
    invalidAfter: number       // slot
): ITxBuildArgs {
    const locked = vestingUtxo.resolved.value.lovelaces;
    const remaining = locked - amount;

    const outputs: TxOut[] = [];
    if (remaining > 0n) {
        // continuation: same schedule, `claimed` advanced by exactly `amount`
        outputs.push(new TxOut({
            address: c.address,
            value: Value.lovelaces(remaining),
            datum: vestingDatum({ ...s, claimed: s.claimed + amount }),
        }));
    }
    outputs.push(new TxOut({
        address: beneficiary.address,
        value: Value.lovelaces(amount),
    }));

    return {
        inputs: [
            { utxo: vestingUtxo, inputScript: { script: c.script, datum: "inline", redeemer: claimRedeemer(amount) } },
            ...beneficiaryUtxos.map((utxo) => ({ utxo })),
        ],
        outputs,
        collaterals: [beneficiaryUtxos[0]],
        collateralReturn: {
            address: beneficiary.address,
            value: Value.sub(beneficiaryUtxos[0].resolved.value, Value.lovelaces(10_000_000n)),
        },
        requiredSigners: [beneficiary.pkh],
        changeAddress: beneficiary.address,
        invalidBefore,
        invalidAfter,
    };
}
