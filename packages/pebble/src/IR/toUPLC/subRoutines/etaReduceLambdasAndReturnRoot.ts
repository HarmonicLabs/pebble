import { IRApp } from "../../IRNodes/IRApp";
import { IRConst } from "../../IRNodes/IRConst";
import { IRFunc } from "../../IRNodes/IRFunc";
import { IRHoisted } from "../../IRNodes/IRHoisted";
import { IRNative } from "../../IRNodes/IRNative";
import { IRNativeTag } from "../../IRNodes/IRNative/IRNativeTag";
import { IRVar } from "../../IRNodes/IRVar";
import { IRTerm } from "../../IRTerm";
import { _modifyChildFromTo } from "../_internal/_modifyChildFromTo";
import { iterTree } from "../_internal/iterTree";

/**
 * Eta-reduce single-parameter lambdas into (partial) applications:
 *
 * 1. `\x -> f x`            ⟶ `f`                    (x not free in `f`)
 * 2. `\x -> op x captured`  ⟶ `op captured`          (op COMMUTATIVE)
 *
 * so a predicate closure like
 *
 * ```pebble
 * const isGreenEpoch = (e: int) => e == effectiveCurrEpoch;
 * ```
 *
 * compiles to the partial builtin application
 * `equalsInteger effectiveCurrEpoch` instead of allocating a closure per
 * evaluation — smaller, cheaper, and one less capture for the letted
 * machinery to place.
 *
 * SAFETY: the reduced form evaluates `f` / `captured` where the lambda was
 * BUILT instead of on every call, so both are restricted to terms whose
 * eager evaluation is free of effects and cheap:
 * - a variable, a constant, a hoisted value;
 * - an UNDER-saturated application of a whitelisted pure builtin to such
 *   values (a partial application is a value — nothing runs).
 */
export function etaReduceLambdasAndReturnRoot( term: IRTerm ): IRTerm
{
    let changed = true;
    while( changed )
    {
        changed = false;
        iterTree( term, ( node ) => {
            if( !( node instanceof IRFunc ) || node.params.length !== 1 ) return undefined;
            if( node.parent === undefined ) return undefined; // keep the root shape
            const param = node.params[0];
            const body = node.body;

            if( !( body instanceof IRApp ) ) return undefined;

            // 1. `\x -> f x` ⟶ `f`
            if(
                body.arg instanceof IRVar
                && body.arg.name === param
                && isEagerSafeValue( body.fn )
                && !referencesVar( body.fn, param )
            )
            {
                _modifyChildFromTo( node.parent, node, body.fn );
                changed = true;
                return true;
            }

            // 2. `\x -> op x captured` ⟶ `op captured` (commutative op)
            if(
                body.fn instanceof IRApp
                && body.fn.fn instanceof IRNative
                && commutativeBinaryNatives.has( body.fn.fn.tag )
                && body.fn.arg instanceof IRVar
                && body.fn.arg.name === param
                && isEagerSafeValue( body.arg )
                && !referencesVar( body.arg, param )
            )
            {
                _modifyChildFromTo(
                    node.parent,
                    node,
                    new IRApp( new IRNative( body.fn.fn.tag ), body.arg )
                );
                changed = true;
                return true;
            }

            return undefined;
        });
    }
    return term;
}

/** commutative BINARY builtins: `op x y === op y x` */
const commutativeBinaryNatives: ReadonlySet<IRNativeTag> = new Set([
    IRNativeTag.addInteger,
    IRNativeTag.multiplyInteger,
    IRNativeTag.equalsInteger,
    IRNativeTag.equalsByteString,
    IRNativeTag.equalsString,
    IRNativeTag.equalsData,
]);

/**
 * pure builtins usable as the head of an under-saturated application in an
 * eta-reduced position (arity recorded to guarantee UNDER-saturation:
 * a partial application is a value; a saturated one would RUN eagerly)
 */
const pureNativeArity: ReadonlyMap<IRNativeTag, number> = new Map<IRNativeTag, number>([
    [ IRNativeTag.addInteger, 2 ],
    [ IRNativeTag.subtractInteger, 2 ],
    [ IRNativeTag.multiplyInteger, 2 ],
    [ IRNativeTag.equalsInteger, 2 ],
    [ IRNativeTag.lessThanInteger, 2 ],
    [ IRNativeTag.lessThanEqualInteger, 2 ],
    [ IRNativeTag.appendByteString, 2 ],
    [ IRNativeTag.equalsByteString, 2 ],
    [ IRNativeTag.lessThanByteString, 2 ],
    [ IRNativeTag.lessThanEqualsByteString, 2 ],
    [ IRNativeTag.appendString, 2 ],
    [ IRNativeTag.equalsString, 2 ],
    [ IRNativeTag.equalsData, 2 ],
]);

/** value-position terms whose eager evaluation cannot run user code */
function isEagerSafeValue( t: IRTerm ): boolean
{
    if(
        t instanceof IRVar
        || t instanceof IRConst
        || t instanceof IRHoisted
    ) return true;

    // under-saturated application of a whitelisted pure builtin
    let nArgs = 0;
    let head: IRTerm = t;
    while( head instanceof IRApp )
    {
        if( !isEagerSafeValue( head.arg ) ) return false;
        nArgs++;
        head = head.fn;
    }
    if( !( head instanceof IRNative ) ) return false;
    const arity = pureNativeArity.get( head.tag );
    return typeof arity === "number" && nArgs < arity;
}

function referencesVar( t: IRTerm, sym: symbol ): boolean
{
    let found = false;
    iterTree( t, ( node ) => {
        if( node instanceof IRVar && node.name === sym ) found = true;
        return undefined;
    });
    return found;
}
