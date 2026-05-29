import { TirArrayT } from "../../TirNativeType/native/array";
import { TirFuncT } from "../../TirNativeType/native/function";
import { TirLinearMapT } from "../../TirNativeType/native/linearMap";
import { TirLinearMapEntryT } from "../../TirNativeType/native/linearMapEntry";
import { TirListT } from "../../TirNativeType/native/list";
import { TirDataOptT } from "../../TirNativeType/native/Optional/data";
import { TirSopOptT } from "../../TirNativeType/native/Optional/sop";
import { int_t, bytes_t, bool_t, string_t } from "../../../program/stdScope/stdScope";
import { TirTypeParam } from "../../TirTypeParam";
import { TirType } from "../../TirType";
import { inferTypeArgs, tirTypeStructurallyEqual } from "../inferTypeArgs";
import { substituteTypeParams } from "../substituteTypeParams";

/**
 * Regression coverage for the two type-parameter walkers:
 *
 *   - `substituteTypeParams(t, { T → int })` must walk `t` and produce a
 *     fresh tree with `T` replaced by `int` in every position. Missing a
 *     case silently returns the input unchanged, leaving `T` in place — the
 *     exact bug that affected `TirArrayT` and made `std.array.fromList`
 *     and `std.array.length` produce `Array<A>` instead of `Array<int>`.
 *
 *   - `inferTypeArgs(formal: Container<T>, actual: Container<int>, env)`
 *     must bind `T → int`. Missing a case falls through to structural-
 *     equality, which fails because `Container<T> != Container<int>`.
 *
 * Each entry in `GENERIC_CONTAINERS` covers one generic-container TirType.
 *
 * ★ If you add a new generic-container TirType (it has at least one
 *   type parameter on its TIR shape), add an entry here. The test will fail
 *   loudly if either walker forgets a case for it.
 */

interface ContainerProbe {
    name: string;
    // Build the type using the given placeholder for every type parameter.
    buildWith( placeholder: TirType ): TirType;
}

const GENERIC_CONTAINERS: ContainerProbe[] = [
    {
        name: "List<T>",
        buildWith: ( p ) => new TirListT( p ),
    },
    {
        name: "Array<T>",
        buildWith: ( p ) => new TirArrayT( p ),
    },
    {
        name: "LinearMap<T, T>",
        buildWith: ( p ) => new TirLinearMapT( p, p ),
    },
    {
        name: "LinearMapEntry<T, T>",
        buildWith: ( p ) => new TirLinearMapEntryT( p, p ),
    },
    {
        name: "Optional<T> (data-encoded)",
        buildWith: ( p ) => new TirDataOptT( p ),
    },
    {
        name: "Optional<T> (SoP)",
        buildWith: ( p ) => new TirSopOptT( p ),
    },
    {
        name: "(T) -> T",
        buildWith: ( p ) => new TirFuncT( [ p ], p ),
    },
];

// A nested composition that mixes every container at least once.
// If any single walker case is missing, this whole composition fails to
// substitute or to infer cleanly.
const ALL_NESTED: ContainerProbe = {
    name: "(LinearMap<T, Array<T>>, List<Optional<T>>) -> LinearMapEntry<T, T>",
    buildWith: ( p ) => new TirFuncT(
        [
            new TirLinearMapT( p, new TirArrayT( p ) ),
            new TirListT( new TirSopOptT( p ) ),
        ],
        new TirLinearMapEntryT( p, p ),
    ),
};

function freshTypeParam(): TirTypeParam
{
    return new TirTypeParam( "T" );
}

function makeSubst( tp: TirTypeParam, concrete: TirType ): Map<symbol, TirType>
{
    return new Map( [ [ tp.symbol, concrete ] ] );
}

/**
 * Walks a TIR type and asserts no `TirTypeParam` is reachable. Catches the
 * "silent passthrough on missing case" failure mode of `substituteTypeParams`.
 */
