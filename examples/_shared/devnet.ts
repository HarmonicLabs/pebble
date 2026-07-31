// ===========================================================================
//  Shared devnet glue for the Pebble examples
// ===========================================================================
//
//  buildooor BUILDS, EVALUATES (plutus-machine) and SIGNS the transactions.
//  A local `cardano-node` is reached through `cardano-cli` only to query UTxOs
//  and submit the signed bytes.
//
//  Point this at any local devnet with:
//      export PEBBLE_DEVNET=/path/to/.devnet/data
//  The directory must be a `cardano-testnet` output (utxo-keys/, socket/) with
//  a `pparams.json` dumped next to it.
// ===========================================================================

import {
    Address, Credential, Value, TxBuilder, UTxO, TxOutRef, TxOut,
    PrivateKey, PublicKey, PubKeyHash, Hash28, Script, Tx,
    CborPositiveRational, dataFromCbor, defaultProtocolParameters,
    parseUPLC, compileUPLC, UPLCProgram, Application, UPLCConst,
    Cbor, CborBytes,
    type Data, type UPLCTerm, type ITxBuildArgs,
} from "@harmoniclabs/buildooor";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEVNET =
    process.env.PEBBLE_DEVNET ?? join(__dirname, "..", ".devnet", "data");
export const SOCKET = join(DEVNET, "socket", "node1", "sock");
export const MAGIC = Number(process.env.PEBBLE_DEVNET_MAGIC ?? 42);
export const WORK = join(__dirname, "..", ".work");
export const WALLET_DIR = join(WORK, "wallets");
if (!existsSync(WALLET_DIR)) mkdirSync(WALLET_DIR, { recursive: true });

export const hexToBytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));
export const bytesToHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

// ---------------------------------------------------------------------------
//  Language-view shim
// ---------------------------------------------------------------------------
//  The script-integrity hash covers the cost models exactly as the NODE
//  serialises them. buildooor's bundled defaults can differ in length from a
//  devnet's, which would make every script tx fail integrity. Re-serialise
//  from the node's own pparams so the hash always matches.
// ---------------------------------------------------------------------------
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
{
    const CM = _require("@harmoniclabs/cardano-costmodels-ts/dist/CostModels.js");
    const { Cbor, CborMap, CborUInt, CborNegInt, CborArray, CborBytes } = _require("@harmoniclabs/cbor");
    const ppPath = join(DEVNET, "pparams.json");
    if (existsSync(ppPath)) {
        const pp = JSON.parse(readFileSync(ppPath, "utf8"));
        const cn = (n: number | string) =>
            BigInt(n) < 0n ? new CborNegInt(BigInt(n)) : new CborUInt(BigInt(n));
        CM.costModelsToLanguageViewCbor = function (
            _costmdls: unknown,
            opts: { mustHaveV1?: boolean; mustHaveV2?: boolean; mustHaveV3?: boolean }
        ) {
            const entries: unknown[] = [];
            if (opts.mustHaveV1) entries.push({
                k: new CborBytes(Uint8Array.from([0])),
                v: new CborBytes(Cbor.encode(new CborArray(pp.costModels.PlutusV1.map(cn), { indefinite: true }))),
            });
            if (opts.mustHaveV2) entries.push({ k: new CborUInt(1), v: new CborArray(pp.costModels.PlutusV2.map(cn)) });
            if (opts.mustHaveV3) entries.push({ k: new CborUInt(2), v: new CborArray(pp.costModels.PlutusV3.map(cn)) });
            return Cbor.encode(new CborMap(entries));
        };
    }
}

// ---- cardano-cli ----------------------------------------------------------

export function cli(args: string[], opts: object = {}): string {
    return execFileSync("cardano-cli", args, {
        env: { ...process.env, CARDANO_NODE_SOCKET_PATH: SOCKET },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        ...opts,
    });
}

export function queryTip(): { block: number; slot: number; era: string } {
    return JSON.parse(cli(["query", "tip", "--testnet-magic", String(MAGIC)]));
}

interface CliValue { lovelace?: number | string; [policy: string]: unknown }

function valueFromCli(v: CliValue): Value {
    let acc = Value.lovelaces(BigInt(v.lovelace ?? 0));
    for (const [policy, toks] of Object.entries(v)) {
        if (policy === "lovelace") continue;
        for (const [name, amt] of Object.entries(toks as Record<string, number | string>)) {
            acc = Value.add(acc, Value.singleAsset(new Hash28(policy), hexToBytes(name), BigInt(amt)));
        }
    }
    return acc;
}

interface CliUtxo {
    address: string;
    value: CliValue;
    inlineDatumRaw?: string;
    referenceScript?: { script?: { cborHex?: string } };
}

