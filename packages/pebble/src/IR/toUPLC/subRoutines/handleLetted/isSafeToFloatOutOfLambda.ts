import { IRApp } from "../../../IRNodes/IRApp";
import { IRCase } from "../../../IRNodes/IRCase";
import { IRConst } from "../../../IRNodes/IRConst";
import { IRConstr } from "../../../IRNodes/IRConstr";
import { IRDelayed } from "../../../IRNodes/IRDelayed";
import { IRForced } from "../../../IRNodes/IRForced";
import { IRFunc } from "../../../IRNodes/IRFunc";
import { IRHoisted } from "../../../IRNodes/IRHoisted";
import { IRLetted } from "../../../IRNodes/IRLetted";
import { IRNative } from "../../../IRNodes/IRNative";
import { IRNativeTag } from "../../../IRNodes/IRNative/IRNativeTag";
import { isForcedNativeTag } from "../../../IRNodes/IRNative/isForcedNative";
import { IRRecursive } from "../../../IRNodes/IRRecursive";
import { IRSelfCall } from "../../../IRNodes/IRSelfCall";
import { IRVar } from "../../../IRNodes/IRVar";
import { IRTerm } from "../../../IRTerm";

/**
 * Builtins that can NEVER fail, whatever (well-typed) arguments they get.
 * Anything not listed is treated as potentially failing (head/tail on
 * empty lists, un*Data on the wrong shape, division by zero, ...).
 */
const TOTAL_NATIVE_TAGS: ReadonlySet<number> = new Set<number>([
    IRNativeTag.addInteger,
    IRNativeTag.subtractInteger,
    IRNativeTag.multiplyInteger,
    IRNativeTag.equalsInteger,
    IRNativeTag.lessThanInteger,
    IRNativeTag.lessThanEqualInteger,
    IRNativeTag.appendByteString,
    IRNativeTag.sliceByteString,
    IRNativeTag.lengthOfByteString,
    IRNativeTag.equalsByteString,
    IRNativeTag.lessThanByteString,
    IRNativeTag.lessThanEqualsByteString,
    IRNativeTag.sha2_256,
    IRNativeTag.sha3_256,
    IRNativeTag.blake2b_256,
    IRNativeTag.blake2b_224,
    IRNativeTag.keccak_256,
    IRNativeTag.ripemd_160,
    IRNativeTag.appendString,
    IRNativeTag.equalsString,
    IRNativeTag.encodeUtf8,
    IRNativeTag.strictIfThenElse,
    IRNativeTag.fstPair,
    IRNativeTag.sndPair,
    IRNativeTag.mkCons,
    IRNativeTag.nullList,
    IRNativeTag.chooseUnit,
    IRNativeTag.constrData,
    IRNativeTag.mapData,
    IRNativeTag.listData,
    IRNativeTag.iData,
    IRNativeTag.bData,
    IRNativeTag.equalsData,
    IRNativeTag.serialiseData,
    IRNativeTag.mkPairData,
    IRNativeTag.mkNilData,
    IRNativeTag.mkNilPairData,
].filter( t => typeof t === "number" ));

/** hash-grade work: floating one of these out of a per-element closure is a real win */
const EXPENSIVE_NATIVE_TAGS: ReadonlySet<number> = new Set<number>([
    IRNativeTag.sha2_256,
    IRNativeTag.sha3_256,
    IRNativeTag.blake2b_256,
    IRNativeTag.blake2b_224,
    IRNativeTag.keccak_256,
    IRNativeTag.ripemd_160,
    IRNativeTag.serialiseData,
].filter( t => typeof t === "number" ));

function spineHead( term: IRTerm ): { head: IRTerm, args: IRTerm[] } {
    // built with `push` + a single `reverse` rather than `unshift` per
    // argument: `unshift` moves the whole array each time, making spine
    // collection quadratic in the spine length (and spines grow with the
    // program, so this showed up as super-linear compile work).
    const args: IRTerm[] = [];
    let head: IRTerm = term;
    while( head instanceof IRApp ) {
        args.push( head.arg );
        head = head.fn;
    }
    args.reverse();
    return { head, args };
}

function unwrapValueLike( t: IRTerm ): IRTerm {
    while( t instanceof IRLetted || t instanceof IRHoisted )
        t = t instanceof IRLetted ? t.value : t.hoisted;
    return t;
}

/**
 * compile-time value of an integer expression built from constants and
 * total integer arithmetic (named consts arrive as `IRLetted( ... )` and
 * derived consts as applications, e.g. `CHUNK_SIZE = LINE_LENGTH * 8`).
 * `undefined` when the value cannot be known at compile time.
 */
function comptimeInt( term: IRTerm ): bigint | undefined {
    const t = unwrapValueLike( term );
    if( t instanceof IRConst && typeof t.value === "bigint" ) return t.value;
    if( t instanceof IRApp ) {
        const { head, args } = spineHead( t );
        const h = unwrapValueLike( head );
        if( h instanceof IRNative && args.length === 2 ) {
            const a = comptimeInt( args[0] );
            if( a === undefined ) return undefined;
            const b = comptimeInt( args[1] );
            if( b === undefined ) return undefined;
            switch( h.tag ) {
                case IRNativeTag.addInteger: return a + b;
                case IRNativeTag.subtractInteger: return a - b;
                case IRNativeTag.multiplyInteger: return a * b;
                // division on constants is comptime-computable when the
                // divisor is provably non-zero (`CHUNK_SIZE / 2` — BUG 24)
                case IRNativeTag.divideInteger: {
                    if( b === BigInt(0) ) return undefined;
                    let q = a / b; // bigint division truncates
                    if( ( a % b ) !== BigInt(0) && ( a < BigInt(0) ) !== ( b < BigInt(0) ) )
                        q -= BigInt(1); // divideInteger floors
                    return q;
                }
                case IRNativeTag.quotientInteger:
                    return b === BigInt(0) ? undefined : a / b;
                case IRNativeTag.modInteger: {
                    if( b === BigInt(0) ) return undefined;
                    const m = a % b;
                    return m !== BigInt(0) && ( a < BigInt(0) ) !== ( b < BigInt(0) ) ? m + b : m;
                }
                case IRNativeTag.remainderInteger:
                    return b === BigInt(0) ? undefined : a % b;
            }
        }
    }
    return undefined;
}

