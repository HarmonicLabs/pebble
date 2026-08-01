// ===========================================================================
//  Preprod glue for the Pebble examples
// ===========================================================================
//  Same shape as `devnet.ts`, but chain access goes through Blockfrost instead
//  of a local node. Configure with `.env.local`:
//
//      BLOCKFROST_URL=https://...            # a proxy needing no project id
//    or
//      BLOCKFROST_PROJECT_ID=preprod...      # a real blockfrost.io key
//
//  Signing keys live in `examples/keys/` (git-ignored).
// ===========================================================================

import {
    Address, Credential, PrivateKey, PublicKey, PubKeyHash, Script, Tx, TxBuilder,
    UTxO, Value, defaultProtocolParameters,
    parseUPLC, compileUPLC, UPLCProgram, Application, UPLCConst, Cbor, CborBytes,
    type Data, type UPLCTerm, type ITxBuildArgs,
} from "@harmoniclabs/buildooor";
import { BlockfrostPluts } from "@harmoniclabs/blockfrost-pluts";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const EXAMPLES = join(__dirname, "..");
export const KEYS = join(EXAMPLES, "keys");
export const EVIDENCE = join(EXAMPLES, "onchain-evidence");
if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });

export const hexToBytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));
export const bytesToHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

// ---- env ------------------------------------------------------------------

function env(): Record<string, string> {
    const out: Record<string, string> = {};
    const f = join(EXAMPLES, ".env.local");
    if (existsSync(f)) {
        for (const line of readFileSync(f, "utf8").split("\n")) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
            if (m) out[m[1]] = m[2];
        }
    }
    return { ...out, ...process.env } as Record<string, string>;
}

let _bf: BlockfrostPluts | undefined;
export function provider(): BlockfrostPluts {
    if (_bf) return _bf;
    const e = env();
    const url = e.BLOCKFROST_URL;
    const projectId = e.BLOCKFROST_PROJECT_ID;
    if (!url && !projectId) {
        throw new Error("set BLOCKFROST_URL or BLOCKFROST_PROJECT_ID in examples/.env.local");
    }
    // With a proxy the auth is supplied upstream, so `projectId` must be OMITTED
    // entirely — passing any string makes the client validate it as a real
    // blockfrost key (`mainnet…`/`preprod…`/…) and reject anything else.
    _bf = url
        ? new BlockfrostPluts({ customBackend: url.replace(/\/$/, ""), network: "preprod" } as never)
        : new BlockfrostPluts({ projectId, network: "preprod" } as never);
    return _bf;
}

// ---- wallets --------------------------------------------------------------

export interface Wallet {
    name: string;
    prv: PrivateKey;
    pub: PublicKey;
    pkh: PubKeyHash;
    address: Address;
}

/** load a `cardano-cli` PaymentSigningKeyShelley_ed25519 envelope */
export function loadCliKey(name: string): Wallet {
    const j = JSON.parse(readFileSync(join(KEYS, `${name}.skey`), "utf8"));
    // cborHex is a CBOR bytestring: 5820 <32 bytes>
    const raw = hexToBytes(j.cborHex);
    const seed = raw.length === 34 && raw[0] === 0x58 && raw[1] === 0x20 ? raw.slice(2) : raw;
    const prv = new PrivateKey(seed);
    const pub = prv.derivePublicKey();
    return { name, prv, pub, pkh: pub.hash, address: Address.testnet(Credential.keyHash(pub.hash)) };
}

/** a deterministic secondary wallet, derived from the primary key + a label */
export async function derivedWallet(from: Wallet, label: string): Promise<Wallet> {
    const seedSrc = new Uint8Array([...from.prv.toBuffer(), ...new TextEncoder().encode(label)]);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", seedSrc));
    const prv = new PrivateKey(digest);
    const pub = prv.derivePublicKey();
    return { name: label, prv, pub, pkh: pub.hash, address: Address.testnet(Credential.keyHash(pub.hash)) };
}

// ---- chain ----------------------------------------------------------------

/** Blockfrost 404s for an address with no history — that is "empty", not an error */
export async function utxosAt(a: Address | string): Promise<UTxO[]> {
    try {
        return await provider().addressUtxos(a as never);
    } catch (e) {
        if (String(e).includes("404") || String(e).includes("Not Found")) return [];
        throw e;
    }
}

export const lovelacesAt = async (a: Address | string): Promise<bigint> =>
    (await utxosAt(a)).reduce((acc, u) => acc + u.resolved.value.lovelaces, 0n);