function expectFullyConcrete( label: string, t: TirType ): void
{
    function visit( node: TirType, path: string ): void
    {
        if( node instanceof TirTypeParam )
        {
            throw new Error(
                `${label}: residual TirTypeParam at ${path} — ` +
                `substituteTypeParams left "${node.name}" untouched. ` +
                `A walker case is missing for some container along this path.`
            );
        }
        if( node instanceof TirListT )     visit( node.typeArg, path + ".typeArg" );
        else if( node instanceof TirArrayT ) visit( node.typeArg, path + ".typeArg" );
        else if( node instanceof TirLinearMapT )
        {
            visit( node.keyTypeArg, path + ".keyTypeArg" );
            visit( node.valTypeArg, path + ".valTypeArg" );
        }
        else if( node instanceof TirLinearMapEntryT )
        {
            visit( node.keyTypeArg, path + ".keyTypeArg" );
            visit( node.valTypeArg, path + ".valTypeArg" );
        }
        else if( node instanceof TirDataOptT ) visit( node.typeArg, path + ".typeArg" );
        else if( node instanceof TirSopOptT )  visit( node.typeArg, path + ".typeArg" );
        else if( node instanceof TirFuncT )
        {
            node.argTypes.forEach( ( a, i ) =>
                visit( a, `${path}.argTypes[${i}]` )
            );
            visit( node.returnType, path + ".returnType" );
        }
        // base case: concrete type, no further recursion needed
    }
    visit( t, label );
}

describe("substituteTypeParams: every generic-container TIR shape", () => {

    for( const probe of GENERIC_CONTAINERS )
    {
        test( `substitutes T → int inside ${probe.name}`, () => {
            const T = freshTypeParam();
            const formal = probe.buildWith( T );
            const substituted = substituteTypeParams( formal, makeSubst( T, int_t ) );

            // 1. The result must be structurally a `Container<int>`.
            const expected = probe.buildWith( int_t );
            expect( tirTypeStructurallyEqual( substituted, expected ) ).toBe( true );

            // 2. No `TirTypeParam` may survive anywhere in the result.
            expectFullyConcrete( probe.name, substituted );
        });
    }

    test( "substitutes through deep nested composition", () => {
        const T = freshTypeParam();
        const formal = ALL_NESTED.buildWith( T );
        const substituted = substituteTypeParams( formal, makeSubst( T, int_t ) );

        const expected = ALL_NESTED.buildWith( int_t );
        expect( tirTypeStructurallyEqual( substituted, expected ) ).toBe( true );
        expectFullyConcrete( ALL_NESTED.name, substituted );
    });

    test( "returns the same instance when the substitution is empty", () => {
        const t = new TirListT( int_t );
        const out = substituteTypeParams( t, new Map() );
        expect( out ).toBe( t );
    });

    test( "leaves unrelated TirTypeParams alone", () => {
        const T = freshTypeParam();
        const U = new TirTypeParam( "U" );
        const formal = new TirListT( U );
        const substituted = substituteTypeParams( formal, makeSubst( T, int_t ) );

        // U is not in the substitution; the tree should be returned unchanged.
        expect( substituted ).toBe( formal );
    });
});

describe("inferTypeArgs: every generic-container TIR shape", () => {

    for( const probe of GENERIC_CONTAINERS )
    {
        test( `infers T = int from ${probe.name} vs ${probe.name.replace(/T/g, "int")}`, () => {
            const T = freshTypeParam();
            const formal = probe.buildWith( T );
            const actual = probe.buildWith( int_t );

            const env = new Map<symbol, TirType>();
            const ok = inferTypeArgs( formal, actual, env );

            expect( ok ).toBe( true );
            expect( env.has( T.symbol ) ).toBe( true );
            expect( tirTypeStructurallyEqual( env.get( T.symbol )!, int_t ) ).toBe( true );
        });
    }

    test( "infers T = int through deep nested composition", () => {
        const T = freshTypeParam();
        const formal = ALL_NESTED.buildWith( T );
        const actual = ALL_NESTED.buildWith( int_t );

        const env = new Map<symbol, TirType>();
        const ok = inferTypeArgs( formal, actual, env );

        expect( ok ).toBe( true );
        expect( tirTypeStructurallyEqual( env.get( T.symbol )!, int_t ) ).toBe( true );
    });

    test( "fails on inconsistent bindings (T = int on the left, T = bytes on the right)", () => {
        // formal: Func<List<T>, Array<T>> with both T's the same symbol;
        // actual: Func<List<int>, Array<bytes>> — would require T = int AND T = bytes.
        const T = freshTypeParam();
        const formal = new TirFuncT( [ new TirListT( T ) ], new TirArrayT( T ) );
        const actual = new TirFuncT( [ new TirListT( int_t ) ], new TirArrayT( bytes_t ) );

        const env = new Map<symbol, TirType>();
        expect( inferTypeArgs( formal, actual, env ) ).toBe( false );
    });

    test( "fails on shape mismatch (Array<T> vs List<int>)", () => {
        const T = freshTypeParam();
        const formal = new TirArrayT( T );
        const actual = new TirListT( int_t );

        const env = new Map<symbol, TirType>();
        expect( inferTypeArgs( formal, actual, env ) ).toBe( false );
    });
});

