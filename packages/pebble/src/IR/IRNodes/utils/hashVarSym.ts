import { fromHex } from "@harmoniclabs/uint8array-utils";

/**
 * Stable per-symbol bytes used as the preimage contribution of an
 * `IRVar` / self-reference when hashing.
 *
 * Each distinct symbol is assigned a unique 8-byte id the first time it
 * is hashed; subsequent calls for the same symbol return the same bytes.
 * This makes hashing a pure function of the (symbol-identity) content,
 * so a term's hash is stable for the life of the process — exactly what
 * content-addressed `IRHash` requires.
 *
 * No global state needs resetting:
 *  - the map is a `WeakMap`, so a symbol's entry is collected once the
 *    symbol itself is unreachable (no unbounded growth);
 *  - the counter is monotonic and never rewinds, so a symbol can never
 *    be reassigned a colliding id (the bug that the old reset-based
 *    scheme introduced).
 */
// `any` key: non-registered symbols are valid WeakMap keys at runtime
// (ES2023 / Node 20+), but older `lib` typings don't model symbol keys.
const _sym_to_bytes: WeakMap<any, Uint8Array> = new WeakMap();
let _next_id = 0n;

export function hashVarSym( s: symbol ): Uint8Array
{
    let bytes = _sym_to_bytes.get( s );
    if( bytes !== undefined ) return bytes;

    bytes = fromHex(
        (_next_id++).toString(16).padStart(16, "0")
    );
    _sym_to_bytes.set( s, bytes );
    return bytes;
}