export function queryUtxos(address: Address | string): UTxO[] {
    const addr = typeof address === "string" ? address : address.toString();
    const tmp = join(WORK, ".utxo-query.json");
    cli(["query", "utxo", "--address", addr, "--testnet-magic", String(MAGIC), "--out-file", tmp]);
    const raw: Record<string, CliUtxo> = JSON.parse(readFileSync(tmp, "utf8"));
    const out: UTxO[] = [];
    for (const [ref, o] of Object.entries(raw)) {
        const [txid, ix] = ref.split("#");
        out.push(new UTxO({
            utxoRef: new TxOutRef({ id: txid, index: Number(ix) }),
            resolved: new TxOut({
                address: Address.fromString(o.address),
                value: valueFromCli(o.value),
                datum: o.inlineDatumRaw ? dataFromCbor(o.inlineDatumRaw) : undefined,
                refScript: o.referenceScript?.script?.cborHex
                    ? Script.plutusV3(hexToBytes(o.referenceScript.script.cborHex))
                    : undefined,
            }),
        }));
    }
    return out;
}

export function submitSignedTx(signedTx: Tx, label = "tx"): string {
    const cborHex = bytesToHex(signedTx.toCborBytes());
    const f = join(WORK, `${label}.signed.json`);
    writeFileSync(f, JSON.stringify({ type: "Tx ConwayEra", description: "", cborHex }));
    cli(["latest", "transaction", "submit", "--testnet-magic", String(MAGIC), "--tx-file", f]);
    return signedTx.hash.toString();
}

export function sleep(ms: number): void {
    const sab = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(sab, 0, 0, ms);
}

/** wait until `txHash` appears as a UTxO at `address` */
export function awaitTxAtAddr(address: Address | string, txHash: string, tries = 120): UTxO[] {
    for (let i = 0; i < tries; i++) {
        const utxos = queryUtxos(address);
        if (utxos.some((u) => u.utxoRef.id.toString() === txHash)) return utxos;
        sleep(1000);
    }
    throw new Error(`timeout waiting for tx ${txHash} at ${address}`);
}

/** wait until `txHash` is GONE from `address` (i.e. it was spent) */
export function awaitSpent(address: Address | string, txHash: string, tries = 120): void {
    for (let i = 0; i < tries; i++) {
        const utxos = queryUtxos(address);
        if (!utxos.some((u) => u.utxoRef.id.toString() === txHash)) return;
        sleep(1000);
    }
    throw new Error(`timeout waiting for ${txHash} to be spent`);
}

// ---- protocol params / builder --------------------------------------------

let _txb: TxBuilder | undefined;
export function txBuilder(): TxBuilder {
    if (_txb) return _txb;
    const pp = JSON.parse(readFileSync(join(DEVNET, "pparams.json"), "utf8"));
    const { systemStartMs, slotLengthMs } = genesisTiming();
    _txb = new TxBuilder(
        {
            ...defaultProtocolParameters,
            txFeePerByte: pp.txFeePerByte,
            txFeeFixed: pp.txFeeFixed,
            utxoCostPerByte: pp.utxoCostPerByte,
            maxTxSize: pp.maxTxSize,
            collateralPercentage: pp.collateralPercentage,
            maxCollateralInputs: pp.maxCollateralInputs,
            minfeeRefScriptCostPerByte: new CborPositiveRational(BigInt(pp.minFeeRefScriptCostPerByte ?? 15), 1n),
        },
        // WITHOUT this the builder converts `invalidBefore`/`invalidAfter`
        // slots to POSIX using mainnet defaults, so the validity interval the
        // SCRIPT sees has nothing to do with this devnet's clock.
        {
            systemStartPosixMs: systemStartMs,
            slotLengthMs,
            startSlotNo: 0,
        }
    );
    return _txb;
}

/** system start (ms) + slot length, needed to turn POSIX times into slots */
export function genesisTiming(): { systemStartMs: number; slotLengthMs: number } {
    const sg = JSON.parse(readFileSync(join(DEVNET, "shelley-genesis.json"), "utf8"));
    return {
        systemStartMs: Date.parse(sg.systemStart),
        slotLengthMs: Math.round((sg.slotLength ?? 1) * 1000),
    };
}

export const slotToPosix = (slot: number): number => {
    const { systemStartMs, slotLengthMs } = genesisTiming();
    return systemStartMs + slot * slotLengthMs;
};
export const posixToSlot = (posixMs: number): number => {
    const { systemStartMs, slotLengthMs } = genesisTiming();
    return Math.floor((posixMs - systemStartMs) / slotLengthMs);
};

// ---- wallets --------------------------------------------------------------

export interface Wallet {
    name: string;
    prv: PrivateKey;
    pub: PublicKey;
    pkh: PubKeyHash;
    address: Address;
}

export function saveWallet(name: string, seed32: Uint8Array): Wallet {
    writeFileSync(join(WALLET_DIR, `${name}.json`), JSON.stringify({ skeyHex: bytesToHex(seed32) }));
    return loadWallet(name);
}

export function loadWallet(name: string): Wallet {
    const w = JSON.parse(readFileSync(join(WALLET_DIR, `${name}.json`), "utf8"));
    const prv = new PrivateKey(hexToBytes(w.skeyHex));
    const pub = prv.derivePublicKey();
    return { name, prv, pub, pkh: pub.hash, address: Address.testnet(Credential.keyHash(pub.hash)) };
}