// ---- slot <-> POSIX -------------------------------------------------------
//
//  Blockfrost's `/genesis` reports the SHELLEY system start and a 1s slot
//  length. Naively applying `systemStart + slot * 1s` is wrong on preprod: the
//  Byron era ran 86400 slots at 20s, so the naive result is **19 days early**.
//
//  The ledger builds the ScriptContext using real era history, so a validator
//  compares its datum against the true time. If buildooor converted naively,
//  its local phase-2 evaluation would disagree with the chain by 19 days and
//  reject transactions the chain accepts (or the reverse).
//
//  Rather than hard-code an era table, calibrate against a real block:
//  `effectiveStart = blockTime - blockSlot * slotLength` reproduces the
//  ledger's mapping exactly for the current era.

interface Timing { effectiveStartMs: number; slotLengthMs: number }
let _timing: Timing | undefined;

export async function timing(): Promise<Timing> {
    if (_timing) return _timing;
    const bf = provider();
    const [gi, block] = await Promise.all([
        bf.getGenesisInfos(),
        bf.get(`${bf.url}/blocks/latest`),
    ]);
    const g = gi as { slotLengthMs?: number; slotLengthInMilliseconds?: number };
    const slotLengthMs = Number(g.slotLengthMs ?? g.slotLengthInMilliseconds ?? 1000);
    const effectiveStartMs = Number(block.time) * 1000 - Number(block.slot) * slotLengthMs;
    _timing = { effectiveStartMs, slotLengthMs };
    return _timing;
}

let _txb: TxBuilder | undefined;
export async function txBuilder(): Promise<TxBuilder> {
    if (_txb) return _txb;
    const bf = provider();
    const [pp, t] = await Promise.all([bf.getProtocolParameters(), timing()]);
    _txb = new TxBuilder(pp, {
        systemStartPosixMs: t.effectiveStartMs,
        slotLengthMs: t.slotLengthMs,
        startSlotNo: 0,
    });
    return _txb;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** current chain tip slot. `get()` takes a FULL url, so prepend the backend. */
export async function tipSlot(): Promise<number> {
    const bf = provider();
    const b = await bf.get(`${bf.url}/blocks/latest`);
    return Number(b.slot);
}

export async function slotToPosix(slot: number): Promise<number> {
    const t = await timing();
    return t.effectiveStartMs + slot * t.slotLengthMs;
}

export async function posixToSlot(posixMs: number): Promise<number> {
    const t = await timing();
    return Math.floor((posixMs - t.effectiveStartMs) / t.slotLengthMs);
}

/** the chain's current slot and its true POSIX time */
export async function chainNow(): Promise<{ slot: number; posixMs: number }> {
    const slot = await tipSlot();
    return { slot, posixMs: await slotToPosix(slot) };
}

/** wait until `hash` is on chain */
export async function awaitTx(hash: string, tries = 120): Promise<void> {
    for (let i = 0; i < tries; i++) {
        try {
            const bf = provider();
            await bf.get(`${bf.url}/txs/${hash}`);
            return;
        } catch { /* 404 until confirmed */ }
        await sleep(5000);
    }
    throw new Error(`timeout waiting for tx ${hash}`);
}

export async function waitSlot(target: number): Promise<number> {
    for (;;) {
        const s = await tipSlot();
        if (s >= target) return s;
        await sleep(10_000);
    }
}

// ---- build / sign / submit ------------------------------------------------

const submitted: { label: string; hash: string }[] = [];

export async function submit(
    buildArgs: ITxBuildArgs,
    signers: Wallet[],
    label: string
): Promise<string> {
    const tx = await (await txBuilder()).build(buildArgs);
    for (const s of signers) tx.signWith(s.prv);
    const hash = await provider().submitTx(tx);
    submitted.push({ label, hash });
    console.log(`    ${label}: ${hash}`);
    await awaitTx(hash);
    return hash;
}

export const submittedTxs = (): { label: string; hash: string }[] => [...submitted];

export function writeEvidence(name: string, data: unknown): string {
    const p = join(EVIDENCE, name);
    writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
    console.log(`\n  evidence written: ${p}`);
    return p;
}

// ---- compiled programs ----------------------------------------------------

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

export interface Contract { script: Script; hash: Script["hash"]; address: Address }

export function loadContract(flatPath: string, params: ParamValue[] = []): Contract {
    const script = applyParams(new Uint8Array(readFileSync(flatPath)), params);
    return { script, hash: script.hash, address: Address.testnet(Credential.script(script.hash)) };
}

export { Value };
