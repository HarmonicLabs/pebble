import { Source, SourceKind } from "../../../../ast/Source/Source";
import { SourceRange } from "../../../../ast/Source/SourceRange";
import { IRApp, _ir_apps } from "../../../IRNodes/IRApp";
import { IRConst } from "../../../IRNodes/IRConst";
import { IRDelayed } from "../../../IRNodes/IRDelayed";
import { IRError } from "../../../IRNodes/IRError";
import { IRFunc } from "../../../IRNodes/IRFunc";
import { IRNative } from "../../../IRNodes/IRNative";
import { IRVar } from "../../../IRNodes/IRVar";
import type { IRTerm } from "../../../IRTerm";
import { irMeta } from "../../../sourceMap/irRanges";
import { getApplicationTerms } from "../../utils/getApplicationTerms";
import { rewriteNativesAppliedToConstantsAndReturnRoot } from "../rewriteNativesAppliedToConstantsAndReturnRoot";

/**
 * `rewriteNativesAppliedToConstantsAndReturnRoot` rebuilds the condition of an if-then-else
 * comparing with a constant (to share the builtin applied to it). The rebuilt condition stands
 * for the source the old one stood for: it used to lose its range, the assert it is the
 * condition of, and the removed traces printed with it.
 */

const source = new Source( SourceKind.User, "main.pebble", "main", "assert x > 10 else \"no\";" );
const assertRange = new SourceRange( source, 0, 24 );
const condRange = new SourceRange( source, 7, 13 );

/**
 * `λx. if cond then 1 else error`, with `cond` (built from `x`) an assert's condition that
 * prints a removed trace when false (trace 0) and one whatever its value (trace 1)
 */
function assertLike( mkCond: ( x: IRTerm ) => IRTerm ): IRTerm
{
    const x = Symbol("x");
    const cond = mkCond( new IRVar( x ) );
    const meta = irMeta( cond );
    meta.range = condRange;
    meta.assertCond = assertRange;
    meta.tracePoints = [ { trace: 0, when: 1 }, { trace: 1, when: 0 } ];
    return new IRFunc( [ x ], _ir_apps(
        IRNative.strictIfThenElse,
        cond,
        new IRDelayed( IRConst.int( 1 ) ),
        new IRDelayed( new IRError() )
    ));
}

/** the condition of the if-then-else in `root` (a function of `x`) after the pass */
function conditionAfterPass( root: IRTerm ): IRTerm
{
    const out = rewriteNativesAppliedToConstantsAndReturnRoot( root ) as IRFunc;
    const app = getApplicationTerms( out.body )!;
    expect( app.args.length ).toBe( 3 );
    return app.args[0];
}

describe("rewriteNativesAppliedToConstants: a rebuilt condition keeps what it stood for", () => {

    test("`10 < x`, rebuilt with `lessThanInteger 10` shared: the same value, every marker", () => {
        const cond = conditionAfterPass( assertLike( x => _ir_apps( IRNative.lessThanInteger, IRConst.int( 10 ), x ) ) );
        expect( cond ).toBeInstanceOf( IRApp );
        const meta = irMeta( cond );
        expect( meta.range ).toBe( condRange );
        expect( meta.assertCond ).toBe( assertRange );
        expect( meta.tracePoints ).toEqual([ { trace: 0, when: 1 }, { trace: 1, when: 0 } ]);
    });

    test("`x < 20`, rebuilt as `20 <= x` with the branches swapped: the assert's condition, negated", () => {
        const cond = conditionAfterPass( assertLike( x => _ir_apps( IRNative.lessThanInteger, x, IRConst.int( 20 ) ) ) );
        const meta = irMeta( cond );
        expect( meta.range ).toBe( condRange );
        // true when the assert fails
        expect( meta.assertCond ).toBe( assertRange );
        expect( meta.assertNegated ).toBe( true );
        expect( meta.tracePoints ).toEqual([ { trace: 0, when: 4 }, { trace: 1, when: 0 } ]);
    });

    test("`!b`, rebuilt as `b` with the branches swapped: negated", () => {
        const cond = conditionAfterPass( assertLike( b => _ir_apps( IRNative._not, b ) ) );
        expect( cond ).toBeInstanceOf( IRVar );
        const meta = irMeta( cond );
        expect( meta.assertCond ).toBe( assertRange );
        expect( meta.assertNegated ).toBe( true );
        expect( meta.tracePoints ).toEqual([ { trace: 0, when: 4 }, { trace: 1, when: 0 } ]);
    });

    test("`!( x < 20 )`: two swaps, the condition as it was", () => {
        const cond = conditionAfterPass( assertLike( x => _ir_apps( IRNative._not, _ir_apps( IRNative.lessThanInteger, x, IRConst.int( 20 ) ) ) ) );
        const meta = irMeta( cond );
        expect( meta.assertCond ).toBe( assertRange );
        expect( meta.assertNegated ).toBeUndefined();
        expect( meta.tracePoints ).toEqual([ { trace: 0, when: 1 }, { trace: 1, when: 0 } ]);
    });
});