export function ensureWallet(name: string): Wallet {
    if (existsSync(join(WALLET_DIR, `${name}.json`))) return loadWallet(name);
    return saveWallet(name, globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

// ---- funding from the devnet genesis key ----------------------------------

export interface FundOut { address: Address | string; lovelace: bigint }

export function fundFromGenesis(outs: FundOut[], label = "fund"): string {
    const genSkey = join(DEVNET, "utxo-keys", "utxo1", "utxo.skey");
    const genVkey = join(DEVNET, "utxo-keys", "utxo1", "utxo.vkey");
    // derived fresh every time: caching this across devnets yields the wrong
    // address (and a confusing "genesis address has no utxos")
    const genAddr = cli([
        "address", "build", "--payment-verification-key-file", genVkey,
        "--testnet-magic", String(MAGIC),
    ]).trim();

    const tmp = join(WORK, "gen-utxo.json");
    cli(["query", "utxo", "--address", genAddr, "--testnet-magic", String(MAGIC), "--out-file", tmp]);
    const utxos: Record<string, { value: { lovelace: number | string } }> = JSON.parse(readFileSync(tmp, "utf8"));
    const entries = Object.entries(utxos)
        .sort((a, b) => Number(b[1].value.lovelace) - Number(a[1].value.lovelace));
    if (entries.length === 0) throw new Error("genesis address has no utxos");

    const txFile = join(WORK, `${label}.tx`);
    const args = [
        "conway", "transaction", "build",
        "--testnet-magic", String(MAGIC),
        "--tx-in", entries[0][0],
        "--change-address", genAddr,
        "--out-file", txFile,
    ];
    for (const o of outs) {
        args.push("--tx-out", `${typeof o.address === "string" ? o.address : o.address.toString()}+${o.lovelace}`);
    }
    cli(args);
    const signedFile = join(WORK, `${label}.signed`);
    cli(["conway", "transaction", "sign", "--testnet-magic", String(MAGIC),
        "--tx-file", txFile, "--signing-key-file", genSkey, "--out-file", signedFile]);
    cli(["conway", "transaction", "submit", "--testnet-magic", String(MAGIC), "--tx-file", signedFile]);
    const rawId = cli(["conway", "transaction", "txid", "--tx-file", signedFile]).trim();
    try { return JSON.parse(rawId).txhash; } catch { return rawId; }
}

/** fund `w` if it holds less than `min`, and wait for the money to land */
export function ensureFunded(w: Wallet, min = 100_000_000n, give = 500_000_000n): void {
    const bal = queryUtxos(w.address).reduce((a, u) => a + u.resolved.value.lovelaces, 0n);
    if (bal >= min) return;
    const h = fundFromGenesis([{ address: w.address, lovelace: give }], `fund-${w.name}`);
    awaitTxAtAddr(w.address, h);
}

// ---- build + sign + submit ------------------------------------------------

export async function signSubmitAwait(
    buildArgs: ITxBuildArgs,
    signers: Wallet[],
    label: string,
    waitAddr?: Address | string
): Promise<string> {
    const tx = await txBuilder().build(buildArgs);
    for (const s of signers) tx.signWith(s.prv);
    const h = submitSignedTx(tx, label);
    console.log(`    submitted ${label}: ${h}`);
    if (waitAddr) awaitTxAtAddr(waitAddr, h);
    return h;
}

// ---- compiled Pebble programs ---------------------------------------------

/**
 * Apply contract `param`s to a compiled Pebble program and wrap it as a
 * PlutusV3 script.
 *
 * SCALAR params (`bytes`, `int`) must be applied as plain UPLC constants —
 * wrapping them in `Data` (`DataB`/`DataI`) type-checks offchain but
 * miscompiles at a distance. Structured params go through `.toData()`.
 */
export type ParamValue = Uint8Array | bigint | number | Data;

export function applyParams(flat: Uint8Array, params: ParamValue[] = []): Script {
    const prog = parseUPLC(flat, "flat");
    let body: UPLCTerm = prog.body;
    for (const p of params) {
        const c = p instanceof Uint8Array ? UPLCConst.byteString(p)
            : typeof p === "bigint" || typeof p === "number" ? UPLCConst.int(BigInt(p))
            : UPLCConst.data(p);
        body = new Application(body, c);
    }
    const compiled: unknown = compileUPLC(new UPLCProgram(prog.version, body));
    const flatOut = compiled instanceof Uint8Array
        ? compiled
        : new Uint8Array((compiled as { toBuffer(): Uint8Array }).toBuffer?.() ?? (compiled as Uint8Array));
    return Script.plutusV3(Cbor.encode(new CborBytes(new Uint8Array(flatOut))));
}

export interface Contract {
    script: Script;
    hash: Script["hash"];
    address: Address;
}

/** load `out/out.flat`, apply params, and derive the testnet script address */
export function loadContract(flatPath: string, params: ParamValue[] = []): Contract {
    const script = applyParams(new Uint8Array(readFileSync(flatPath)), params);
    return {
        script,
        hash: script.hash,
        address: Address.testnet(Credential.script(script.hash)),
    };
}