// =============================================================================
// Additional coverage — broader scenarios across EVERY generic container.
//
// These tests are intentionally cross-cutting: each one iterates over
// `GENERIC_CONTAINERS`, so any newly-added generic shape gets every
// behavioural check applied automatically.
// =============================================================================

describe("substituteTypeParams: compound substitution targets", () => {

    // The substitution target is itself a generic container — verifies that
    // `substituteTypeParams` plugs compound types into the placeholder slot
    // rather than only primitives.
    for( const probe of GENERIC_CONTAINERS )
    {
        test( `substitutes T → List<int> inside ${probe.name}`, () => {
            const T = freshTypeParam();
            const target = new TirListT( int_t );
            const formal = probe.buildWith( T );
            const substituted = substituteTypeParams( formal, makeSubst( T, target ) );

            const expected = probe.buildWith( target );
            expect( tirTypeStructurallyEqual( substituted, expected ) ).toBe( true );
            expectFullyConcrete( probe.name, substituted );
        });
    }

    test( "substitutes T → LinearMap<int, bytes> inside Array<T>", () => {
        const T = freshTypeParam();
        const target = new TirLinearMapT( int_t, bytes_t );
        const formal = new TirArrayT( T );
        const substituted = substituteTypeParams( formal, makeSubst( T, target ) );

        const expected = new TirArrayT( target );
        expect( tirTypeStructurallyEqual( substituted, expected ) ).toBe( true );
    });

    test( "substitutes T → (int) -> bytes inside List<T> (function as target)", () => {
        const T = freshTypeParam();
        const target = new TirFuncT( [ int_t ], bytes_t );
        const formal = new TirListT( T );
        const substituted = substituteTypeParams( formal, makeSubst( T, target ) );

        const expected = new TirListT( target );
        expect( tirTypeStructurallyEqual( substituted, expected ) ).toBe( true );
    });
});

describe("substituteTypeParams: multi-parameter substitution", () => {

    // Two distinct placeholders mapped to two distinct concrete types.
    // Catches if the walker mixes up which param goes where.

    test( "LinearMap<K, V> with K → int, V → bytes → LinearMap<int, bytes>", () => {
        const K = new TirTypeParam( "K" );
        const V = new TirTypeParam( "V" );
        const formal = new TirLinearMapT( K, V );
        const subst = new Map<symbol, TirType>([
            [ K.symbol, int_t ],
            [ V.symbol, bytes_t ],
        ]);
        const out = substituteTypeParams( formal, subst );

        expect( tirTypeStructurallyEqual( out, new TirLinearMapT( int_t, bytes_t ) ) ).toBe( true );
        expectFullyConcrete( "LinearMap<K, V>", out );
    });

    test( "LinearMap<V, K> (swapped order) with K → int, V → bytes → LinearMap<bytes, int>", () => {
        // Mirror of the previous test with swapped positions. If the walker
        // accidentally swapped key/value, the previous test would still pass
        // but this one would fail.
        const K = new TirTypeParam( "K" );
        const V = new TirTypeParam( "V" );
        const formal = new TirLinearMapT( V, K );
        const subst = new Map<symbol, TirType>([
            [ K.symbol, int_t ],
            [ V.symbol, bytes_t ],
        ]);
        const out = substituteTypeParams( formal, subst );

        expect( tirTypeStructurallyEqual( out, new TirLinearMapT( bytes_t, int_t ) ) ).toBe( true );
    });

    test( "LinearMapEntry<K, V> with K → int, V → bytes → LinearMapEntry<int, bytes>", () => {
        const K = new TirTypeParam( "K" );
        const V = new TirTypeParam( "V" );
        const formal = new TirLinearMapEntryT( K, V );
        const subst = new Map<symbol, TirType>([
            [ K.symbol, int_t ],
            [ V.symbol, bytes_t ],
        ]);
        const out = substituteTypeParams( formal, subst );

        expect( tirTypeStructurallyEqual( out, new TirLinearMapEntryT( int_t, bytes_t ) ) ).toBe( true );
    });

    test( "(T, U) -> T with T → int, U → bytes → (int, bytes) -> int", () => {
        const T = new TirTypeParam( "T" );
        const U = new TirTypeParam( "U" );
        const formal = new TirFuncT( [ T, U ], T );
        const subst = new Map<symbol, TirType>([
            [ T.symbol, int_t ],
            [ U.symbol, bytes_t ],
        ]);
        const out = substituteTypeParams( formal, subst );

        expect( tirTypeStructurallyEqual( out, new TirFuncT( [ int_t, bytes_t ], int_t ) ) ).toBe( true );
    });

    test( "(T, U, T) -> U with T → int, U → bytes → (int, bytes, int) -> bytes", () => {
        // Same parameter appears in multiple positions; substitution must hit
        // every occurrence consistently.
        const T = new TirTypeParam( "T" );
        const U = new TirTypeParam( "U" );
        const formal = new TirFuncT( [ T, U, T ], U );
        const subst = new Map<symbol, TirType>([
            [ T.symbol, int_t ],
            [ U.symbol, bytes_t ],
        ]);
        const out = substituteTypeParams( formal, subst );

        expect( tirTypeStructurallyEqual( out, new TirFuncT( [ int_t, bytes_t, int_t ], bytes_t ) ) ).toBe( true );
    });
});

