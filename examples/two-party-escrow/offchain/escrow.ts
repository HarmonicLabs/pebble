// ===========================================================================
//  Two-Party Escrow — offchain (buildooor)
// ===========================================================================
//  Encodings must stay in step with src/index.pebble:
//
//    params    [ buyer: bytes, seller: bytes, price: int ] — applied to the
//              compiled program as PLAIN UPLC constants, in declaration order.
//              Do not wrap scalars in Data.
//
//    datum     TwoPartyEscrow has one state, `Escrow`  ->  Constr(0, [deadline:I])
//
//    redeemer  spend endpoints are numbered per state, in declaration order:
//                  Escrow.accept  = Constr(0, [])
//                  Escrow.refund  = Constr(1, [])
//                  Escrow.settle  = Constr(2, [])
//              the bare fallback `recover` is Constr(0, []) — it is reached
//              only when the datum does not parse as a state.
// ===========================================================================

import {
    Address, DataConstr, DataB, DataI, PubKeyHash, TxOut, TxOutRef, UTxO, Value,
    type ITxBuildArgs,
} from "@harmoniclabs/buildooor";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadContract, hexToBytes, type Contract, type Wallet } from "../../_shared/devnet.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FLAT = join(__dirname, "..", "out", "out.flat");

export interface EscrowParams {
    buyer: PubKeyHash;
    seller: PubKeyHash;
    price: bigint;      // lovelace owed to the seller on acceptance
}

export const escrow = (p: EscrowParams): Contract =>
    loadContract(FLAT, [p.buyer.toBuffer(), p.seller.toBuffer(), p.price]);

// ---- datum / redeemers -----------------------------------------------------

export const escrowDatum = (deadlineMs: bigint): DataConstr =>
    new DataConstr(0, [new DataI(deadlineMs)]);

export const acceptRedeemer = (): DataConstr => new DataConstr(0, []);
export const refundRedeemer = (): DataConstr => new DataConstr(1, []);
export const settleRedeemer = (): DataConstr => new DataConstr(2, []);

/** how the validator reads a TxOutRef out of an inline datum */
export const txOutRefData = (ref: TxOutRef): DataConstr =>
    new DataConstr(0, [
        new DataB(hexToBytes(ref.id.toString())),
        new DataI(Number(ref.index)),
    ]);

// ---- transactions ----------------------------------------------------------

/** buyer locks the escrowed funds */
export function buildDeposit(
    c: Contract,
    buyer: Wallet,
    buyerUtxos: UTxO[],
    amount: bigint,
    deadlineMs: bigint
): ITxBuildArgs {
    return {
        inputs: buyerUtxos.map((utxo) => ({ utxo })),
        outputs: [
            new TxOut({
                address: c.address,
                value: Value.lovelaces(amount),
                datum: escrowDatum(deadlineMs),
            }),
        ],
        changeAddress: buyer.address,
    };
}

/**
 * Seller accepts and is paid.
 *
 * The payment output is tagged with the spent escrow UTxO's own ref, so one
 * payment can never discharge two escrows. `invalidAfter` must sit at or
 * before the deadline — the validator reads the UPPER bound.
 */
export function buildAccept(
    c: Contract,
    seller: Wallet,
    sellerUtxos: UTxO[],
    escrowUtxo: UTxO,
    price: bigint,
    invalidBefore: number,
    invalidAfter: number
): ITxBuildArgs {
    return {
        inputs: [
            { utxo: escrowUtxo, inputScript: { script: c.script, datum: "inline", redeemer: acceptRedeemer() } },
            ...sellerUtxos.map((utxo) => ({ utxo })),
        ],
        outputs: [
            new TxOut({
                address: seller.address,
                value: Value.lovelaces(price),
                datum: txOutRefData(escrowUtxo.utxoRef),   // pins the payment to THIS escrow
            }),
        ],
        collaterals: [sellerUtxos[0]],
        collateralReturn: {
            address: seller.address,
            value: Value.sub(sellerUtxos[0].resolved.value, Value.lovelaces(10_000_000n)),
        },
        requiredSigners: [seller.pkh],
        changeAddress: seller.address,
        invalidBefore,
        invalidAfter,
    };
}

/**
 * Buyer reclaims after the deadline.
 * The validator reads the LOWER bound, so `invalidBefore` must be strictly
 * past the deadline.
 */
export function buildRefund(
    c: Contract,
    buyer: Wallet,
    buyerUtxos: UTxO[],
    escrowUtxo: UTxO,
    invalidBefore: number,
    invalidAfter: number
): ITxBuildArgs {
    return {
        inputs: [
            { utxo: escrowUtxo, inputScript: { script: c.script, datum: "inline", redeemer: refundRedeemer() } },
            ...buyerUtxos.map((utxo) => ({ utxo })),
        ],
        outputs: [
            new TxOut({ address: buyer.address, value: escrowUtxo.resolved.value }),
        ],
        collaterals: [buyerUtxos[0]],
        collateralReturn: {
            address: buyer.address,
            value: Value.sub(buyerUtxos[0].resolved.value, Value.lovelaces(10_000_000n)),
        },
        requiredSigners: [buyer.pkh],
        changeAddress: buyer.address,
        invalidBefore,
        invalidAfter,
    };
}

/** both parties agree — any split, any time */
export function buildSettle(
    c: Contract,
    buyer: Wallet,
    seller: Wallet,
    funderUtxos: UTxO[],
    escrowUtxo: UTxO,
    outputs: TxOut[]
): ITxBuildArgs {
    return {
        inputs: [
            { utxo: escrowUtxo, inputScript: { script: c.script, datum: "inline", redeemer: settleRedeemer() } },
            ...funderUtxos.map((utxo) => ({ utxo })),
        ],
        outputs,
        collaterals: [funderUtxos[0]],
        collateralReturn: {
            address: buyer.address,
            value: Value.sub(funderUtxos[0].resolved.value, Value.lovelaces(10_000_000n)),
        },
        requiredSigners: [buyer.pkh, seller.pkh],
        changeAddress: buyer.address,
    };
}
