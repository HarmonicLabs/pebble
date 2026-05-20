import { IRApp, _ir_apps } from "../../../IRNodes/IRApp";
import { IRCase } from "../../../IRNodes/IRCase";
import { IRConst } from "../../../IRNodes/IRConst";
import { IRError } from "../../../IRNodes/IRError";
import { IRFunc } from "../../../IRNodes/IRFunc";
import { IRNative } from "../../../IRNodes/IRNative";
import { IRRecursive } from "../../../IRNodes/IRRecursive";
import { IRVar } from "../../../IRNodes/IRVar";
import type { IRTerm } from "../../../IRTerm";
import { inlineSingleUseLetBindingsAndReturnRoot } from "../inlineSingleUseLetBindingsAndReturnRoot";

/**
 * IR-level unit tests for the single-use let inliner.
 *
 * These build minimal synthetic IR trees that exercise each branch of
 * the inliner's decision logic, then check the structural outcome —
 * not the CEK budget. (Pebble's `IRLetted` hash-based deduplication
 * makes some cost-level comparisons indistinguishable from CSE, which
 * obscures whether *this* pass acted.)
 *
 * Convention used throughout:
 *   `letApp(p, value, body)` builds `((λp. body) value)`.
 *   We then run the pass and assert whether the resulting tree still
 *   has the let-binding lambda or has been collapsed via inlining.
 */

function letApp( p: symbol, value: IRTerm, body: IRTerm ): IRApp
{
    return new IRApp( new IRFunc( [ p ], body ), value );
}

function isLetApp( term: IRTerm, p: symbol ): boolean
{
    return (
        term instanceof IRApp
        && term.fn instanceof IRFunc
        && term.fn.params.length === 1
        && term.fn.params[0] === p
    );
}

