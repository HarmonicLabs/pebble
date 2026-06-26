import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, parseUPLCText, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

/**
 * All comparison/equality operators on the native `Value` type.
 *
 *   ==  ===            -> `_valueEq`            (bidirectional containment)
 *   !=  !==            -> `!_valueEq`
 *   a <= b             -> valueContains(b, a)   (b ≥ a)
 *   a >= b             -> valueContains(a, b)   (a ≥ b)
 *   a <  b             -> valueContains(a, b) ? false : valueContains(b, a)
 *   a >  b             -> valueContains(b, a) ? false : valueContains(a, b)
 *
 * `valueContains(x, y)` means `x ≥ y` componentwise; Value ordering is a
 * PARTIAL order, so two values can be incomparable (all of <,<=,>,>= false).
 */

const polA = "aa".repeat( 28 );
const polB = "bb".repeat( 28 );

async function cmpFn( op: string ): Promise<UPLCTerm> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "t.pebble", fromUtf8(
            `function cmp( a: Value, b: Value ): boolean { return a ${op} b; }`
        ) ] ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.export({ functionName: "cmp", entry: "t.pebble", root: "/" });
    if( c.diagnostics.length )
        throw new Error( "compile failed: " + c.diagnostics.map( d => d.toString() ).join( "\n" ) );
    return parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
}

/** a Value with a single policy/token and the given quantity */
function val( qty: bigint, opts: { policy?: string, name?: string } = {} ): UPLCConst {
    const policy = opts.policy ?? polA;
    const name = opts.name ?? "ff";
    return parseUPLCText( `(con value [(#${policy}, [(#${name}, ${qty})])])` ) as UPLCConst;
}

/** a Value with two tokens (ff, gg) under polA */
function val2( ff: bigint, gg: bigint ): UPLCConst {
    return parseUPLCText( `(con value [(#${polA}, [(#ff, ${ff}), (#gg, ${gg})])])` ) as UPLCConst;
}

function ev( uplc: UPLCTerm, a: UPLCConst, b: UPLCConst ): boolean {
    const r = Machine.eval( new Application( new Application( uplc, a ), b ) ).result;
    if( !( r instanceof CEKConst ) ) throw new Error( "non-const result: " + JSON.stringify( r ) );
    return ( r as CEKConst ).value as boolean;
}