describe("substituteTypeParams: partial substitution leaves unsubstituted params alone", () => {

    test( "LinearMap<K, V> with only K → int → LinearMap<int, V> (V preserved)", () => {
        const K = new TirTypeParam( "K" );
        const V = new TirTypeParam( "V" );
        const formal = new TirLinearMapT( K, V );
        const out = substituteTypeParams( formal, makeSubst( K, int_t ) );

        expect( out ).toBeInstanceOf( TirLinearMapT );
        const lm = out as TirLinearMapT<any, any>;
        expect( tirTypeStructurallyEqual( lm.keyTypeArg, int_t ) ).toBe( true );

        // V must remain a TirTypeParam with the SAME symbol as the original.
        expect( lm.valTypeArg ).toBeInstanceOf( TirTypeParam );
        expect( ( lm.valTypeArg as TirTypeParam ).symbol ).toBe( V.symbol );
    });

    test( "LinearMapEntry<K, V> with only V → bytes → LinearMapEntry<K, bytes>", () => {
        const K = new TirTypeParam( "K" );
        const V = new TirTypeParam( "V" );
        const formal = new TirLinearMapEntryT( K, V );
        const out = substituteTypeParams( formal, makeSubst( V, bytes_t ) );

        expect( out ).toBeInstanceOf( TirLinearMapEntryT );
        const lme = out as TirLinearMapEntryT<any, any>;
        expect( lme.keyTypeArg ).toBeInstanceOf( TirTypeParam );
        expect( ( lme.keyTypeArg as TirTypeParam ).symbol ).toBe( K.symbol );
        expect( tirTypeStructurallyEqual( lme.valTypeArg, bytes_t ) ).toBe( true );
    });

    test( "(T, U) -> T with only T → int → (int, U) -> int (U preserved)", () => {
        const T = new TirTypeParam( "T" );
        const U = new TirTypeParam( "U" );
        const formal = new TirFuncT( [ T, U ], T );
        const out = substituteTypeParams( formal, makeSubst( T, int_t ) );

        expect( out ).toBeInstanceOf( TirFuncT );
        const f = out as TirFuncT;
        expect( tirTypeStructurallyEqual( f.argTypes[0], int_t ) ).toBe( true );
        expect( f.argTypes[1] ).toBeInstanceOf( TirTypeParam );
        expect( ( f.argTypes[1] as TirTypeParam ).symbol ).toBe( U.symbol );
        expect( tirTypeStructurallyEqual( f.returnType, int_t ) ).toBe( true );
    });
});

