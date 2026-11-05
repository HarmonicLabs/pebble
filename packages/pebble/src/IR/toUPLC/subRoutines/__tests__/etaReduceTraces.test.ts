import { IRApp, _ir_apps } from "../../../IRNodes/IRApp";
import { IRConst } from "../../../IRNodes/IRConst";
import { IRFunc } from "../../../IRNodes/IRFunc";
import { IRNative } from "../../../IRNodes/IRNative";
import { IRVar } from "../../../IRNodes/IRVar";
import { irMeta } from "../../../sourceMap/irRanges";
import { etaReduceLambdasAndReturnRoot } from "../etaReduceLambdasAndReturnRoot";

/**
 * `etaReduceLambdasAndReturnRoot` drops a lambda's body (`λx. 2 * x` becomes `multiplyInteger 2`);
 * the removed traces that ran with the body, on each call, run when the reduced value is
 * applied (`when` 5; `6` for a trace of the value it returned), the parameter being the value
 * it is applied to. They were dropped with the body.
 */
describe("etaReduceLambdasAndReturnRoot: the traces of the body it drops", () => {

    test.each([
        [ 0, 5 ],
        [ 3, 6 ],
    ] as const )( "a `when` %d point on the body becomes `when` %d on the reduced value", ( when, reducedWhen ) => {
        const x = Symbol("x");
        const body = _ir_apps( IRNative.multiplyInteger, new IRVar( x ), IRConst.int( 2 ) );
        irMeta( body ).tracePoints = [ { trace: 0, when } ];
        const lambda = new IRFunc( [ x ], body );
        const root = new IRFunc( [ Symbol("y") ], new IRApp( lambda, IRConst.int( 21 ) ) );

        const out = etaReduceLambdasAndReturnRoot( root ) as IRFunc;
        const reduced = ( out.body as IRApp ).fn;
        expect( reduced ).toBeInstanceOf( IRApp );
        expect( irMeta( reduced ).tracePoints ).toEqual([ { trace: 0, when: reducedWhen, applied: x } ]);
    });
});
