/**
 * Tiny seedable PRNG (mulberry32).
 *
 * Single-purpose, deterministic, no dependencies. Used by the Phase 1
 * property-test runner to sample primitive values for parameters whose
 * type has a built-in TS-side fuzzer (`int`, `bool`).
 *
 * Phase 2 will replace this with a Pebble-side fuzzer pipeline that runs
 * on the CEK machine; that will let user-defined fuzzers (`via <expr>`)
 * compose deterministically with the built-in ones.
 */
export class PRNG
{
    private state: number;

    constructor( seed: number )
    {
        // ensure non-zero, fits in u32
        this.state = ( seed | 0 ) || 1;
    }

    /** Returns an unsigned 32-bit integer. */
    next32(): number
    {
        // mulberry32
        let t = ( this.state = ( this.state + 0x6D2B79F5 ) | 0 );
        t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
        t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
        return ( t ^ ( t >>> 14 ) ) >>> 0;
    }

    /** Returns a boolean (uniform). */
    nextBool(): boolean
    {
        return ( this.next32() & 1 ) === 1;
    }

    /**
     * Returns a random bigint, biased toward edge values.
     *
     * 1 in 16 returns one of: 0, 1, -1, INT64_MAX, INT64_MIN, INT32_MAX, INT32_MIN.
     * Otherwise samples uniformly across signed 64-bit range.
     */
    nextIntBiased(): bigint
    {
        const edgeRoll = this.next32() & 0xF; // 0..15
        if( edgeRoll === 0 )
        {
            const edges = [
                0n,
                1n,
                -1n,
                (1n << 63n) - 1n,
                -(1n << 63n),
                (1n << 31n) - 1n,
                -(1n << 31n),
            ];
            return edges[ this.next32() % edges.length ];
        }
        // assemble a 64-bit signed value from two u32 samples
        const hi = BigInt( this.next32() );
        const lo = BigInt( this.next32() );
        let v = ( hi << 32n ) | lo;
        // interpret as signed (sign bit is bit 63)
        if( v & (1n << 63n) ) v -= (1n << 64n);
        return v;
    }
}
