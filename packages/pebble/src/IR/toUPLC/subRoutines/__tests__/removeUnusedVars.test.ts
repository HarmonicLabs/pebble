import { Machine } from "@harmoniclabs/plutus-machine";
import { IRApp, _ir_apps } from "../../../IRNodes/IRApp";
import { IRCase } from "../../../IRNodes/IRCase";
import { IRConst } from "../../../IRNodes/IRConst";
import { IRConstr } from "../../../IRNodes/IRConstr";
import { IRFunc } from "../../../IRNodes/IRFunc";
import { IRNative } from "../../../IRNodes/IRNative";
import { IRVar } from "../../../IRNodes/IRVar";
import type { IRTerm } from "../../../IRTerm";
import { compileIRToUPLC } from "../../compileIRToUPLC";
import { getApplicationTerms } from "../../utils/getApplicationTerms";
import { removeUnusedVarsAndReturnRoot } from "../removeUnusedVarsAndReturnRoot/removeUnusedVarsAndReturnRoot";

/**
 * `removeUnusedVarsAndReturnRoot` on applications whose number of arguments differs from the
 * number of parameters of the function applied. Both are ordinary IR: letted and hoisted values
 * are bound by nested functions, and a function returning a function gets the arguments of
 * both (over-application); a function may be passed applied to its first arguments only
 * (under-application).
 */

/** the integer `term` evaluates to */
function evalInt( term: IRTerm ): bigint
{
    const result = Machine.eval( compileIRToUPLC( term ) ).result as any;
    if( typeof result?.value !== "bigint" ) throw new Error( "not an integer: " + JSON.stringify( result, ( _, v ) => typeof v === "bigint" ? v.toString() : v ) );
    return result.value;
}

const add1 = ( t: IRTerm ) => _ir_apps( IRNative.addInteger, t, IRConst.int( 1 ) );

describe("removeUnusedVarsAndReturnRoot: arguments beyond the parameters", () => {

    test("an unused parameter of a function applied to more arguments than it has: the extra argument stays", () => {
        // [[(λa. λb. b + 1) 7] 41]: `a` is unused, `41` is the argument of the function `(λa. …)` returns
        const a = Symbol("a"), b = Symbol("b");
        const root = _ir_apps(
            new IRFunc( [ a ], new IRFunc( [ b ], add1( new IRVar( b ) ) ) ),
            IRConst.int( 7 ),
            IRConst.int( 41 )
        );
        const out = removeUnusedVarsAndReturnRoot( root.clone() );
        // `(λb. b + 1) 41`: the unused binding is gone, the argument of the inner function is not
        expect( out ).toBeInstanceOf( IRApp );
        const app = getApplicationTerms( out )!;
        expect( app.func ).toBeInstanceOf( IRFunc );
        expect( ( app.func as IRFunc ).params ).toEqual([ b ]);
        expect( app.args.length ).toBe( 1 );
        expect( evalInt( out ) ).toBe( BigInt( 42 ) );
        expect( evalInt( root.clone() ) ).toBe( BigInt( 42 ) );
    });

    test("a used parameter and an extra argument: both arguments stay", () => {
        // [[(λa. λb. a + b) 40] 2]
        const a = Symbol("a"), b = Symbol("b");
        const root = _ir_apps(
            new IRFunc( [ a ], new IRFunc( [ b ], _ir_apps( IRNative.addInteger, new IRVar( a ), new IRVar( b ) ) ) ),
            IRConst.int( 40 ),
            IRConst.int( 2 )
        );
        expect( evalInt( removeUnusedVarsAndReturnRoot( root.clone() ) ) ).toBe( BigInt( 42 ) );
    });

    test("the extra argument's own variables are counted as uses", () => {
        // (λx. [[(λa. λb. b + 1) 7] x]) 41: `x` is used only by the extra argument
        const x = Symbol("x"), a = Symbol("a"), b = Symbol("b");
        const root = new IRApp(
            new IRFunc( [ x ], _ir_apps(
                new IRFunc( [ a ], new IRFunc( [ b ], add1( new IRVar( b ) ) ) ),
                IRConst.int( 7 ),
                new IRVar( x )
            )),
            IRConst.int( 41 )
        );
        expect( evalInt( removeUnusedVarsAndReturnRoot( root.clone() ) ) ).toBe( BigInt( 42 ) );
    });
});

describe("removeUnusedVarsAndReturnRoot: a function applied to its first arguments only", () => {

    test("an unused parameter without an argument stays: the partial application keeps its arity", () => {
        // (λh. h 0) [(λa b. a) 42]: `(λa b. a) 42` is a function of `b`
        const h = Symbol("h"), a = Symbol("a"), b = Symbol("b");
        const root = new IRApp(
            new IRFunc( [ h ], new IRApp( new IRVar( h ), IRConst.int( 0 ) ) ),
            new IRApp( new IRFunc( [ a, b ], new IRVar( a ) ), IRConst.int( 42 ) )
        );
        expect( evalInt( removeUnusedVarsAndReturnRoot( root.clone() ) ) ).toBe( BigInt( 42 ) );
    });

    test("an unused parameter with an argument goes, the parameters after it stay", () => {
        // (λh. h 41) [(λa b. b + 1) 7]
        const h = Symbol("h"), a = Symbol("a"), b = Symbol("b");
        const root = new IRApp(
            new IRFunc( [ h ], new IRApp( new IRVar( h ), IRConst.int( 41 ) ) ),
            new IRApp( new IRFunc( [ a, b ], add1( new IRVar( b ) ) ), IRConst.int( 7 ) )
        );
        expect( evalInt( removeUnusedVarsAndReturnRoot( root.clone() ) ) ).toBe( BigInt( 42 ) );
    });
});

describe("getApplicationTerms", () => {

    test("an application of a `case` applying a function: the case's arguments come first", () => {
        // [(case (constr 0 [x y]) [f]) z] is f x y z
        const f = new IRVar( Symbol("f") );
        const [ x, y, z ] = [ IRConst.int( 1 ), IRConst.int( 2 ), IRConst.int( 3 ) ];
        const app = getApplicationTerms( new IRApp( new IRCase( new IRConstr( 0, [ x, y ] ), [ f ] ), z ) )!;
        expect( app.func ).toBe( f );
        expect( app.args ).toEqual([ x, y, z ]);
    });

    test("a `case` applying an application: the application's arguments come first", () => {
        // (case (constr 0 [z]) [[f x]]) is f x z
        const f = new IRVar( Symbol("f") );
        const [ x, z ] = [ IRConst.int( 1 ), IRConst.int( 3 ) ];
        const app = getApplicationTerms( new IRCase( new IRConstr( 0, [ z ] ), [ new IRApp( f, x ) ] ) )!;
        expect( app.func ).toBe( f );
        expect( app.args ).toEqual([ x, z ]);
    });
});