describe("substituteTypeParams: same parameter in multiple positions", () => {

    // Each test reuses one placeholder symbol in N positions across an entire
    // generic shape. The walker must substitute at every occurrence — missing
    // ANY single position leaves a residual TirTypeParam that the
    // `expectFullyConcrete` walk catches.

    test( "List<List<T>> with T → int → List<List<int>>", () => {
        const T = freshTypeParam();
        const formal = new TirListT( new TirListT( T ) );
        const out = substituteTypeParams( formal, makeSubst( T, int_t ) );
        expect( tirTypeStructurallyEqual( out, new TirListT( new TirListT( int_t ) ) ) ).toBe( true );
        expectFullyConcrete( "List<List<T>>", out );
    });

    test( "LinearMap<T, T> with T → int → LinearMap<int, int>", () => {
        const T = freshTypeParam();
        const formal = new TirLinearMapT( T, T );
        const out = substituteTypeParams( formal, makeSubst( T, int_t ) );
        expect( tirTypeStructurallyEqual( out, new TirLinearMapT( int_t, int_t ) ) ).toBe( true );
        expectFullyConcrete( "LinearMap<T, T>", out );
    });

    test( "Func<List<T>, Array<T>> with T → int (key bug repro)", () => {
        // Exactly the shape that triggered the `std.array.fromList` bug.
        // Keep this test even though it's the pure-walker reduction of that bug.
        const T = freshTypeParam();
        const formal = new TirFuncT( [ new TirListT( T ) ], new TirArrayT( T ) );
        const out = substituteTypeParams( formal, makeSubst( T, int_t ) );
        const expected = new TirFuncT( [ new TirListT( int_t ) ], new TirArrayT( int_t ) );
        expect( tirTypeStructurallyEqual( out, expected ) ).toBe( true );
        expectFullyConcrete( "Func<List<T>, Array<T>>", out );
    });
});

describe("substituteTypeParams: identity edge cases", () => {

    test( "substituting T → T (identity subst) returns the same tree instance", () => {
        // `substituteTypeParams` optimises for identity preservation: when no
        // descendant actually changes, every container short-circuits and
        // returns the original. Substituting `T → T` (same symbol) must hit
        // this short-circuit at every level.
        const T = freshTypeParam();
        const formal = new TirListT( new TirArrayT( T ) );
        const out = substituteTypeParams( formal, new Map([ [ T.symbol, T ] ]) );
        expect( out ).toBe( formal );
    });

    test( "substituting a param that does not appear in the tree returns the input unchanged", () => {
        const T = freshTypeParam();
        const U = new TirTypeParam( "U" );
        const formal = new TirArrayT( T );
        const out = substituteTypeParams( formal, makeSubst( U, int_t ) );
        // The tree contains T but the subst targets U — the result should be `===`.
        expect( out ).toBe( formal );
    });

    test( "substitution does not mutate the input tree", () => {
        const T = freshTypeParam();
        const formal = new TirArrayT( new TirListT( T ) );
        substituteTypeParams( formal, makeSubst( T, int_t ) );

        // After substitution, the original tree still contains the placeholder.
        expect( ( formal.typeArg as TirListT<any> ).typeArg ).toBeInstanceOf( TirTypeParam );
    });
});

describe("substituteTypeParams ⇆ inferTypeArgs: round-trip per container", () => {

    // Substitute T → C, then infer back from the (formal=with T, actual=with C)
    // pair. The recovered binding must be C. Catches any walker that "loses"
    // a position on one side but not the other.

    const concreteSamples: ReadonlyArray<{ name: string; t: TirType }> = [
        { name: "int",    t: int_t },
        { name: "bytes",  t: bytes_t },
        { name: "string", t: string_t },
        { name: "bool",   t: bool_t },
    ];

    for( const probe of GENERIC_CONTAINERS )
    for( const sample of concreteSamples )
    {
        test( `${probe.name} round-trips with T = ${sample.name}`, () => {
            const T = freshTypeParam();
            const formal = probe.buildWith( T );

            // Forward leg: substitute to produce a concrete instance.
            const substituted = substituteTypeParams( formal, makeSubst( T, sample.t ) );

            // Reverse leg: infer T against the same shape constructed with the
            // concrete type directly. The two trees must be structurally equal
            // (otherwise substitution failed), and inferring against
            // `substituted` must recover T = sample.t.
            const directlyConcrete = probe.buildWith( sample.t );
            expect( tirTypeStructurallyEqual( substituted, directlyConcrete ) ).toBe( true );

            const env = new Map<symbol, TirType>();
            const ok = inferTypeArgs( formal, substituted, env );
            expect( ok ).toBe( true );
            expect( env.get( T.symbol ) ).toBeDefined();
            expect( tirTypeStructurallyEqual( env.get( T.symbol )!, sample.t ) ).toBe( true );
        });
    }
});

