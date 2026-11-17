import { testOptions, defaultOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, constT, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";
import { DataB, DataConstr, DataI } from "@harmoniclabs/plutus-data";
import { IRNative } from "../../IR/IRNodes/IRNative";
import { IRApp, _ir_apps } from "../../IR/IRNodes/IRApp";
import { IRCase } from "../../IR/IRNodes/IRCase";
import { IRConst } from "../../IR/IRNodes/IRConst";
import { IRConstr } from "../../IR/IRNodes/IRConstr";
import { IRDelayed } from "../../IR/IRNodes/IRDelayed";
import { IRForced } from "../../IR/IRNodes/IRForced";
import { IRFunc } from "../../IR/IRNodes/IRFunc";
import { IRHoisted } from "../../IR/IRNodes/IRHoisted";
import { IRLetted } from "../../IR/IRNodes/IRLetted";
import { IRRecursive } from "../../IR/IRNodes/IRRecursive";
import { IRSelfCall } from "../../IR/IRNodes/IRSelfCall";
import { IRVar } from "../../IR/IRNodes/IRVar";
import type { IRTerm } from "../../IR/IRTerm";
import { _modifyChildFromTo } from "../../IR/toUPLC/_internal/_modifyChildFromTo";
import { _makeAllNegativeNativesHoisted } from "../../IR/toUPLC/_internal/_makeAllNegativeNativesHoisted";
import { iterTree } from "../../IR/toUPLC/_internal/iterTree";
import { _compTimeDropN } from "../../IR/toUPLC/subRoutines/_comptimeDropN";
import { handleRootRecursiveTerm } from "../../IR/toUPLC/subRoutines/handleRecursiveTerms";
import { introduceCaseForDualHeadTailAndReturnRoot } from "../../IR/toUPLC/subRoutines/introduceCaseForDualHeadTailAndReturnRoot";
import { removeUnusedVarsAndReturnRoot } from "../../IR/toUPLC/subRoutines/removeUnusedVarsAndReturnRoot/removeUnusedVarsAndReturnRoot";
import { replaceNativesAndReturnRoot } from "../../IR/toUPLC/subRoutines/replaceNatives";
import { rewriteHeadTailInCaseConsAndReturnRoot } from "../../IR/toUPLC/subRoutines/rewriteHeadTailInCaseConsAndReturnRoot";
import { rewriteNativesAppliedToConstantsAndReturnRoot } from "../../IR/toUPLC/subRoutines/rewriteNativesAppliedToConstantsAndReturnRoot";
import { _debug_assertFreshHashes, _debug_freshHashChecks } from "../../IR/utils/assertFreshHashes";
import { containsExpensiveWork } from "../../IR/toUPLC/subRoutines/handleLetted/isSafeToFloatOutOfLambda";

// Regression tests for BUGs 78-81 (PEBBLE_BUGS.md): four faults of the backend that made it
// compile one function several times, found when a registry script of the Jacquard DA layer
// came out at 22 kB (it is 4 kB) with its Merkle-tree functions compiled once per call.
//
//   78  a pass that rewrites a term gave each copy of it a variable of its own
//   79  a term went on remembering the hash it had before what it holds was changed
//   80  the walk of the tree, after replacing a term, skipped branches still to visit
//   81  a function that hashes passed for expensive work, and was bound in every branch
//
// A case asserts the result of running what was compiled, or the term a pass leaves, and
// not only a size.

jest.setTimeout( 120_000 );

async function exported( src: string ): Promise<{ uplc: UPLCTerm, size: number }> {
    const ioApi = createMemoryCompilerIoApi({ sources: new Map([[ "test.pebble", fromUtf8( src ) ]]), useConsoleAsOutput: false });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.export({ functionName: "main", entry: "test.pebble", root: "/" });
    const errors = c.diagnostics.map( d => d.toString() ).filter( d => d.startsWith("ERROR") );
    if( errors.length ) throw new Error( "compile failed: " + errors.join("\n") );
    const bytes = ioApi.outputs.get("out/out.flat")!;
    return { uplc: parseUPLC( bytes ).body, size: bytes.length };
}

async function contractSize( src: string, options: object = testOptions ): Promise<number> {
    const ioApi = createMemoryCompilerIoApi({ sources: new Map([[ "main.pebble", fromUtf8( src ) ]]), useConsoleAsOutput: false });
    const c = new Compiler( ioApi, { ...options, compilerVersion: COMPILER_VERSION } as any );
    await c.compile({ entry: "main.pebble", root: "/" });
    const out = ioApi.outputs.get("out/out.flat");
    if( !( out instanceof Uint8Array ) ) throw new Error( "no script: " + c.diagnostics.map( d => d.toString() ).join("\n") );
    return out.length;
}

const intList = ( xs: bigint[] ) => UPLCConst.listOf( constT.int )( xs );

function evalInt( uplc: UPLCTerm, ...args: UPLCTerm[] ): bigint {
    let applied = uplc;
    for( const arg of args ) applied = new Application( applied, arg );
    const r = Machine.eval( applied ).result;
    if( !( r instanceof CEKConst ) ) throw new Error( "eval failed: " + JSON.stringify( ( r as any ).msg ?? r ) );
    return r.value as bigint;
}

/** the terms of `root` that `is` picks, a term before the terms it holds */
function termsOf( root: IRTerm, is: ( t: IRTerm ) => boolean ): IRTerm[] {
    const found: IRTerm[] = [];
    const stack: IRTerm[] = [ root ];
    while( stack.length > 0 )
    {
        const t = stack.pop()!;
        if( is( t ) ) found.push( t );
        const children = t.children();
        for( let i = children.length - 1; i >= 0; i-- ) stack.push( children[i] );
    }
    return found;
}

// ---------------------------------------------------------------------------------------
// BUG 78 — a function is compiled once, however many times it is called
// ---------------------------------------------------------------------------------------
describe("BUG 78: two copies of a term are rewritten into two copies of one term", () => {

    // a function that tests its list (`isEmpty` becomes a `case`, whose branch binds the head
    // and the tail) and is long enough for a second copy of it to show
    const mix = `
function mix( xs: List<int>, acc: int ): int {
    if( xs.isEmpty() ) return acc * 1103515245 + 12345;
    const h = xs.head();
    return mix( xs.tail(), ( acc * 31 + h ) * 6364136223846793005 + h * h * 999983 - 1442695040888963407 );
}
`;
    const mixOf = ( xs: bigint[], acc: bigint ): bigint => {
        for( const h of xs ) acc = ( acc * 31n + h ) * 6364136223846793005n + h * h * 999983n - 1442695040888963407n;
        return acc * 1103515245n + 12345n;
    };
    const lists = [ [ 1n, 2n, 3n ], [], [ 7n ], [ 5n, 5n, 5n, 5n ] ];
    const mainCalling = ( n: number ) => mix + `
export function main( a: List<int>, b: List<int>, c: List<int>, d: List<int> ): int {
    return ${[ "mix( a, 0 )", "mix( b, 1 )", "mix( c, 2 )", "mix( d, 3 )" ].slice( 0, n ).join(" + ")};
}`;

    test("a function that tests its list: a second and a fourth call add a call, not the function", async () => {
        const one = await exported( mainCalling( 1 ) );
        const two = await exported( mainCalling( 2 ) );
        const four = await exported( mainCalling( 4 ) );

        // the function alone is some 80 bytes: it was 80 more per call
        expect( one.size ).toBeGreaterThan( 80 );
        expect( two.size - one.size ).toBeLessThanOrEqual( 16 );
        expect( four.size - two.size ).toBeLessThanOrEqual( 32 );

        const args = lists.map( intList );
        expect( evalInt( one.uplc, ...args ) ).toBe( mixOf( lists[0], 0n ) );
        expect( evalInt( two.uplc, ...args ) ).toBe( mixOf( lists[0], 0n ) + mixOf( lists[1], 1n ) );
        expect( evalInt( four.uplc, ...args ) ).toBe( lists.map( ( xs, i ) => mixOf( xs, BigInt( i ) ) ).reduce( ( a, b ) => a + b ) );
    });

    test("...whatever the options, and from the methods of a contract", async () => {
        const contract = ( n: number ) => mix + `
contract T {
${[ 0, 1, 2 ].map( i => `
    mint m${i}( xs: List<int> ) {
        const { tx, policy } = context;
        assert ${ i < n ? `mix( xs, ${i} )` : `xs.length() + ${i}` } > tx.mint.amountOf( policy, # );
    }` ).join("\n")}
}`;
        for( const options of [ testOptions, defaultOptions ] )
        {
            const one = await contractSize( contract( 1 ), options );
            const two = await contractSize( contract( 2 ), options );
            const three = await contractSize( contract( 3 ), options );
            expect( two - one ).toBeLessThanOrEqual( 24 );
            expect( three - two ).toBeLessThanOrEqual( 24 );
        }
    });

    // `strictIfThenElse( nullList( L ), 0, headList( L ) + tailList( L ) … )` as the body of a function
    const listTest = () => {
        const L = Symbol("L");
        return new IRFunc( [ L ],
            _ir_apps(
                IRNative.strictIfThenElse,
                new IRApp( IRNative.nullList, new IRVar( L ) ),
                new IRDelayed( IRConst.int( 0 ) ),
                new IRDelayed( _ir_apps(
                    IRNative.addInteger,
                    new IRApp( IRNative.headList, new IRVar( L ) ),
                    new IRApp( IRNative.headList, new IRApp( IRNative.tailList, new IRVar( L ) ) )
                ) )
            )
        );
    };

    test("the test of a list becomes a `case`: the same one in each copy of the term", () => {
        const fn = listTest();
        let root: IRTerm = new IRConstr( 0, [ fn, fn.clone(), fn.clone() ] );

        root = rewriteNativesAppliedToConstantsAndReturnRoot( root );
        root = rewriteHeadTailInCaseConsAndReturnRoot( root );

        const copies = root.children();
        // the head and the tail are read through the variables of the `case`…
        const cases = termsOf( copies[0], t => t instanceof IRCase ) as IRCase[];
        expect( cases.length ).toBe( 1 );
        const branch = cases[0].continuations[0] as IRFunc;
        expect( branch.params.length ).toBe( 2 );
        const read = ( termsOf( branch.body, t => t instanceof IRVar ) as IRVar[] ).map( v => v.name );
        expect( read ).toContain( branch.params[0] );
        expect( read ).toContain( branch.params[1] );
        // …which are the same variables in the three copies: they are still one term
        expect( copies[1].hash ).toBe( copies[0].hash );
        expect( copies[2].hash ).toBe( copies[0].hash );
    });

    test("...and a different test of the same list has variables of its own", () => {
        const L = Symbol("L");
        const test = ( onEmpty: number ) => _ir_apps(
            IRNative.strictIfThenElse,
            new IRApp( IRNative.nullList, new IRVar( L ) ),
            new IRDelayed( IRConst.int( onEmpty ) ),
            new IRDelayed( new IRApp( IRNative.headList, new IRVar( L ) ) )
        );
        let root: IRTerm = new IRFunc( [ L ], new IRConstr( 0, [ test( 0 ), test( 1 ), test( 0 ) ] ) );
        root = rewriteNativesAppliedToConstantsAndReturnRoot( root );

        const branches = ( termsOf( root, t => t instanceof IRCase ) as IRCase[] ).map( c => c.continuations[0] as IRFunc );
        expect( branches.length ).toBe( 3 );
        expect( branches[2].params ).toEqual( branches[0].params );
        expect( branches[1].params[0] ).not.toBe( branches[0].params[0] );
        expect( branches[1].params[1] ).not.toBe( branches[0].params[1] );
    });

    test("the head and the tail of one list become a `case`: the same one in each copy", () => {
        // (the pass acts on a function in which the list is free: one binds it, the next reads it)
        const make = () => {
            const L = Symbol("L");
            const k = Symbol("k");
            return new IRFunc( [ L ], new IRFunc( [ k ], _ir_apps(
                IRNative.addInteger,
                new IRApp( IRNative.headList, new IRVar( L ) ),
                new IRApp( IRNative.headList, new IRApp( IRNative.tailList, new IRVar( L ) ) )
            ) ) );
        };
        const fn = make();
        const root = introduceCaseForDualHeadTailAndReturnRoot( new IRConstr( 0, [ fn, fn.clone(), make() ] ) );

        const [ a, b, other ] = root.children();
        expect( termsOf( a, t => t instanceof IRCase ).length ).toBe( 1 );
        expect( termsOf( a, t => t instanceof IRNative ).map( t => ( t as IRNative ).tag ) ).toEqual( [ IRNative.addInteger.tag, IRNative.headList.tag ] );
        expect( b.hash ).toBe( a.hash );
        // the same function of ANOTHER list is another term, with other variables
        expect( other.hash ).not.toBe( a.hash );
        const branchOf = ( t: IRTerm ) => ( termsOf( t, x => x instanceof IRCase )[0] as IRCase ).continuations[0] as IRFunc;
        expect( branchOf( b ).params ).toEqual( branchOf( a ).params );
        expect( branchOf( other ).params[0] ).not.toBe( branchOf( a ).params[0] );
    });

    test("dropping 5, 7 or 40 elements is one function wherever it is done", () => {
        for( const n of [ 5n, 7n, 40n ] )
        {
            const first = _compTimeDropN( n );
            const again = _compTimeDropN( n );
            expect( again ).not.toBe( first );
            expect( again.hash ).toBe( first.hash );
        }
        expect( _compTimeDropN( 5n ).hash ).not.toBe( _compTimeDropN( 7n ).hash );
    });

    test("every recursive function is applied through the same term", () => {
        const loop = () => {
            const self = Symbol("self");
            const n = Symbol("n");
            return new IRRecursive( self, new IRFunc( [ n ], new IRApp( new IRSelfCall( self ), new IRVar( n ) ) ) );
        };
        const root = handleRootRecursiveTerm( new IRConstr( 0, [ loop(), loop() ] ) );
        const combinators = termsOf( root, t => t instanceof IRHoisted );
        expect( combinators.length ).toBe( 2 );
        expect( combinators[1].hash ).toBe( combinators[0].hash );
        expect( termsOf( root, t => t instanceof IRRecursive || t instanceof IRSelfCall ) ).toEqual( [] );
    });
});

// ---------------------------------------------------------------------------------------
// BUG 79 — a term forgets its hash when what it holds changes
// ---------------------------------------------------------------------------------------
describe("BUG 79: the hash of a term is the hash of what it holds now", () => {

    // every kind of term that holds others, around a constant: built with 1 and, afresh, with 2
    const x = Symbol("x");
    const holders: [ string, ( leaf: IRTerm ) => IRTerm ][] = [
        [ "the function of an application", leaf => new IRApp( leaf, new IRVar( x ) ) ],
        [ "the argument of an application", leaf => new IRApp( new IRVar( x ), leaf ) ],
        [ "the body of a function", leaf => new IRFunc( [ Symbol.for("p") ], leaf ) ],
        [ "the body of a recursive function", leaf => new IRRecursive( Symbol.for("self"), leaf ) ],
        [ "a delayed term", leaf => new IRDelayed( leaf ) ],
        [ "a forced term", leaf => new IRForced( leaf ) ],
        [ "the first field of a constr", leaf => new IRConstr( 0, [ leaf, new IRVar( x ) ] ) ],
        [ "the last field of a constr", leaf => new IRConstr( 1, [ new IRVar( x ), new IRVar( x ), leaf ] ) ],
        [ "what a case is on", leaf => new IRCase( leaf, [ new IRVar( x ) ] ) ],
        [ "a branch of a case", leaf => new IRCase( new IRVar( x ), [ new IRVar( x ), leaf ] ) ],
        [ "a hoisted term", leaf => new IRHoisted( leaf ) ],
        [ "a letted term", leaf => new IRLetted( Symbol.for("v"), leaf ) ],
    ];

    test.each( holders )("replacing %s changes the hash of everything it is in", ( _what, hold ) => {
        const leaf = IRConst.int( 1 );
        const holder = hold( leaf );
        // three terms around it: the one that is told forgets, and so do the ones it is in
        const root = new IRFunc( [ x ], new IRDelayed( new IRApp( new IRDelayed( holder ), IRConst.int( 9 ) ) ) );
        const before = root.hash;

        _modifyChildFromTo( holder as any, leaf, IRConst.int( 2 ) );

        const afresh = new IRFunc( [ x ], new IRDelayed( new IRApp( new IRDelayed( hold( IRConst.int( 2 ) ) ), IRConst.int( 9 ) ) ) );
        expect( root.hash ).toBe( afresh.hash );
        expect( root.hash ).not.toBe( before );
        expect( () => _debug_assertFreshHashes( root, "test" ) ).not.toThrow();
    });

    test("the check itself: a term that remembers the hash of what it was is found", () => {
        const app = new IRApp( new IRVar( x ), IRConst.int( 1 ) );
        const root = new IRFunc( [ x ], new IRDelayed( app ) );
        root.hash;
        expect( () => _debug_assertFreshHashes( root, "test" ) ).not.toThrow();
        // what a setter that did not tell would leave behind
        const two = IRConst.int( 2 );
        two.hash;
        ( app as any )._arg = two;
        expect( () => _debug_assertFreshHashes( root, "the pass under test" ) ).toThrow( /after the pass under test: a IRApp remembers the hash/ );

        // ...and a term that remembers its hash over one that does not: the next change
        // inside that one would stop there, and never reach the term above
        const other = new IRFunc( [ x ], new IRDelayed( new IRApp( new IRVar( x ), IRConst.int( 1 ) ) ) );
        other.hash;
        ( ( other.body as IRDelayed ).delayed as any )._hash = undefined;
        expect( () => _debug_assertFreshHashes( other, "the pass under test" ) ).toThrow( /a IRDelayed remembers its hash, but the IRApp it holds does not/ );
    });

    test("a function with a parameter less is another function", () => {
        const a = Symbol("a"), b = Symbol("b");
        // `( \ a b -> a ) x 7`: nothing reads `b`
        const make = () => new IRFunc( [ x ], new IRDelayed(
            _ir_apps( new IRFunc( [ a, b ], new IRVar( a ) ), new IRVar( x ), IRConst.int( 7 ) )
        ) );
        const root = make();
        const fn = termsOf( root, t => t instanceof IRFunc && t.params.length === 2 )[0] as IRFunc;
        const before = fn.hash;
        root.hash;

        const result = removeUnusedVarsAndReturnRoot( root );

        expect( fn.params ).toEqual( [ a ] );
        expect( fn.hash ).not.toBe( before );
        expect( fn.hash ).toBe( new IRFunc( [ a ], new IRVar( a ) ).hash );
        expect( () => _debug_assertFreshHashes( result, "removeUnusedVars" ) ).not.toThrow();
    });

    test("a copy remembers what its original remembers, and forgets it when it is changed", () => {
        const leaf = () => new IRApp( IRNative.addInteger, IRConst.int( 1 ) );
        const original = new IRHoisted( new IRFunc( [ x ], new IRDelayed( new IRApp( leaf(), new IRVar( x ) ) ) ) );
        const hash = original.hash;

        const copy = original.clone();
        // nothing to compute: every term of the copy remembers its hash (functions and builtins too)
        for( const t of termsOf( copy, () => true ) ) expect( t.isHashPresent() ).toBe( true );
        expect( copy.hash ).toBe( hash );

        // changed four terms below the function, the copy is another term; the original is not
        const inner = termsOf( copy, t => t instanceof IRConst )[0];
        _modifyChildFromTo( inner.parent, inner, IRConst.int( 2 ) );
        expect( copy.hash ).not.toBe( hash );
        expect( original.hash ).toBe( hash );
        expect( () => _debug_assertFreshHashes( copy, "test" ) ).not.toThrow();
    });

    test("a hoisted term never holds a hoisted term: its copy is the same term", () => {
        const inner = () => new IRHoisted( IRNative.serialiseData, { name: "inner", forceHoist: true } );
        const outer = new IRHoisted( IRConst.int( 0 ) );
        outer.hash;

        // set, as built: unwrapped
        outer.hoisted = inner();
        expect( outer.hoisted ).toBeInstanceOf( IRNative );
        expect( outer.meta.forceHoist ).toBe( true );
        expect( outer.hash ).toBe( new IRHoisted( inner() ).hash );
        expect( outer.hash ).toBe( inner().hash );
        expect( outer.clone().hash ).toBe( outer.hash );
        expect( () => _debug_assertFreshHashes( new IRDelayed( outer.clone() ), "test" ) ).not.toThrow();
    });

    test("no pass of the backend leaves a term with the hash of what it was (PEBBLE_DBG_HASHES)", async () => {
        // methods that share functions, a loop, a recursion, lists taken apart, data built and read
        const src = `
struct Point { x: int, y: int }
function mix( xs: List<int>, acc: int ): int {
    if( xs.isEmpty() ) return acc * 1103515245 + 12345;
    return mix( xs.tail(), ( acc * 31 + xs.head() ) * 6364136223846793005 );
}
function second( xs: List<int> ): int { return xs.head() * 7 + xs.tail().head() * 11; }
function norm( p: Point ): int { return p.x * p.x + p.y * p.y; }
contract T {
    mint one( xs: List<int> ) {
        const { tx, policy } = context;
        assert mix( xs, 0 ) > tx.mint.amountOf( policy, # );
        assert xs.some( e => e > second( xs ) ) || xs.length() == 2;
    }
    mint two( xs: List<int>, p: Point ) {
        const { tx, policy } = context;
        let total = 0;
        for( const e of xs ) { total = total + e * norm( p ); }
        assert mix( xs, total ) > tx.mint.amountOf( policy, # ) + second( xs );
    }
    mint three( p: Point, q: Point ) {
        const { tx } = context;
        const moved = Point{ x: p.x + q.x, y: p.y + q.y };
        assert norm( moved ) >= norm( p ) && tx.inputs.length() > 0;
        assert std.list.at( 5, tx.requiredSigners ) == std.list.at( 7, tx.requiredSigners );
    }
}`;
        const checksBefore = _debug_freshHashChecks.done;
        const was = process.env.PEBBLE_DBG_HASHES;
        process.env.PEBBLE_DBG_HASHES = "1";
        try {
            for( const options of [ testOptions, defaultOptions ] )
            {
                expect( await contractSize( src, options ) ).toBeGreaterThan( 200 );
            }
        }
        finally {
            if( was === undefined ) delete process.env.PEBBLE_DBG_HASHES;
            else process.env.PEBBLE_DBG_HASHES = was;
        }
        // the check ran after every pass of the two compilations
        expect( _debug_freshHashChecks.done - checksBefore ).toBeGreaterThan( 40 );
    });
});

// ---------------------------------------------------------------------------------------
// BUG 80 — a pass that replaces a term goes on with the branches still to visit
// ---------------------------------------------------------------------------------------
describe("BUG 80: replacing a term does not make the walk skip the rest of the tree", () => {

    const x = Symbol("x");
    // three branches, each with a builtin some terms down (not held by the `case` itself)
    const threeBranches = ( native: () => IRNative ) => new IRFunc( [ x ], new IRCase(
        new IRVar( x ),
        [ 1, 2, 3 ].map( n => new IRDelayed( _ir_apps( native(), new IRVar( x ), IRConst.int( n ) ) ) )
    ) );

    test("the walk visits every term, also after one was replaced deep in the last branch", () => {
        const root = threeBranches( () => IRNative.addInteger );
        const visited: IRTerm[] = [];
        let replaced: IRTerm | undefined = undefined;
        iterTree( root, t => {
            visited.push( t );
            // the builtin of the branch visited first (the last one): the last term of that
            // branch to be visited, with only the other branches waiting behind it
            if( replaced === undefined && t instanceof IRNative )
            {
                replaced = t;
                _modifyChildFromTo( t.parent, t, IRNative.subtractInteger );
                return true;
            }
            return undefined;
        });
        expect( replaced ).toBeDefined();
        const natives = termsOf( root, t => t instanceof IRNative ).map( t => ( t as IRNative ).tag );
        expect( natives ).toEqual( [ IRNative.addInteger.tag, IRNative.addInteger.tag, IRNative.subtractInteger.tag ] );
        // every term that is in the tree was visited: the other two branches too
        // (it was the last branch only: 2 of 3 constants were never seen)
        const seen = new Set( visited );
        expect( termsOf( root, t => !seen.has( t ) ) ).toEqual( [] );
        const ints = visited.filter( t => t instanceof IRConst ).map( t => ( t as IRConst ).value );
        expect( ints ).toEqual( expect.arrayContaining( [ BigInt( 3 ), BigInt( 2 ), BigInt( 1 ) ] ) );
        // and nothing that is no longer in it, other than what was replaced
        const inTree = new Set( termsOf( root, () => true ) );
        expect( visited.filter( t => !inTree.has( t ) ) ).toEqual( [ replaced ] );
    });

    test("every builtin of every branch is wrapped", () => {
        const root = threeBranches( () => IRNative.addInteger );
        _makeAllNegativeNativesHoisted( root );
        const natives = termsOf( root, t => t instanceof IRNative );
        expect( natives.length ).toBe( 3 );
        // it was 1 of 3: the other two branches were never looked at
        expect( natives.map( n => n.parent instanceof IRHoisted ) ).toEqual( [ true, true, true ] );
        const branches = ( termsOf( root, t => t instanceof IRCase )[0] as IRCase ).continuations;
        expect( new Set( Array.from( branches, b => termsOf( b, t => t instanceof IRHoisted )[0].hash ) ).size ).toBe( 1 );
    });

    test("every builtin of the compiler is lowered in every branch, in one sweep", () => {
        const root = replaceNativesAndReturnRoot( threeBranches( () => IRNative._strictAnd ) );
        expect( termsOf( root, t => t instanceof IRNative && t.tag < 0 ) ).toEqual( [] );
        expect( termsOf( root, t => t instanceof IRHoisted ).length ).toBe( 3 );
    });

    test("three methods calling one function: it is in the script once", async () => {
        // (as `compiler.masterpieceBugs.0_3_5.sharedFunctions.test.ts`, which a compiler with
        // BUG 79 fixed and BUG 80 not fails: the builtins of two methods out of three were
        // left as they were, and the function of those two was another term)
        const heavy = `
function heavy( a: int, b: int ): int {
    let acc = a * 31 + b;
    acc = acc * 1103515245 + 12345;
    acc = acc + a * b - (a + b) * 7;
    acc = acc * 6364136223846793005 + 1442695040888963407;
    acc = acc + (a * a * a) - (b * b * b);
    return acc * 2862933555777941757 + 3037000493;
}`;
        const contract = ( n: number ) => heavy + `
contract T {
${[ 0, 1, 2, 3 ].map( i => `
    mint m${i}() {
        const { tx, policy } = context;
        assert ${ i < n ? `heavy( tx.mint.amountOf( policy, # ), ${i + 2} )` : `tx.mint.amountOf( policy, # )` } > ${i};
    }` ).join("\n")}
}`;
        for( const options of [ testOptions, defaultOptions ] )
        {
            const sizes = [];
            for( const n of [ 1, 2, 3, 4 ] ) sizes.push( await contractSize( contract( n ), options ) );
            for( let i = 1; i < sizes.length; i++ ) expect( sizes[i] - sizes[i - 1] ).toBeLessThanOrEqual( 24 );
        }
    });
});

// ---------------------------------------------------------------------------------------
// BUG 81 — a function that hashes is not expensive work where it is bound
// ---------------------------------------------------------------------------------------
describe("BUG 81: what a value costs is what evaluating it does, not what it holds", () => {

    const x = Symbol("x"), y = Symbol("y"), self = Symbol("self");
    const hash = ( t: IRTerm ) => new IRApp( IRNative.blake2b_256, t );
    const bytes = () => IRConst.bytes( new Uint8Array( 32 ) );

    test("a function that hashes does nothing until it is called", () => {
        // \ x y -> blake2b_256( x ++ y )
        const combine = () => new IRFunc( [ x, y ], hash( _ir_apps( IRNative.appendByteString, new IRVar( x ), new IRVar( y ) ) ) );
        expect( containsExpensiveWork( combine() ) ).toBe( false );
        expect( containsExpensiveWork( new IRHoisted( combine() ) ) ).toBe( false );
        // ...nor when it is given only some of its arguments: that is a function still
        expect( containsExpensiveWork( new IRApp( combine(), bytes() ) ) ).toBe( false );
        // called, it hashes
        expect( containsExpensiveWork( _ir_apps( combine(), bytes(), bytes() ) ) ).toBe( true );
        expect( containsExpensiveWork( _ir_apps( new IRHoisted( combine() ), bytes(), bytes() ) ) ).toBe( true );
        // a function that calls it is a function: nothing runs where it is built
        expect( containsExpensiveWork( new IRFunc( [ x ], _ir_apps( new IRHoisted( combine() ), new IRVar( x ), bytes() ) ) ) ).toBe( false );
    });

    test("...a recursive one, and a delayed term until it is forced", () => {
        const loop = () => new IRRecursive( self, new IRFunc( [ x ], new IRApp( new IRSelfCall( self ), hash( new IRVar( x ) ) ) ) );
        expect( containsExpensiveWork( loop() ) ).toBe( false );
        expect( containsExpensiveWork( new IRApp( loop(), bytes() ) ) ).toBe( true );

        expect( containsExpensiveWork( new IRDelayed( hash( bytes() ) ) ) ).toBe( false );
        expect( containsExpensiveWork( new IRForced( new IRDelayed( hash( bytes() ) ) ) ) ).toBe( true );
    });

    test("control: a hash that is computed is expensive wherever it sits in what is evaluated", () => {
        expect( containsExpensiveWork( hash( bytes() ) ) ).toBe( true );
        expect( containsExpensiveWork( new IRApp( IRNative.serialiseData, IRConst.data( new DataI( 1 ) ) ) ) ).toBe( true );
        // as an argument, as a field, as what a `case` is on, in a branch of it
        expect( containsExpensiveWork( _ir_apps( IRNative.appendByteString, bytes(), hash( bytes() ) ) ) ).toBe( true );
        expect( containsExpensiveWork( new IRConstr( 0, [ bytes(), hash( bytes() ) ] ) ) ).toBe( true );
        expect( containsExpensiveWork( new IRCase( hash( bytes() ), [ IRConst.int( 1 ) ] ) ) ).toBe( true );
        expect( containsExpensiveWork( new IRCase( IRConst.bool( true ), [ IRConst.int( 1 ), hash( bytes() ) ] ) ) ).toBe( true );
        expect( containsExpensiveWork( new IRCase( new IRConstr( 0, [ bytes() ] ), [ new IRFunc( [ x ], hash( new IRVar( x ) ) ) ] ) ) ).toBe( true );
        // a function applied where it is written
        expect( containsExpensiveWork( new IRApp( new IRFunc( [ x ], hash( new IRVar( x ) ) ), bytes() ) ) ).toBe( true );
        // and nothing of the kind is not
        expect( containsExpensiveWork( _ir_apps( IRNative.addInteger, IRConst.int( 1 ), IRConst.int( 2 ) ) ) ).toBe( false );
    });

    // a helper that hashes, called from every method of a contract
    const helpers = `
function combine( a: bytes, b: bytes ): bytes { return std.crypto.blake2b_256( a + b ); }
function chain( xs: List<bytes>, acc: bytes ): bytes {
    if( xs.isEmpty() ) return acc;
    return chain( xs.tail(), combine( combine( acc, xs.head() ), combine( xs.head(), acc ) ) );
}`;
    const contract = ( methods: number, calling: number ) => helpers + `
contract T {
${Array.from( { length: methods }, ( _, i ) => `
    mint m${i}( xs: List<bytes> ) {
        const { tx, policy } = context;
        assert ${ i < calling ? `chain( xs, policy ).length()` : `xs.length()` } > tx.mint.amountOf( policy, # ) + ${i};
    }` ).join("\n")}
}`;

    test("called from two, four or six methods, a function that hashes is in the script once", async () => {
        for( const options of [ testOptions, defaultOptions ] )
        {
            const sizes: number[] = [];
            for( const calling of [ 1, 2, 4, 6 ] ) sizes.push( await contractSize( contract( 6, calling ), options ) );
            // (it was a copy of the two functions for each method that calls them)
            expect( sizes[1] - sizes[0] ).toBeLessThanOrEqual( 16 );
            expect( sizes[2] - sizes[1] ).toBeLessThanOrEqual( 32 );
            expect( sizes[3] - sizes[2] ).toBeLessThanOrEqual( 32 );
        }
    });

    test("control: a hash computed once stays out of the methods that do not read it", async () => {
        // a closed value that IS work: bound where it is read, not above every method
        const src = ( reading: number ) => `
const DIGEST = std.crypto.sha2_256( #${"ab".repeat( 64 )} );
contract T {
${[ 0, 1, 2 ].map( i => `
    mint m${i}( b: bytes ) {
        const { tx, policy } = context;
        assert ${ i < reading ? `b == DIGEST && b != DIGEST.slice( 1, 4 )` : `b.length() == ${i}` };
    }` ).join("\n")}
}`;
        const none = await exportedMethod( src( 0 ) );
        const one = await exportedMethod( src( 1 ) );
        // the last method reads no digest: running it costs what it costs with no digest at all
        expect( one.costOfLast ).toBeLessThan( none.costOfLast + 150_000n );
    });
});

/** compiles a contract of three mint methods and runs the last one (`m2( b )`, true for 2 bytes) */
async function exportedMethod( src: string ): Promise<{ costOfLast: bigint }> {
    const ioApi = createMemoryCompilerIoApi({ sources: new Map([[ "main.pebble", fromUtf8( src ) ]]), useConsoleAsOutput: false });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.compile({ entry: "main.pebble", root: "/" });
    const script = parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
    const policy = new Uint8Array( 28 ).fill( 0xbb );
    const zero = () => new DataI( 0 );
    const ctx = new DataConstr( 0, [
        new DataConstr( 0, Array.from( { length: 16 }, zero ) ),
        new DataConstr( 2, [ new DataB( new Uint8Array( 2 ) ) ] ),
        new DataConstr( 0, [ new DataB( policy ) ] ),
    ]);
    const { result, budgetSpent } = Machine.eval( new Application( script, UPLCConst.data( ctx ) ) );
    if( !( result instanceof CEKConst ) ) throw new Error( "the method failed: " + JSON.stringify( ( result as any ).msg ?? result ) );
    return { costOfLast: budgetSpent.cpu };
}
