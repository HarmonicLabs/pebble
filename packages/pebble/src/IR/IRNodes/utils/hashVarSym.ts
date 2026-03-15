// HASH GENERATOR

import { fromHex } from "@harmoniclabs/uint8array-utils";

const MAX_SAFE_INTEGER = Number( globalThis.Number?.MAX_SAFE_INTEGER ?? ((2**53) - 1) );
const MIN_SAFE_INTEGER = Number( globalThis.Number?.MIN_SAFE_INTEGER ?? -MAX_SAFE_INTEGER );

/// @ts-ignore Type 'symbol' does not satisfy the constraint 'object'.
const _sym_to_hash: WeakMap<symbol, number> = new WeakMap();
// we cannot store the symbol itself as it would prevent garbage collection
/// @ts-ignore Type 'symbol' does not satisfy the constraint 'object'.
const _hash_to_sym: Map<number, WeakRef<symbol>> = new Map();
let _next_hash = MIN_SAFE_INTEGER;

const unusedHashes: number[] = [];
function _collectUnusedHashes(): void
{
    for( const [h, s] of _hash_to_sym )
    {
        const newSymbol = s.deref();
        if(
            !newSymbol
            || !_sym_to_hash.has( newSymbol )
        ) {
            _hash_to_sym.delete( h );
            unusedHashes.push( h );
        }
    }
}

export function __VERY_UNSAFE_FORGET_VAR_SYM_HASHES_ONLY_USE_AT_END_OF_UPLC_COMPILATION(): void
{
    _hash_to_sym.clear();
    unusedHashes.length = 0;
    _next_hash = MIN_SAFE_INTEGER;
}

export function hashVarSym( s: symbol ): Uint8Array
{
    const limitReached = _next_hash >= MAX_SAFE_INTEGER;
    if(
        _next_hash % 0xffff === 0
        || limitReached
    ) _collectUnusedHashes();

    if(
        limitReached
        && unusedHashes.length <= 0
    ) throw new Error("ran out of IR hashes");

    const result_hash = unusedHashes.shift() ?? _next_hash++;
    _sym_to_hash.set( s, result_hash );
    /// @ts-ignore Argument of type 'WeakRef<object>' is not assignable to parameter of type 'WeakRef<symbol>'
    _hash_to_sym.set( result_hash, new WeakRef( s ) );

    return fromHex(
        (BigInt( result_hash ) + BigInt( MAX_SAFE_INTEGER ))
        .toString(16)
        .padStart(16, "0")
    );
}