/**
 * `true` if evaluating `term` can NEVER fail (it may still cost budget).
 *
 * Used to decide whether a letted binding may be FLOATED OUT of a lambda /
 * loop body: evaluating it eagerly (possibly more often than the closure
 * would have, e.g. zero times) must not introduce a crash that the lazy
 * placement would have avoided.
 *
 * KNOWN OVER-APPROXIMATION (higher-order redexes): the walk pushes a
 * redex's body and args separately without substituting, so an argument
 * that is itself a closure is treated as an unapplied "never runs" value.
 * A loop is a fixpoint `(λrecBody. … recBody …) loopBodyFunc`, so a loop
 * CALL is reported total even when its body can fail. Do NOT rely on this
 * predicate to prove a loop call's totality (that mistake let dead-code
 * elimination delete a whole ownership-check loop — masterpiece BUG 26,
 * fixed at the source in `expressify`'s bare-loop lowering instead).
 * Tightening it here is unsafe for PERFORMANCE: `const`s whose value is a
 * recursive helper call would stop floating out of closures and be
 * re-evaluated per call — the BUG 16 / BUG 24 compute-once regressions.
 */
export function isSafeToEagerlyEvaluate( term: IRTerm ): boolean {
    const stack: IRTerm[] = [ term ];
    while( stack.length > 0 )
    {
        let t = unwrapValueLike( stack.pop()! );

        if(
            t instanceof IRConst
            || t instanceof IRVar
            || t instanceof IRSelfCall
            // unapplied values: never evaluated here
            || t instanceof IRFunc
            || t instanceof IRDelayed
            || t instanceof IRRecursive
            || t instanceof IRNative // a builtin VALUE (not applied)
        ) continue;

        if( t instanceof IRForced ) {
            const inner = unwrapValueLike( t.forced );
            // pre-forced builtin value convention
            if( inner instanceof IRNative && isForcedNativeTag( inner.tag ) ) continue;
            if( inner instanceof IRDelayed ) { stack.push( inner.delayed ); continue; }
            return false; // forcing anything else: unknown
        }

        if( t instanceof IRConstr ) { stack.push( ...t.children() ); continue; }

        if( t instanceof IRCase ) {
            // branch selection is unknown -> require everything safe
            stack.push( ...t.children() );
            continue;
        }

        if( t instanceof IRApp ) {
            const { head, args } = spineHead( t );
            const h = unwrapValueLike( head );
            const hInner = h instanceof IRForced ? unwrapValueLike( h.forced ) : h;
            if( hInner instanceof IRNative ) {
                if( hInner.tag < 0 ) return false; // custom natives may hide partial builtins
                if( !TOTAL_NATIVE_TAGS.has( hInner.tag ) ) {
                    // special case: replicateByte with comptime in-range args
                    // (`comptimeInt` sees through letted consts and const
                    // arithmetic, e.g. `replicateByte( LINE_LENGTH * 8, 255 )`)
                    // integer division is total when the divisor is a
                    // comptime non-zero constant (`CHUNK_SIZE / 2` — BUG 24)
                    if(
                        ( hInner.tag === IRNativeTag.divideInteger
                        || hInner.tag === IRNativeTag.quotientInteger
                        || hInner.tag === IRNativeTag.modInteger
                        || hInner.tag === IRNativeTag.remainderInteger
                        )
                        && args.length === 2
                    ) {
                        const d = comptimeInt( args[1] );
                        if( d !== undefined && d !== BigInt(0) ) {
                            stack.push( args[0] );
                            continue;
                        }
                        return false;
                    }
                    if( hInner.tag === IRNativeTag.replicateByte && args.length === 2 ) {
                        const n = comptimeInt( args[0] );
                        const w = n === undefined ? undefined : comptimeInt( args[1] );
                        if(
                            n !== undefined && n >= BigInt(0) && n <= BigInt(8192)
                            && w !== undefined && w >= BigInt(0) && w <= BigInt(255)
                        ) continue; // args are consts + total arithmetic by construction
                    }
                    return false;
                }
                stack.push( ...args );
                continue;
            }
            if( hInner instanceof IRFunc || hInner instanceof IRRecursive ) {
                // beta redex: the body runs with the given args
                stack.push( hInner instanceof IRFunc ? hInner.body : hInner.body, ...args );
                continue;
            }
            return false; // unknown function (variable-headed application etc.)
        }

        // IRError and anything unrecognized
        return false;
    }
    return true;
}

/**
 * `true` if `term` performs hash-grade work somewhere — the only case where
 * floating a binding out of a closure is worth perturbing placement for.
 */
export function containsExpensiveWork( term: IRTerm ): boolean {
    const stack: IRTerm[] = [ term ];
    while( stack.length > 0 )
    {
        const t = unwrapValueLike( stack.pop()! );
        if( t instanceof IRNative && EXPENSIVE_NATIVE_TAGS.has( t.tag ) ) return true;
        if( typeof (t as any).children === "function" ) stack.push( ...(t as any).children() );
    }
    return false;
}