describe("Value comparison & equality operators", () => {

    // small < big (same policy/token): a comparable pair
    const a = () => val( 5n );
    const b = () => val( 10n );
    // incomparable: different token names, neither dominates the other
    const c = () => val( 5n, { name: "aa" } );
    const d = () => val( 5n, { name: "bb" } );

    describe("equality: == === != !==", () => {
        test("`==` and `===` are identical and mean value equality", async () => {
            for( const op of [ "==", "===" ] ) {
                const f = await cmpFn( op );
                expect( ev( f, a(), a() ) ).toBe( true );   // equal
                expect( ev( f, a(), b() ) ).toBe( false );  // different qty
                expect( ev( f, c(), d() ) ).toBe( false );  // different token
            }
        });
        test("`!=` and `!==` are identical and negate equality", async () => {
            for( const op of [ "!=", "!==" ] ) {
                const f = await cmpFn( op );
                expect( ev( f, a(), a() ) ).toBe( false );
                expect( ev( f, a(), b() ) ).toBe( true );
                expect( ev( f, c(), d() ) ).toBe( true );
            }
        });
    });

    describe("ordering on a comparable pair (a=5 ≤ b=10)", () => {
        test("`<=`", async () => {
            const f = await cmpFn( "<=" );
            expect( ev( f, a(), b() ) ).toBe( true );   // 5 <= 10
            expect( ev( f, b(), a() ) ).toBe( false );  // 10 <= 5
            expect( ev( f, a(), a() ) ).toBe( true );   // 5 <= 5
        });
        test("`<`", async () => {
            const f = await cmpFn( "<" );
            expect( ev( f, a(), b() ) ).toBe( true );   // 5 < 10
            expect( ev( f, b(), a() ) ).toBe( false );
            expect( ev( f, a(), a() ) ).toBe( false );  // not strict
        });
        test("`>=`", async () => {
            const f = await cmpFn( ">=" );
            expect( ev( f, a(), b() ) ).toBe( false );  // 5 >= 10
            expect( ev( f, b(), a() ) ).toBe( true );   // 10 >= 5
            expect( ev( f, a(), a() ) ).toBe( true );   // 5 >= 5
        });
        test("`>`", async () => {
            const f = await cmpFn( ">" );
            expect( ev( f, a(), b() ) ).toBe( false );
            expect( ev( f, b(), a() ) ).toBe( true );   // 10 > 5
            expect( ev( f, a(), a() ) ).toBe( false );  // not strict
        });
    });

    describe("partial order: incomparable values are all-false for <,<=,>,>=", () => {
        test("disjoint tokens — neither dominates the other", async () => {
            for( const op of [ "<", "<=", ">", ">=" ] ) {
                const f = await cmpFn( op );
                expect( ev( f, c(), d() ) ).toBe( false );
                expect( ev( f, d(), c() ) ).toBe( false );
            }
        });

        // The strict-comparator trap: `a < b` is NOT `!(a >= b)` for a partial
        // order. e = {ff:10, gg:1}, g = {ff:1, gg:10} overlap but neither
        // dominates, so EVERY ordering comparison (both directions) is false —
        // including `<` and `>`. A naive `< == !(>=)` lowering would wrongly
        // report one of them true here.
        test("overlapping but mixed (e bigger in ff, smaller in gg)", async () => {
            const e = () => val2( 10n, 1n );
            const g = () => val2( 1n, 10n );
            for( const op of [ "<", "<=", ">", ">=" ] ) {
                const f = await cmpFn( op );
                expect( ev( f, e(), g() ) ).toBe( false );
                expect( ev( f, g(), e() ) ).toBe( false );
            }
            // sanity: they are genuinely different (so != holds, == doesn't)
            const eq = await cmpFn( "==" );
            expect( ev( eq, e(), g() ) ).toBe( false );
            // and each strictly dominates a strict subset, to prove < CAN be true
            const lt = await cmpFn( "<" );
            expect( ev( lt, val2( 1n, 1n ), e() ) ).toBe( true );  // {1,1} < {10,1}
        });
    });

    // `+` (unionValue), binary `-` (union with negation), unary `-` (negateValue).
    // Results are probed back through a `Value` comparison; note `valueContains`
    // (used by ==/<=/…) requires NON-negative quantities, so we only compare
    // values that stay non-negative.
    describe("arithmetic: + , - , unary -", () => {
        async function arithFn( body: string ): Promise<UPLCTerm> {
            const ioApi = createMemoryCompilerIoApi({
                sources: new Map([ [ "t.pebble", fromUtf8(
                    `function cmp( a: Value, b: Value ): boolean { return ${body}; }`
                ) ] ]),
                useConsoleAsOutput: true,
            });
            const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
            await c.export({ functionName: "cmp", entry: "t.pebble", root: "/" });
            if( c.diagnostics.length )
                throw new Error( "compile failed: " + c.diagnostics.map( d => d.toString() ).join( "\n" ) );
            return parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
        }

        test("`a + b` unions amounts (6 + 4 == 10)", async () => {
            const f = await arithFn( `(a + b).amountOf( #${polA}, #ff ) == 10` );
            expect( ev( f, val( 6n ), val( 4n ) ) ).toBe( true );
        });

        test("`a - b` subtracts amounts (10 - 3 == 7)", async () => {
            const f = await arithFn( `(a - b).amountOf( #${polA}, #ff ) == 7` );
            expect( ev( f, val( 10n ), val( 3n ) ) ).toBe( true );
        });

        test("unary `-` negates (a + (-a) is empty, == a - a)", async () => {
            const f = await arithFn( `(a + (-a)) == (a - a)` );
            expect( ev( f, val( 5n ), val( 5n ) ) ).toBe( true );
        });

        test("unary `-` then re-add cancels ( (a - b) + b == a )", async () => {
            const f = await arithFn( `((a - b) + b) == a` );
            expect( ev( f, val( 9n ), val( 4n ) ) ).toBe( true );
        });
    });
});
