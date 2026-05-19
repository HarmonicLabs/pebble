import { IRApp, _ir_apps } from "../../../IRNodes/IRApp";
import { IRCase } from "../../../IRNodes/IRCase";
import { IRConst } from "../../../IRNodes/IRConst";
import { IRError } from "../../../IRNodes/IRError";
import { IRFunc } from "../../../IRNodes/IRFunc";
import { IRNative } from "../../../IRNodes/IRNative";
import { rewriteNativesAppliedToConstantsAndReturnRoot } from "../rewriteNativesAppliedToConstantsAndReturnRoot";
import { rewriteToCaseOverConstAndReturnRoot } from "../rewriteToCaseOverConstAndReturnRoot";

describe("rewriteToCaseOverConstAndReturnRoot", () => {

    test("strictIfThenElse(cond, then, else)  →  Case(cond, [else, then])", () => {
        const cond  = IRConst.bool( true );
        const then_ = IRConst.int( 1 );
        const else_ = IRConst.int( 2 );

        const root = _ir_apps(
            IRNative.strictIfThenElse,
            cond.clone(),
            then_.clone(),
            else_.clone(),
        );

        const out = rewriteToCaseOverConstAndReturnRoot( root );

        expect( out ).toBeInstanceOf( IRCase );
        const c = out as IRCase;
        expect( c.constrTerm ).toBeInstanceOf( IRConst );
        // continuations[0] is the FALSE branch (constr index 0), then TRUE
        expect( c.continuations.length ).toBe( 2 );
        expect( c.continuations[0]!.toJSON() ).toEqual( else_.toJSON() );
        expect( c.continuations[1]!.toJSON() ).toEqual( then_.toJSON() );
    });

    test("trailing IRError continuations are pruned", () => {
        const scrutinee = IRConst.int( 0 );
        const root = new IRCase(
            scrutinee.clone(),
            [ IRConst.int( 10 ), IRConst.int( 20 ), new IRError(), new IRError() ]
        );

        const out = rewriteToCaseOverConstAndReturnRoot( root );

        expect( out ).toBeInstanceOf( IRCase );
        const c = out as IRCase;
        expect( c.continuations.length ).toBe( 2 );
    });

    test("strictChooseList(list, nil, cons)  →  Case(list, [(λh λt → cons), nil])", () => {
        // The strictChooseList → IRCase rewrite now lives in
        // rewriteNativesAppliedToConstantsAndReturnRoot (unconditional, not V4-gated).
        const list = IRConst.listOf( {
            toUplcConstType: () => [ 0 ] as any,
        } as any )( [] as any );
        const caseNil  = IRConst.int( 100 );
        const caseCons = IRConst.int( 200 );

        const root = _ir_apps(
            IRNative.strictChooseList,
            list.clone(),
            caseNil.clone(),
            caseCons.clone(),
        );

        const out = rewriteNativesAppliedToConstantsAndReturnRoot( root );

        expect( out ).toBeInstanceOf( IRCase );
        const c = out as IRCase;
        expect( c.continuations.length ).toBe( 2 );
        expect( c.continuations[0] ).toBeInstanceOf( IRFunc );
        expect( ( c.continuations[0] as IRFunc ).arity ).toBe( 2 );
        expect( c.continuations[1]!.toJSON() ).toEqual( caseNil.toJSON() );
    });

    test("strictChooseList with IRError nil prunes the nil branch", () => {
        const list = IRConst.listOf( {
            toUplcConstType: () => [ 0 ] as any,
        } as any )( [] as any );
        const caseCons = IRConst.int( 200 );

        const root = _ir_apps(
            IRNative.strictChooseList,
            list.clone(),
            new IRError(),
            caseCons.clone(),
        );

        // First pass converts to IRCase, second pass prunes the trailing IRError.
        const afterConversion = rewriteNativesAppliedToConstantsAndReturnRoot( root );
        const out = rewriteToCaseOverConstAndReturnRoot( afterConversion );

        expect( out ).toBeInstanceOf( IRCase );
        const c = out as IRCase;
        // trailing IRError nil branch dropped → only the cons λ remains
        expect( c.continuations.length ).toBe( 1 );
        expect( c.continuations[0] ).toBeInstanceOf( IRFunc );
    });

    test("non-trailing IRError is preserved", () => {
        const scrutinee = IRConst.int( 0 );
        const root = new IRCase(
            scrutinee.clone(),
            [ new IRError(), IRConst.int( 20 ) ]
        );

        const out = rewriteToCaseOverConstAndReturnRoot( root );

        expect( out ).toBeInstanceOf( IRCase );
        const c = out as IRCase;
        // not pruned: first branch error, second non-error => keep both
        expect( c.continuations.length ).toBe( 2 );
    });

});
