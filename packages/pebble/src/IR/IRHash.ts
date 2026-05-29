import { blake2b_128 } from "@harmoniclabs/crypto";
import { fromHex, toHex } from "@harmoniclabs/uint8array-utils";

/**
 * Content-addressed IR hash.
 *
 * An `IRHash` is the lowercase-hex blake2b-128 digest of a node's
 * structural *preimage* — its tag byte(s) concatenated with the digests
 * of its children (a Merkle hash over the IR tree). Because it is a pure
 * function of the node's content, the same term always hashes to the
 * same value for the entire life of the process: there is no global
 * counter and no interning table, and therefore **nothing to reset
 * between compilations**.
 *
 * This is what makes compilation hermetic. The previous implementation
 * interned preimages to a sequential integer and reset the counter at
 * the end of every compile; long-lived nodes (the module-level
 * `hoisted_*` singletons) cached integer hashes from the pre-reset
 * numbering, so after the first reset freshly-minted nodes collided with
 * those stale hashes and the hoist/let dedup merged unrelated terms.
 * Content addressing removes the failure mode by construction.
 *
 * Memory: there is no central table that accumulates across compiles —
 * each node memoizes its own digest and is collected normally.
 */
export type IRHash = string;

/** 16 bytes (blake2b-128) -> 32 lowercase hex chars. */
const IR_HASH_HEX_LEN = 32;

export function hashIrData( data: Uint8Array ): IRHash
{
    return toHex( blake2b_128( data ) );
}

export function isIRHash( hash: any ): hash is IRHash
{
    return (
        typeof hash === "string"
        && hash.length === IR_HASH_HEX_LEN
    );
}

export function equalIrHash( a: IRHash, b: IRHash ): boolean
{
    return a === b;
}

export function irHashToHex( hash: IRHash ): string
{
    return hash;
}

export function irHashFromHex( hex: string ): IRHash
{
    return hex;
}

export function irHashToBytes( hash: IRHash ): Uint8Array
{
    return fromHex( hash );
}
