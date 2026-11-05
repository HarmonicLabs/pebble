import { IRApp, _ir_apps } from "../../../IRNodes/IRApp";
import { IRConst } from "../../../IRNodes/IRConst";
import { IRFunc } from "../../../IRNodes/IRFunc";
import { IRNative } from "../../../IRNodes/IRNative";
import { IRVar } from "../../../IRNodes/IRVar";
import { CompilationCtx, withCompilationCtx } from "../../../CompilationCtx";
import { irMeta } from "../../../sourceMap/irRanges";
import { freeSymbols, StrippedTrace } from "../../../sourceMap/irTraces";
import { defaultOptions } from "../../CompilerOptions";
import { performUplcOptimizationsAndReturnRoot } from "../performUplcOptimizationsAndReturnRoot/performUplcOptimizationsAndReturnRoot";

/**
 * `[(λx. x) arg]` becomes `arg`. The body, a use of `arg`, may carry a removed trace reading `x`
 * (`trace x;` where a letted value is bound and returned): it was dropped with the body. It goes
 * to `arg`, as a copy of the trace computing `x` from `arg` (`StrippedTrace.of`).
 */
test("an identity binding's removed trace reading its parameter goes to the argument", () => {
    const ctx = new CompilationCtx();
    ctx.strippedTraces = [];
    withCompilationCtx( ctx, () => {
        const x = Symbol("x"), y = Symbol("y");
        // the message: the variable it reads
        const recipeBody = new IRVar( x );
        ctx.strippedTraces!.push({ kind: "trace", range: undefined, expression: "x", recipe: { ir: new IRFunc( [ x ], recipeBody ), params: [ x ] } } as StrippedTrace );
        const body = new IRVar( x );
        irMeta( body ).tracePoints = [ { trace: 0, when: 0 } ];
        // λy. [(λx. x) (y + 1)]
        const arg = _ir_apps( IRNative.addInteger, new IRVar( y ), IRConst.int( 1 ) );
        const root = new IRFunc( [ y ], new IRApp( new IRFunc( [ x ], body ), arg ) );

        const out = performUplcOptimizationsAndReturnRoot( root, defaultOptions as any ) as IRFunc;
        expect( out.body ).toBe( arg );
        const points = irMeta( arg ).tracePoints ?? [];
        expect( points ).toHaveLength( 1 );
        const copy = ctx.strippedTraces![ points[0].trace ];
        expect( copy.of ).toBe( 0 );
        // computed from `y`, which the place has
        expect( copy.recipe!.params ).toEqual([ y ]);
        expect( freeSymbols( copy.recipe!.ir ) ).toEqual( [] );
    });
});