describe("inferTypeArgs: multi-parameter and consistency", () => {

    test( "LinearMap<K, V> vs LinearMap<int, bytes> → K = int, V = bytes", () => {
        const K = new TirTypeParam( "K" );
        const V = new TirTypeParam( "V" );
        const formal = new TirLinearMapT( K, V );
        const actual = new TirLinearMapT( int_t, bytes_t );

        const env = new Map<symbol, TirType>();
        expect( inferTypeArgs( formal, actual, env ) ).toBe( true );
        expect( tirTypeStructurallyEqual( env.get( K.symbol )!, int_t ) ).toBe( true );
        expect( tirTypeStructurallyEqual( env.get( V.symbol )!, bytes_t ) ).toBe( true );
    });

    test( "LinearMap<V, K> (swapped) vs LinearMap<int, bytes> → V = int, K = bytes", () => {
        const K = new TirTypeParam( "K" );
        const V = new TirTypeParam( "V" );
        const formal = new TirLinearMapT( V, K );
        const actual = new TirLinearMapT( int_t, bytes_t );

        const env = new Map<symbol, TirType>();
        expect( inferTypeArgs( formal, actual, env ) ).toBe( true );
        expect( tirTypeStructurallyEqual( env.get( V.symbol )!, int_t ) ).toBe( true );
        expect( tirTypeStructurallyEqual( env.get( K.symbol )!, bytes_t ) ).toBe( true );
    });

    test( "(T, U) -> T vs (int, bytes) -> int → T = int, U = bytes", () => {
        const T = new TirTypeParam( "T" );
        const U = new TirTypeParam( "U" );
        const formal = new TirFuncT( [ T, U ], T );
        const actual = new TirFuncT( [ int_t, bytes_t ], int_t );

        const env = new Map<symbol, TirType>();
        expect( inferTypeArgs( formal, actual, env ) ).toBe( true );
        expect( tirTypeStructurallyEqual( env.get( T.symbol )!, int_t ) ).toBe( true );
        expect( tirTypeStructurallyEqual( env.get( U.symbol )!, bytes_t ) ).toBe( true );
    });

    test( "pre-populated env is respected: consistent binding succeeds without overwrite", () => {
        const T = freshTypeParam();
        const formal = new TirArrayT( T );
        const actual = new TirArrayT( int_t );

        const env = new Map<symbol, TirType>([ [ T.symbol, int_t ] ]);
        expect( inferTypeArgs( formal, actual, env ) ).toBe( true );
        // Binding still int.
        expect( tirTypeStructurallyEqual( env.get( T.symbol )!, int_t ) ).toBe( true );
    });

    test( "pre-populated env is respected: inconsistent binding fails", () => {
        const T = freshTypeParam();
        const formal = new TirArrayT( T );
        const actual = new TirArrayT( bytes_t );

        const env = new Map<symbol, TirType>([ [ T.symbol, int_t ] ]);
        expect( inferTypeArgs( formal, actual, env ) ).toBe( false );
    });

    test( "infers from arg position AND return position in the same Func<T, T>", () => {
        // (T) -> T against (int) -> int must bind T = int via the arg side, then
        // confirm via the return side. If the walker only recursed into args OR
        // only into the return type, one side would silently skip and we'd get
        // inconsistent results — this test catches that.
        const T = freshTypeParam();
        const formal = new TirFuncT( [ T ], T );
        const actual = new TirFuncT( [ int_t ], int_t );

        const env = new Map<symbol, TirType>();
        expect( inferTypeArgs( formal, actual, env ) ).toBe( true );
        expect( tirTypeStructurallyEqual( env.get( T.symbol )!, int_t ) ).toBe( true );
    });

    test( "Func<T, T> vs Func<int, bytes> fails (T bound twice with different types)", () => {
        const T = freshTypeParam();
        const formal = new TirFuncT( [ T ], T );
        const actual = new TirFuncT( [ int_t ], bytes_t );

        const env = new Map<symbol, TirType>();
        expect( inferTypeArgs( formal, actual, env ) ).toBe( false );
    });

    test( "fails on shape mismatch — every container vs every other container", () => {
        // Cross product: every generic container's `Container<int>` must FAIL
        // to unify against every other container's `Container<int>`. This
        // catches the failure mode where a walker case is missing AND the
        // fallback structural equality accidentally accepts the mismatch.
        for( let i = 0; i < GENERIC_CONTAINERS.length; i++ )
        for( let j = 0; j < GENERIC_CONTAINERS.length; j++ )
        {
            if( i === j ) continue;
            const formal = GENERIC_CONTAINERS[i].buildWith( int_t );
            const actual = GENERIC_CONTAINERS[j].buildWith( int_t );
            const env = new Map<symbol, TirType>();
            expect( inferTypeArgs( formal, actual, env ) ).toBe( false );
        }
    });
});