describe("inlineSingleUseLetBindings", () => {

    test("scenario 1: single use in same body → INLINED", () => {
        // ((λp. addInt p 0) 42)   →   (addInt 42 0)
        const p = Symbol("p");
        const value = IRConst.int( 42n );
        const body = _ir_apps(
            IRNative.addInteger,
            new IRVar( p ),
            IRConst.int( 0n )
        );
        const root = letApp( p, value, body );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        // Top-level should no longer be the (λp. …) wrapper.
        expect( isLetApp( out, p ) ).toBe( false );
        // No IRVar(p) should remain (the single use was substituted).
        expect( containsVar( out, p ) ).toBe( false );
    });

    test("scenario 2: two uses → NOT inlined (let preserved)", () => {
        // ((λp. addInt p p) 42)
        const p = Symbol("p");
        const value = IRConst.int( 42n );
        const body = _ir_apps(
            IRNative.addInteger,
            new IRVar( p ),
            new IRVar( p )
        );
        const root = letApp( p, value, body );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        // Let-binding must be preserved.
        expect( isLetApp( out, p ) ).toBe( true );
        // Both IRVar(p) references must remain.
        expect( countVar( out, p ) ).toBe( 2 );
    });

    test("scenario 3: zero uses → DEAD let dropped, value discarded", () => {
        // ((λp. 7) 42)   →   7
        const p = Symbol("p");
        const value = IRConst.int( 42n );
        const body = IRConst.int( 7n );
        const root = letApp( p, value, body );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        expect( out instanceof IRConst ).toBe( true );
        expect( ( out as IRConst ).value ).toBe( 7n );
    });

    test("scenario 4a: single use trapped inside IRRecursive, value is COMPUTATION → NOT inlined", () => {
        // ((λp. recursive_loop_uses_p_once) (someApp))
        // The arg `someApp` is a computation; inlining it into the
        // recursive body would re-execute per iteration. The inliner
        // must refuse.
        const p = Symbol("p");
        const self = Symbol("self");
        // A computation: an addInteger application — would re-run if
        // moved into the recursive body.
        const value = _ir_apps( IRNative.addInteger, IRConst.int( 7n ), IRConst.int( 35n ) );
        const body = new IRRecursive(
            self,
            new IRFunc(
                [ Symbol("loopParam") ],
                new IRVar( p )  // single syntactic use, but inside recursive body
            )
        );
        const root = letApp( p, value, body );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        expect( isLetApp( out, p ) ).toBe( true );
        expect( containsVar( out, p ) ).toBe( true );
    });

    test("scenario 4b: single use trapped inside IRRecursive, value is VALUE → INLINED", () => {
        // Same shape as 4a, but the bound value is now an `IRConst`.
        // Duplicating a constant into a recursive body is free
        // (per-iteration cost is the same `con int` push as a fresh
        // var lookup), so the inliner is allowed to substitute.
        const p = Symbol("p");
        const self = Symbol("self");
        const value = IRConst.int( 42n );
        const body = new IRRecursive(
            self,
            new IRFunc(
                [ Symbol("loopParam") ],
                new IRVar( p )
            )
        );
        const root = letApp( p, value, body );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        // Let-binding collapsed: the IRConst was substituted into the
        // recursive body in place of `p`.
        expect( isLetApp( out, p ) ).toBe( false );
        expect( containsVar( out, p ) ).toBe( false );
    });

    test("scenario 4c: trapped, value is a LAMBDA → INLINED (the `abs`-into-`ecd` case)", () => {
        // ((λp. recursive_body_uses_p_once) (λn. n)).
        // A bound lambda is a value; constructing the closure per
        // iteration costs ~one CEK step, and the lambda's BODY only
        // runs on application, which happens at the use-site
        // frequency either way. Mirrors the real-world Pebble case
        // of hoisting `abs` ahead of a recursive `ecd` that uses it.
        const p = Symbol("p");
        const self = Symbol("self");
        const n = Symbol("n");
        const value = new IRFunc( [ n ], new IRVar( n ) );  // λn. n
        const body = new IRRecursive(
            self,
            new IRFunc(
                [ Symbol("loopParam") ],
                new IRVar( p )
            )
        );
        const root = letApp( p, value, body );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        expect( isLetApp( out, p ) ).toBe( false );
        expect( containsVar( out, p ) ).toBe( false );
    });

    test("scenario 4d: trapped, value is a SELF-REFERENTIAL lambda → NOT inlined", () => {
        // The bound lambda contains a free `IRVar(p)` — Pebble's
        // open-recursion encoding for hoisted recursive helpers.
        // Inlining the lambda would remove the outer `λp.` that binds
        // the self-reference, orphaning it.
        const p = Symbol("p");
        const self = Symbol("self");
        const n = Symbol("n");
        // λn. p  — body refers back to its own binding name
        const value = new IRFunc( [ n ], new IRVar( p ) );
        const body = new IRRecursive(
            self,
            new IRFunc(
                [ Symbol("loopParam") ],
                new IRVar( p )
            )
        );
        const root = letApp( p, value, body );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        expect( isLetApp( out, p ) ).toBe( true );
    });

    test("scenario 5: trapped inside non-case-continuation IRFunc with VALUE → INLINED", () => {
        // ((λp. λq. p) (IRConst 42))
        // The inner λq is a non-case-cont closure (so `p` is trapped
        // under it). But the bound value is an `IRConst`, a syntactic
        // value, so duplicating it into the inner lambda is free.
        const p = Symbol("p");
        const q = Symbol("q");
        const value = IRConst.int( 42n );
        const body = new IRFunc( [ q ], new IRVar( p ) );
        const root = letApp( p, value, body );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        expect( isLetApp( out, p ) ).toBe( false );
        expect( containsVar( out, p ) ).toBe( false );
    });

    test("scenario 5b: trapped inside non-case-continuation IRFunc with COMPUTATION → NOT inlined", () => {
        // Same shape as 5, but value is a computation.
        const p = Symbol("p");
        const q = Symbol("q");
        const value = _ir_apps( IRNative.addInteger, IRConst.int( 1n ), IRConst.int( 2n ) );
        const body = new IRFunc( [ q ], new IRVar( p ) );
        const root = letApp( p, value, body );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        expect( isLetApp( out, p ) ).toBe( true );
    });

    test("scenario 6: single use inside IRCase continuation lambda → INLINED", () => {
        // The case-cons branch is an IRFunc but UPLC `case` dispatches
        // each branch at most once per case eval, so it's transparent.
        // ((λp. case scrutinee [(λh λt. p), error]) value)
        //   →  case scrutinee [(λh λt. value), error]
        const p = Symbol("p");
        const value = IRConst.int( 42n );
        const scrutinee = IRConst.listOf( {
            toUplcConstType: () => [ 0 ] as any,
        } as any )( [] as any );
        const h = Symbol("h");
        const t = Symbol("t");
        const body = new IRCase(
            scrutinee,
            [
                new IRFunc( [ h, t ], new IRVar( p ) ),
                new IRError()
            ]
        );
        const root = letApp( p, value, body );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        // Let-binding should be collapsed.
        expect( isLetApp( out, p ) ).toBe( false );
        expect( containsVar( out, p ) ).toBe( false );
        expect( out instanceof IRCase ).toBe( true );
    });

    test("scenario 7: defined inside recursive body, used once there → INLINED (same scope-frequency)", () => {
        // recursive_loop_body_contains:
        //     ((λp. addInt p 1) value)
        // Both the binding AND the use happen once per iteration.
        // The pass should walk the tree, find the IRApp deep inside,
        // and inline normally.
        const p = Symbol("p");
        const self = Symbol("self");
        const value = IRConst.int( 42n );
        const inner = letApp(
            p,
            value,
            _ir_apps( IRNative.addInteger, new IRVar( p ), IRConst.int( 1n ) )
        );
        const root = new IRRecursive(
            self,
            new IRFunc( [ Symbol("loopParam") ], inner )
        );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        // Walk to the inner body and check the let-binding was inlined
        // inside the recursive function.
        expect( out instanceof IRRecursive ).toBe( true );
        const fn = ( out as IRRecursive ).body;
        expect( fn instanceof IRFunc ).toBe( true );
        const inlinedInner = ( fn as IRFunc ).body;
        expect( isLetApp( inlinedInner, p ) ).toBe( false );
        expect( containsVar( inlinedInner, p ) ).toBe( false );
    });

    test("scenario 8a: nested recursive — let inside outer used in inner with COMPUTATION → NOT inlined", () => {
        // outer_recursive(
        //   λouterState. ((λp. inner_recursive(λinnerState. p)) (someApp))
        // )
        // `p` is bound INSIDE the outer recursive body but used INSIDE
        // a nested recursive (the inner loop). For a COMPUTATION
        // value, inlining would multiply the work by the inner-loop
        // iteration count — refuse.
        const p = Symbol("p");
        const outerSelf = Symbol("outerSelf");
        const innerSelf = Symbol("innerSelf");
        const value = _ir_apps( IRNative.addInteger, IRConst.int( 1n ), IRConst.int( 41n ) );

        const innerLoop = new IRRecursive(
            innerSelf,
            new IRFunc( [ Symbol("innerParam") ], new IRVar( p ) )
        );
        const outerBody = letApp( p, value, innerLoop );
        const root = new IRRecursive(
            outerSelf,
            new IRFunc( [ Symbol("outerParam") ], outerBody )
        );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        expect( out instanceof IRRecursive ).toBe( true );
        const outerFn = ( out as IRRecursive ).body as IRFunc;
        const stillLet = outerFn.body;
        expect( isLetApp( stillLet, p ) ).toBe( true );
    });

    test("scenario 8b: nested recursive — let inside outer used in inner with VALUE → INLINED", () => {
        // Same shape as 8a but with a syntactic value as the binding.
        const p = Symbol("p");
        const outerSelf = Symbol("outerSelf");
        const innerSelf = Symbol("innerSelf");
        const value = IRConst.int( 42n );

        const innerLoop = new IRRecursive(
            innerSelf,
            new IRFunc( [ Symbol("innerParam") ], new IRVar( p ) )
        );
        const outerBody = letApp( p, value, innerLoop );
        const root = new IRRecursive(
            outerSelf,
            new IRFunc( [ Symbol("outerParam") ], outerBody )
        );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        expect( out instanceof IRRecursive ).toBe( true );
        const outerFn = ( out as IRRecursive ).body as IRFunc;
        // The inner let should have been collapsed (the IRConst moved
        // into the inner recursive body).
        expect( isLetApp( outerFn.body, p ) ).toBe( false );
    });

    // ── beta-reduction when the argument is a bare IRVar ──

    test("scenario 9: arg is IRVar, single use → beta-reduced (let collapsed, var substituted)", () => {
        // ((λp. addInt p 1) (IRVar x))   →   addInt (IRVar x) 1
        const p = Symbol("p");
        const x = Symbol("x");
        const body = _ir_apps(
            IRNative.addInteger,
            new IRVar( p ),
            IRConst.int( 1n )
        );
        const root = letApp( p, new IRVar( x ), body );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        expect( isLetApp( out, p ) ).toBe( false );
        expect( containsVar( out, p ) ).toBe( false );
        expect( countVar( out, x ) ).toBe( 1 );
    });

    test("scenario 10: arg is IRVar, MULTIPLE uses → beta-reduced anyway", () => {
        // ((λp. addInt p p) (IRVar x))   →   addInt x x
        // Pure variable renaming: env lookup of `p` vs `x` costs the
        // same, so we save the wrapping `(λp. ...) x` regardless of
        // how many times the bound name was used.
        const p = Symbol("p");
        const x = Symbol("x");
        const body = _ir_apps(
            IRNative.addInteger,
            new IRVar( p ),
            new IRVar( p )
        );
        const root = letApp( p, new IRVar( x ), body );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        expect( isLetApp( out, p ) ).toBe( false );
        expect( containsVar( out, p ) ).toBe( false );
        // Both former `IRVar(p)` slots now reference `x`.
        expect( countVar( out, x ) ).toBe( 2 );
    });

    test("scenario 11: arg is IRVar, single use trapped inside IRRecursive → beta-reduced", () => {
        // Same as scenario 4 but the arg is a bare IRVar — always
        // safe to rename even across recursive boundaries.
        const p = Symbol("p");
        const self = Symbol("self");
        const x = Symbol("x");
        const root = letApp(
            p,
            new IRVar( x ),
            new IRRecursive(
                self,
                new IRFunc(
                    [ Symbol("loopParam") ],
                    new IRVar( p )
                )
            )
        );

        const out = inlineSingleUseLetBindingsAndReturnRoot( root );

        expect( isLetApp( out, p ) ).toBe( false );
        expect( containsVar( out, p ) ).toBe( false );
        expect( containsVar( out, x ) ).toBe( true );
    });

});

function countVar( term: IRTerm, sym: symbol ): number
{
    let count = 0;
    const stack: IRTerm[] = [ term ];
    while( stack.length > 0 )
    {
        const t = stack.pop()!;
        if( t instanceof IRVar && t.name === sym ) count++;
        stack.push( ...t.children() );
    }
    return count;
}

function containsVar( term: IRTerm, sym: symbol ): boolean
{
    return countVar( term, sym ) > 0;
}
