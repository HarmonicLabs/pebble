import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";
import { tirFindSopOptional } from "../tir/expressions/findSopOptional";
import { TirNativeFunc } from "../tir/expressions/TirNativeFunc";
import { TirInlineClosedIR } from "../tir/expressions/TirInlineClosedIR";
import { bool_t, bytes_t, data_t, int_t } from "../tir/program/stdScope/stdScope";
import { TirDataStructType, TirStructConstr, TirStructField } from "../tir/types/TirStructType";
import { IRNativeTag } from "../../IR/IRNodes/IRNative/IRNativeTag";
import { IRNative } from "../../IR/IRNodes/IRNative";
import { IRApp, _ir_apps } from "../../IR/IRNodes/IRApp";
import { IRCase } from "../../IR/IRNodes/IRCase";
import { IRConst } from "../../IR/IRNodes/IRConst";
import { IRConstr } from "../../IR/IRNodes/IRConstr";
import { IRFunc } from "../../IR/IRNodes/IRFunc";
import { IRVar } from "../../IR/IRNodes/IRVar";
import type { IRTerm } from "../../IR/IRTerm";
import { introduceCaseForDualHeadTailAndReturnRoot } from "../../IR/toUPLC/subRoutines/introduceCaseForDualHeadTailAndReturnRoot";

// Regression tests for the bugs found while writing the Jacquard L2 kernel
// against 0.6.0-dev0 (BUGs 49-59 and 61-64, see PEBBLE_BUGS.md). Each `describe` names
// its bug; a case asserts the EVALUATED result, or the exact diagnostic, not
// only that the source compiles. The cases that pass on the compiler before
// the fixes are the controls: what already worked, what is still refused.

async function compileFn( src: string, extra: Record<string, string> = {} ): Promise<UPLCTerm> {
    const sources = new Map<string, Uint8Array>([["test.pebble", fromUtf8(src)]]);
    for( const [ name, text ] of Object.entries( extra ) ) sources.set( name, fromUtf8( text ) );
    const ioApi = createMemoryCompilerIoApi({ sources, useConsoleAsOutput: false });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: "main", entry: "test.pebble", root: "/" });
    const errors = c.diagnostics.map( d => d.toString() ).filter( d => d.startsWith("ERROR") );
    if( errors.length )
        throw new Error("compile failed: " + errors.join("\n"));
    return parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
}

async function diagnosticsOf( src: string, extra: Record<string, string> = {} ): Promise<string[]> {
    const sources = new Map<string, Uint8Array>([["test.pebble", fromUtf8(src)]]);
    for( const [ name, text ] of Object.entries( extra ) ) sources.set( name, fromUtf8( text ) );
    const ioApi = createMemoryCompilerIoApi({
        sources,
        useConsoleAsOutput: false,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.check({ entry: "test.pebble", root: "/" });
    return c.diagnostics.map(d => d.toString());
}

function evalInt1( uplc: UPLCTerm, n: bigint ): bigint {
    const r = Machine.eval( new Application( uplc, UPLCConst.int( n ) ) ).result;
    if( !( r instanceof CEKConst ) ) throw new Error( "eval failed: " + JSON.stringify( (r as any).msg ?? r ) );
    return r.value as bigint;
}

function evalBytes1( uplc: UPLCTerm, n: bigint ): string {
    const r = Machine.eval( new Application( uplc, UPLCConst.int( n ) ) ).result;
    if( !( r instanceof CEKConst ) ) throw new Error( "eval failed: " + JSON.stringify( (r as any).msg ?? r ) );
    return toHex( r.value as Uint8Array );
}

/** the errors of compiling `src` as a contract (none: it compiled, to a script) */
async function contractErrors( src: string ): Promise<string[]> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: false,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    let failure: string | undefined = undefined;
    try {
        const script = await c.compile({ entry: "test.pebble", root: "/" });
        if( !( script.length > 0 ) ) failure = "no script";
    }
    catch( e: any ) { failure = "threw: " + String( e?.message ?? e ); }
    const errors = c.diagnostics.map( d => d.toString() ).filter( d => d.startsWith( "ERROR" ) );
    // a failure with no diagnostic is still a failure
    return errors.length === 0 && failure !== undefined ? [ failure ] : errors;
}

jest.setTimeout( 120_000 );

// --------------------------------------------------------------------------
// BUG 49 — the `else` arm of a `case` expression can read its surroundings
// --------------------------------------------------------------------------
describe("BUG 49 — `case` wildcard arm sees variables and functions", () => {

    test("else arm calls a function", async () => {
        const uplc = await compileFn(`
function g( x: int ): int { return x + 1; }
function pick( o: Optional<int> ): int {
    return case o
        is Some{ value } => value
        else g( 5 )
        ;
}
export function main( n: int ): int {
    const none: Optional<int> = undefined;
    return pick( none ) + n;
}`);
        expect( evalInt1( uplc, 10n ) ).toBe( 16n );
    });

    test("else arm reads a local constant and a parameter", async () => {
        const uplc = await compileFn(`
function g( x: int ): int { return x + 1; }
function pick( o: Optional<int>, k: int ): int {
    const dflt = g( k );
    return case o
        is Some{ value } => value
        else dflt + k
        ;
}
export function main( n: int ): int {
    const none: Optional<int> = undefined;
    return pick( none, n );
}`);
        expect( evalInt1( uplc, 10n ) ).toBe( 21n );
    });

    test("else arm on a multi-constructor data struct", async () => {
        const uplc = await compileFn(`
data struct Status { Active{} Frozen{ at: int } Closed{} }
function g( x: int ): int { return x + 1; }
function at( s: Status, k: int ): int {
    return case s
        is Frozen{ at } => at
        else g( k )
        ;
}
export function main( n: int ): int {
    return at( Status.Frozen{ at: 7 }, n ) * 100 + at( Status.Closed{}, n );
}`);
        expect( evalInt1( uplc, 10n ) ).toBe( 711n );
    });

    test("else arm uses a method of a std constant", async () => {
        const uplc = await compileFn(`
function zeroData( o: Optional<data> ): data {
    return case o
        is Some{ value } => value
        else std.value.zero.toData()
        ;
}
export function main( n: int ): int {
    const none: Optional<data> = undefined;
    return zeroData( none ) == std.value.zero.toData() ? n : 0;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });
});

// --------------------------------------------------------------------------
// BUG 50 — a `case` arm can match a constructor without binding its fields
// --------------------------------------------------------------------------
describe("BUG 50 — `Some{}` as a `case` pattern", () => {

    test("Some{} / None{} on a data optional", async () => {
        const uplc = await compileFn(`
struct Tip { seq: int, hash: bytes }
function isNone( o: Optional<Tip> ): boolean {
    return case o
        is Some{} => false
        is None{} => true
        ;
}
export function main( n: int ): int {
    const none: Optional<Tip> = undefined;
    const some: Optional<Tip> = Some{ value: Tip.Tip{ seq: n, hash: #aa } };
    return ( isNone( none ) ? 10 : 0 ) + ( isNone( some ) ? 0 : 1 );
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 11n );
    });

    test("Some{} on an optional int", async () => {
        const uplc = await compileFn(`
function has( o: Optional<int> ): int {
    return case o
        is Some{} => 1
        is None{} => 0
        ;
}
export function main( n: int ): int {
    const none: Optional<int> = undefined;
    const some: Optional<int> = Some{ value: n };
    return has( some ) * 10 + has( none );
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 10n );
    });
});

// --------------------------------------------------------------------------
// BUG 51 — a `match` statement with an `else` arm that assigns
// --------------------------------------------------------------------------
describe("BUG 51 — `match` with `else:` and assignments", () => {

    test("assignment in a named arm and in the else arm", async () => {
        const uplc = await compileFn(`
data struct Status { Active{} Frozen{ at: int } Closed{} }
function g( x: int ): int { return x + 1; }
function m( s: Status ): int {
    let z = 0;
    match s {
        when Frozen{ at }: { z = at; }
        else: { z = g( 6 ); }
    }
    return z + 1;
}
export function main( n: int ): int {
    return m( Status.Frozen{ at: n } ) * 100 + m( Status.Active{} ) * 10 + m( Status.Closed{} );
}`);
        // (9+1)*100 + 8*10 + 8
        expect( evalInt1( uplc, 9n ) ).toBe( 1088n );
    });

    test("a named arm returns, the else arm goes on to the rest of the body", async () => {
        const uplc = await compileFn(`
data struct Status { Active{} Frozen{ at: int } Closed{} }
function m( s: Status ): int {
    match s {
        when Frozen{ at }: { return at; }
        else: {}
    }
    return 7;
}
export function main( n: int ): int {
    return m( Status.Frozen{ at: n } ) * 100 + m( Status.Active{} ) * 10 + m( Status.Closed{} );
}`);
        expect( evalInt1( uplc, 9n ) ).toBe( 977n );
    });

    test("the else arm returns, a named arm goes on", async () => {
        const uplc = await compileFn(`
data struct Status { Active{} Frozen{ at: int } Closed{} }
function m( s: Status ): int {
    let z = 1;
    match s {
        when Frozen{ at }: { z = at; }
        else: { return 7; }
    }
    return z * 2;
}
export function main( n: int ): int {
    return m( Status.Frozen{ at: n } ) * 10 + m( Status.Closed{} );
}`);
        expect( evalInt1( uplc, 9n ) ).toBe( 187n );
    });

    test("the else arm reassigns inside a for...of loop", async () => {
        const uplc = await compileFn(`
data struct Status { Active{} Frozen{ at: int } Closed{} }
function sum( xs: List<Status> ): int {
    let total = 0;
    for( const s of xs ) {
        match s {
            when Frozen{ at }: { total = total + at; }
            else: { total = total + 1; }
        }
    }
    return total;
}
export function main( n: int ): int {
    return sum( [ Status.Active{}, Status.Frozen{ at: n }, Status.Closed{}, Status.Frozen{ at: 20 } ] );
}`);
        expect( evalInt1( uplc, 9n ) ).toBe( 31n );
    });

    test("`continue` in the else arm still runs the loop's update", async () => {
        const uplc = await compileFn(`
data struct Status { Active{} Frozen{ at: int } Closed{} }
function count( xs: List<Status> ): int {
    let seen = 0;
    for( let i = 0; i < xs.length(); i = i + 1 ) {
        match xs[i] {
            when Frozen{ at }: { seen = seen + at; }
            else: { continue; }
        }
        seen = seen + 100;
    }
    return seen;
}
export function main( n: int ): int {
    return count( [ Status.Active{}, Status.Frozen{ at: n }, Status.Closed{}, Status.Frozen{ at: 2 } ] );
}`);
        // two frozen: n + 2, plus 100 each
        expect( evalInt1( uplc, 9n ) ).toBe( 211n );
    });

    test("returns in a named arm and in the else arm", async () => {
        const uplc = await compileFn(`
data struct Status { Active{} Frozen{ at: int } Closed{} }
function m( s: Status ): int {
    match s {
        when Frozen{ at }: { return at; }
        else: { return 7; }
    }
}
export function main( n: int ): int {
    return m( Status.Frozen{ at: n } ) * 10 + m( Status.Closed{} );
}`);
        expect( evalInt1( uplc, 9n ) ).toBe( 97n );
    });
});

// --------------------------------------------------------------------------
// BUG 52 — `match` on the Optional a native-element list operation returns
// --------------------------------------------------------------------------
describe("BUG 52 — `match` on `List<int>.find`", () => {

    test("assignment in the arms", async () => {
        const uplc = await compileFn(`
function e( xs: List<int> ): int {
    let z = 6;
    match xs.find( x => x == 3 ) {
        when Some{ value }: { z = value + 2; }
        when None{}: {}
    }
    return z + 1;
}
export function main( n: int ): int {
    return e( [ 1, 2 ] ) * 10 + e( [ n ] );
}`);
        // 7*10 + (3+2+1)
        expect( evalInt1( uplc, 3n ) ).toBe( 76n );
    });

    test("returns in the arms", async () => {
        const uplc = await compileFn(`
function e( xs: List<int> ): int {
    match xs.find( x => x == 3 ) {
        when Some{ value }: { return value + 3; }
        when None{}: { return 7; }
    }
}
export function main( n: int ): int {
    return e( [ 1, 2 ] ) * 10 + e( [ n ] );
}`);
        expect( evalInt1( uplc, 3n ) ).toBe( 76n );
    });

    test("a `case` expression on the same Optional", async () => {
        const uplc = await compileFn(`
function e( xs: List<int> ): int {
    return case xs.find( x => x == 3 )
        is Some{ value } => value + 3
        is None{} => 7
        ;
}
export function main( n: int ): int {
    return e( [ 1, 2 ] ) * 10 + e( [ n ] );
}`);
        expect( evalInt1( uplc, 3n ) ).toBe( 76n );
    });

    test("destructuring the same Optional", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const xs: List<int> = [ 1, n ];
    const Some{ value } = xs.find( x => x == 3 );
    return value + 1;
}`);
        expect( evalInt1( uplc, 3n ) ).toBe( 4n );
    });

    test("the same with a list of bytes", async () => {
        const uplc = await compileFn(`
function e( xs: List<bytes> ): int {
    match xs.find( x => x == #03 ) {
        when Some{ value }: { return value.length() + 3; }
        when None{}: { return 7; }
    }
}
export function main( n: int ): int {
    return e( [ #01, #02 ] ) * 10 + e( [ #03 ] ) + n;
}`);
        expect( evalInt1( uplc, 0n ) ).toBe( 74n );
    });
});

describe("BUG 52 — ... and a list of structs is found as before", () => {

    test("`find` on a list of structs, destructured and matched", async () => {
        const uplc = await compileFn(`
struct P { x: int, y: int }
export function main( n: int ): int {
    const ps: List<P> = [ P.P{ x: 1, y: 10 }, P.P{ x: n, y: 20 }, P.P{ x: 3, y: 30 } ];
    const Some{ value: found } = ps.find( p => p.x == n );
    return case ps.find( p => p.y > 100 )
        is Some{ value } => value.y
        is None{} => found.y
        ;
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 20n );
    });

    // The finder of a list whose elements ARE data is the bare native, the term it always
    // was: wrapped in a closed term (as the one that encodes a native element is) it is
    // hidden from the passes that specialize a native in function position, and every
    // contract calling `tx.inputs.find` grew (the masterpiece by 167 bytes).
    test("the finder is the bare native for elements that are data, a wrapper for native ones", () => {
        const struct = new TirDataStructType( "P", "", [
            new TirStructConstr( "P", [ new TirStructField( "x", int_t ) ] )
        ], new Map() );
        for( const dataElems of [ data_t, struct ] )
        {
            const find = tirFindSopOptional( dataElems );
            expect( find ).toBeInstanceOf( TirNativeFunc );
            expect( ( find as TirNativeFunc ).tag ).toBe( IRNativeTag._findSopOptional );
        }
        for( const nativeElems of [ int_t, bytes_t, bool_t ] )
            expect( tirFindSopOptional( nativeElems ) ).toBeInstanceOf( TirInlineClosedIR );
    });
});

// --------------------------------------------------------------------------
// BUG 53 — `using` a std namespace inside a function or a contract method
// --------------------------------------------------------------------------
describe("BUG 53 — `using { ... } = std.<namespace>` in a body", () => {

    test("inside a function", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    using { blake2b_256 } = std.crypto;
    return blake2b_256( #00 ).length() + n;
}`);
        expect( evalInt1( uplc, 1n ) ).toBe( 33n );
    });

    test("the bls12_381 namespace inside a function", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    using { g1Compress, g1Uncompress, g1Add } = std.crypto.bls12_381;
    const g = g1Uncompress( #97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb );
    return g1Compress( g1Add( g, g ) ).length() + n;
}`);
        expect( evalInt1( uplc, 1n ) ).toBe( 49n );
    });

    test("a constant of a std namespace", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    using { zero } = std.value;
    return zero.lovelaces() + n;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("renamed", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    using { blake2b_256: hash, sha2_256 } = std.crypto;
    return hash( #00 ).length() + sha2_256( #00 ).length() + n;
}`);
        expect( evalInt1( uplc, 1n ) ).toBe( 65n );
    });

    test("inside a contract method", async () => {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([["test.pebble", fromUtf8(`
contract C {
    spend check( point: bytes ) {
        using { g1Uncompress, g1Compress } = std.crypto.bls12_381;
        assert g1Compress( g1Uncompress( point ) ) == point;
    }
}`)]]),
            useConsoleAsOutput: false,
        });
        const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
        const bytes = await c.compile({ entry: "test.pebble", root: "/" });
        expect( bytes.length ).toBeGreaterThan( 0 );
    });
});

// --------------------------------------------------------------------------
// BUG 54 — the empty map literal
// --------------------------------------------------------------------------
describe("BUG 54 — `{}` as an empty LinearMap", () => {

    test("typed by its annotation", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const empty: LinearMap<bytes, int> = {};
    return empty.isEmpty() ? n : 0;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("of data to data, as `unMapData` returns it", async () => {
        const uplc = await compileFn(`
function entries( d: Optional<data> ): LinearMap<data, data> {
    const none: LinearMap<data, data> = {};
    return case d
        is Some{ value } => std.builtins.unMapData( value )
        is None{} => none
        ;
}
export function main( n: int ): int {
    const absent: Optional<data> = undefined;
    return entries( absent ).length() + n;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });
});

describe("BUG 54 — map literals, as documented", () => {

    test("`{ #01: 10, #02: 20 }`: entries in order, looked up by key", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const m: LinearMap<bytes, int> = { #01: 10, #02: 20, #03: n };
    const first = m.head();
    return case m.lookup( #03 )
        is Some{ value } => value * 1000 + m.length() * 100 + first.value
        is None{} => 0
        ;
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 7310n );
    });

    test("the entries are kept in source order, duplicate keys included", async () => {
        const uplc = await compileFn(`
export function main( n: int ): bytes {
    const m: LinearMap<bytes, int> = { #02: n, #01: 10, #02: 30 };
    let seen = #;
    for( const { key, value } of m ) {
        seen = seen.concat( key ).concat( std.builtins.integerToByteString( true, 1, value ) );
    }
    return seen;
}`);
        expect( evalBytes1( uplc, 7n ) ).toBe( "0207" + "010a" + "021e" );
    });

    test("as data, it is the map `mapData` makes of the same entries", async () => {
        const uplc = await compileFn(`
struct W { m: LinearMap<bytes, int> }
export function main( n: int ): int {
    const m: LinearMap<bytes, int> = { #02: n, #01: 10 };
    const empty: LinearMap<bytes, int> = {};
    const built = empty.prepend( #01, 10 ).prepend( #02, n );
    const differs = empty.prepend( #02, n ).prepend( #01, 10 );
    return ( W.W{ m: m }.toData() == W.W{ m: built }.toData() ? 10 : 0 )
         + ( W.W{ m: m }.toData() == W.W{ m: differs }.toData() ? 1 : 0 );
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 10n );
    });

    test("keys and values are expressions; the type comes from the first entry", async () => {
        const uplc = await compileFn(`
function double( x: int ): int { return x * 2; }
export function main( n: int ): int {
    const m = { double( n ): #aa, ( n ): #bbbb, n + 1: #cccccc };
    return case m.lookup( n )
        is Some{ value } => value.length() * 10 + m.length()
        is None{} => 0
        ;
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 23n );
    });

    test("a map literal where a map is expected: an argument, a struct field", async () => {
        const uplc = await compileFn(`
struct Box { m: LinearMap<int, int> }
function size( m: LinearMap<int, int> ): int { return m.length(); }
export function main( n: int ): int {
    const box = Box.Box{ m: { 1: n, 2: n } };
    const none = Box.Box{ m: {} };
    return size({ 1: 1, 2: 2, 3: 3 }) * 100 + box.m.length() * 10 + none.m.length();
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 320n );
    });

    test("a bare identifier is not a key: the error says how to use the variable", async () => {
        const ds = await diagnosticsOf(`
export function main( n: int ): int {
    const k = #01;
    const m: LinearMap<bytes, int> = { k: n };
    return m.length();
}`);
        const errors = ds.filter( d => d.startsWith( "ERROR" ) );
        expect( errors.length ).toBe( 1 );
        expect( errors[0] ).toContain( "30212" );
        expect( errors[0] ).toContain( "(k): value" );
    });

    test("a bare identifier next to other keys is refused the same way", async () => {
        const ds = await diagnosticsOf(`
export function main( n: int ): int {
    const k = #01;
    const m: LinearMap<bytes, int> = { #02: 1, k: n };
    return m.length();
}`);
        const errors = ds.filter( d => d.startsWith( "ERROR" ) );
        expect( errors.some( d => d.includes( "30212" ) && d.includes( "(k): value" ) ) ).toBe( true );
    });

    test("`{ (k): v }` uses the variable", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const k = #01;
    const m: LinearMap<bytes, int> = { (k): n };
    return case m.lookup( #01 )
        is Some{ value } => value
        is None{} => 0
        ;
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 7n );
    });

    test("the documentation's example of a variable as a key", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const k = #01;
    const m: LinearMap<bytes, int> = { (k): 10, k.concat( #ff ): 20 };
    const inferred = { 1: #aa };
    return case m.lookup( #01ff )
        is Some{ value } => value + inferred.length() + n
        is None{} => 0
        ;
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 28n );
    });

    test("a map literal is not a struct, and a struct literal is still one", async () => {
        const ds = await diagnosticsOf(`
struct P { x: int, y: int }
export function main( n: int ): int {
    const p: P = { #01: n };
    return p.x;
}`);
        expect( ds.filter( d => d.startsWith( "ERROR" ) ).join( "\n" ) ).toContain( "30211" );

        const uplc = await compileFn(`
struct P { x: int, y: int }
export function main( n: int ): int {
    const x = n;
    const p: P = { x, y: 2 };
    return p.x * 10 + p.y;
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 72n );
    });

    test("in a contract method, with a parameter of the contract as key", async () => {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([["test.pebble", fromUtf8(`
contract C {
    param owner: bytes;
    spend check( amount: int ) {
        const m: LinearMap<bytes, int> = { this.owner: amount, #00: 1 };
        const same: LinearMap<bytes, int> = { ( this.owner ): amount };
        assert m.length() == 2 && same.length() == 1;
    }
}`)]]),
            useConsoleAsOutput: false,
        });
        const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
        const bytes = await c.compile({ entry: "test.pebble", root: "/" });
        expect( c.diagnostics.map( d => d.toString() ).filter( d => d.startsWith( "ERROR" ) ) ).toEqual( [] );
        expect( bytes.length ).toBeGreaterThan( 0 );
    });
});

// --------------------------------------------------------------------------
// BUG 55 — `.toData()` on an Optional
// --------------------------------------------------------------------------
describe("BUG 55 — `Optional<T>.toData()`", () => {

    test("Some and None of a struct, as a struct field encodes them", async () => {
        const uplc = await compileFn(`
struct Tip { seq: int, hash: bytes }
struct W { W { t: Optional<Tip> } }
export function main( n: int ): bytes {
    const some: Optional<Tip> = Some{ value: Tip.Tip{ seq: n, hash: #cc } };
    const none: Optional<Tip> = undefined;
    const viaField = W.W{ t: some };
    assert std.builtins.serialiseData( W.W{ t: none }.toData() ) == #d8799f.concat( std.builtins.serialiseData( none.toData() ) ).concat( #ff );
    assert std.builtins.serialiseData( viaField.toData() ) == #d8799f.concat( std.builtins.serialiseData( some.toData() ) ).concat( #ff );
    return std.builtins.serialiseData( some.toData() ).concat( std.builtins.serialiseData( none.toData() ) );
}`);
        // Constr 0 [ [ 3, #cc ] ]  then  Constr 1 []
        expect( evalBytes1( uplc, 3n ) ).toBe( "d8799f9f0341ccffff" + "d87a80" );
    });

    test("Optional<int>", async () => {
        const uplc = await compileFn(`
export function main( n: int ): bytes {
    const some: Optional<int> = Some{ value: n };
    return std.builtins.serialiseData( some.toData() );
}`);
        expect( evalBytes1( uplc, 3n ) ).toBe( "d8799f03ff" );
    });
});

describe("BUG 55 — ... whatever made the Optional", () => {

    test("the result of `find` on a list of ints (see BUG 52)", async () => {
        const uplc = await compileFn(`
export function main( n: int ): bytes {
    const xs: List<int> = [ 1, 2, 3 ];
    return std.builtins.serialiseData( xs.find( x => x == n ).toData() )
        .concat( std.builtins.serialiseData( xs.find( x => x > 10 ).toData() ) );
}`);
        expect( evalBytes1( uplc, 3n ) ).toBe( "d8799f03ff" + "d87a80" );
    });

    test("an Optional of an Optional", async () => {
        const uplc = await compileFn(`
export function main( n: int ): bytes {
    const inner: Optional<int> = Some{ value: n };
    const outer: Optional<Optional<int>> = Some{ value: inner };
    return std.builtins.serialiseData( outer.toData() );
}`);
        expect( evalBytes1( uplc, 3n ) ).toBe( "d8799fd8799f03ffff" );
    });

    test("a function's Optional parameter and result", async () => {
        const uplc = await compileFn(`
function next( o: Optional<int> ): Optional<int> {
    return case o
        is Some{ value } => Some{ value: value + 1 }
        is None{} => undefined
        ;
}
export function main( n: int ): bytes {
    const some: Optional<int> = Some{ value: n };
    return std.builtins.serialiseData( next( some ).toData() );
}`);
        expect( evalBytes1( uplc, 3n ) ).toBe( "d8799f04ff" );
    });
});

// --------------------------------------------------------------------------
// BUG 56 — a function declared after the one that calls it
// --------------------------------------------------------------------------
describe("BUG 56 — functions are visible to the whole module", () => {

    test("an exported function calls a private one declared below it", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    return helper( n ) + 1;
}
function helper( x: int ): int { return x * 2; }
`);
        expect( evalInt1( uplc, 5n ) ).toBe( 11n );
    });

    test("a private function calls a private one declared below it", async () => {
        const uplc = await compileFn(`
function first( x: int ): int { return second( x ) + 1; }
function second( x: int ): int { return x * 2; }
export function main( n: int ): int {
    return first( n );
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 11n );
    });

    test("across an import: the exported function of a library calls its private helper declared below", async () => {
        const uplc = await compileFn(`
import { outer } from "./lib.pebble";
export function main( n: int ): int {
    return outer( n );
}`, { "lib.pebble": `
export function outer( x: int ): int { return inner( x ) + 1; }
function inner( x: int ): int { return x * 2; }
` });
        expect( evalInt1( uplc, 5n ) ).toBe( 11n );
    });
});

describe("BUG 56 — ... constants too, and what cannot be compiled is refused", () => {

    test("constants and an unannotated function declared below their use", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    return twice( n ) + K;
}
function twice( x: int ) { return x * TWO; }
const K = TWO + 1;
const TWO = 2;
`);
        expect( evalInt1( uplc, 5n ) ).toBe( 13n );
    });

    test("a function calling itself, declared below its use", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    return fact( n );
}
function fact( x: int ): int { return x <= 1 ? 1 : x * fact( x - 1 ); }
`);
        expect( evalInt1( uplc, 5n ) ).toBe( 120n );
    });

    test("a generic function declared below its use", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    return second( n, n + 1 );
}
function second<T>( a: T, b: T ): T { return other( b ); }
function other<T>( x: T ): T { return x; }
`);
        expect( evalInt1( uplc, 5n ) ).toBe( 6n );
    });

    // two functions defined in terms of each other have no closed term to compile to: each
    // was "not defined" for the other, whatever the order; now the use says what is wrong
    test("mutual recursion is refused with its own error", async () => {
        const ds = await diagnosticsOf(`
function isOdd( n: int ): boolean { return n == 1 || !isEven( n - 1 ); }
function isEven( n: int ): boolean { return n == 0 || !isOdd( n - 1 ); }
export function main( n: int ): int {
    return isOdd( n ) ? 1 : 0;
}`);
        const errors = ds.filter( d => d.startsWith( "ERROR" ) );
        expect( errors.length ).toBe( 1 );
        expect( errors[0] ).toContain( "30210" );
        expect( errors[0] ).toContain( "'isOdd'" );
        expect( errors.join( "\n" ) ).not.toContain( "is not defined" );
    });

    test("constants that need each other are refused with the same error", async () => {
        const ds = await diagnosticsOf(`
const A = B + 1;
const B = A + 1;
export function main( n: int ): int {
    return A + n;
}`);
        const errors = ds.filter( d => d.startsWith( "ERROR" ) );
        expect( errors.some( d => d.includes( "30210" ) && d.includes( "'A'" ) ) ).toBe( true );
        expect( errors.join( "\n" ) ).not.toContain( "is not defined" );
    });

    test("a contract's method calls a function and reads a constant declared below the contract", async () => {
        expect( await contractErrors(`
contract C {
    param owner: bytes;
    spend check( amount: int ) {
        const { tx } = context;
        assert twice( amount ) <= LIMIT;
        assert tx.requiredSigners.includes( this.owner );
    }
}
function twice( x: int ): int { return x * 2; }
const LIMIT = 100;
`) ).toEqual( [] );
    });

    test("a method of a type calls a function declared below it", async () => {
        const uplc = await compileFn(`
type Amount = int;
type Amount implements {
    double( self ): int { return twice( self ); }
}
function twice( x: int ): int { return x * 2; }
export function main( n: int ): int {
    return ( n as Amount ).double();
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 10n );
    });

    test("a name that is not declared anywhere is still not defined", async () => {
        const ds = await diagnosticsOf(`
export function main( n: int ): int {
    return nope( n );
}`);
        expect( ds.filter( d => d.startsWith( "ERROR" ) ).join( "\n" ) ).toContain( "'nope' is not defined" );
    });
});

// --------------------------------------------------------------------------
// BUG 57 — `+` on bytes is concatenation
// --------------------------------------------------------------------------
describe("BUG 57 — `bytes + bytes`", () => {

    test("concatenates", async () => {
        const uplc = await compileFn(`
export function main( n: int ): bytes {
    const a = #dead;
    return a + #beef + std.builtins.integerToByteString( true, 1, n );
}`);
        expect( evalBytes1( uplc, 7n ) ).toBe( "deadbeef07" );
    });

    test("int addition is unaffected", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    return n + 2 + ( #dead + #beef ).length();
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 13n );
    });
});

describe("BUG 57 — ... and `+=` adds what `+` adds", () => {

    test("`+=` on bytes, in a loop", async () => {
        const uplc = await compileFn(`
export function main( n: int ): bytes {
    let acc = #;
    for( const x of [ 1, 2, n ] ) {
        acc += std.builtins.integerToByteString( true, 1, x );
    }
    return acc;
}`);
        expect( evalBytes1( uplc, 7n ) ).toBe( "010207" );
    });

    test("`+=` on a Value, as `+` already added them", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    let total = std.value.singleton( #, #, 1 );
    total += std.value.singleton( #, #, n );
    return ( total + std.value.singleton( #, #, 10 ) ).lovelaces();
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 18n );
    });

    test("string literals concatenate", async () => {
        const uplc = await compileFn(`
export function main( n: int ): bytes {
    return "ab" + "cd" + std.builtins.integerToByteString( true, 1, n );
}`);
        expect( evalBytes1( uplc, 7n ) ).toBe( "6162636407" );
    });

    test("`string` values concatenate (`appendString`)", async () => {
        const uplc = await compileFn(`
export function main( n: int ): bytes {
    const a: string = std.builtins.decodeUtf8( #6162 );
    let b = std.builtins.decodeUtf8( #6364 );
    b += a;
    return std.builtins.encodeUtf8( a + b ) + std.builtins.integerToByteString( true, 1, n );
}`);
        // "ab" + ( "cd" + "ab" ), then the byte
        expect( evalBytes1( uplc, 7n ) ).toBe( "616263646162" + "07" );
    });

    test("an int is still not added to bytes", async () => {
        const ds = await diagnosticsOf(`
export function main( n: int ): bytes {
    return #dead + n;
}`);
        const errors = ds.filter( d => d.startsWith( "ERROR" ) );
        expect( errors.length ).toBe( 1 );
        expect( errors[0] ).toContain( "Type 'int' is not assignable to type 'bytes'" );
    });

    test("a boolean is still not added", async () => {
        const ds = await diagnosticsOf(`
export function main( n: int ): int {
    return ( n > 0 ) + 1;
}`);
        expect( ds.filter( d => d.startsWith( "ERROR" ) ).length ).toBe( 1 );
    });
});

// --------------------------------------------------------------------------
// BUG 58 — destructuring the pair `unConstrData` returns
// --------------------------------------------------------------------------
describe("BUG 58 — `const RawConstr{ index, fields } = unConstrData( d )`", () => {

    test("as documented", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const d = std.builtins.constrData( n, [ (40).toData(), (2).toData() ] );
    const RawConstr{ index, fields } = std.builtins.unConstrData( d );
    return index * 100 + std.builtins.unIData( fields.head() ) + fields.length();
}`);
        expect( evalInt1( uplc, 3n ) ).toBe( 342n );
    });

    test("property access keeps working", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const raw = std.builtins.unConstrData( std.builtins.constrData( n, [ (40).toData() ] ) );
    return raw.index * 100 + std.builtins.unIData( raw.fields.head() );
}`);
        expect( evalInt1( uplc, 3n ) ).toBe( 340n );
    });
});

describe("BUG 58 — ... every form a pair's two properties are destructured in", () => {

    test("renamed, as the docs' laws write it", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const d = std.builtins.constrData( n, [ (40).toData(), (2).toData() ] );
    const RawConstr{ index: i, fields: fs } = std.builtins.unConstrData( d );
    return i * 100 + std.builtins.unIData( fs.head() ) + fs.length();
}`);
        expect( evalInt1( uplc, 3n ) ).toBe( 342n );
    });

    test("one property only, and with `let`", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const d = std.builtins.constrData( n, [ (40).toData() ] );
    const RawConstr{ fields } = std.builtins.unConstrData( d );
    let RawConstr{ index } = std.builtins.unConstrData( d );
    index = index + 1;
    return index * 100 + std.builtins.unIData( fields.head() );
}`);
        expect( evalInt1( uplc, 3n ) ).toBe( 440n );
    });

    test("without the name, as a map entry is", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const { index, fields } = std.builtins.unConstrData( std.builtins.constrData( n, [ (40).toData() ] ) );
    return index * 100 + std.builtins.unIData( fields.head() );
}`);
        expect( evalInt1( uplc, 3n ) ).toBe( 340n );
    });

    test("the fields destructured further", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    const d = std.builtins.constrData( n, [ (40).toData(), (2).toData() ] );
    const RawConstr{ index, fields: [ first, second ] } = std.builtins.unConstrData( d );
    return index * 100 + std.builtins.unIData( first ) + std.builtins.unIData( second );
}`);
        expect( evalInt1( uplc, 3n ) ).toBe( 342n );
    });

    test("another name, or a property it does not have, is refused", async () => {
        const wrongName = await diagnosticsOf(`
export function main( n: int ): int {
    const Constr{ index } = std.builtins.unConstrData( std.builtins.constrData( n, [] ) );
    return index;
}`);
        // (and `index`, which the refused declaration never declared, is then not defined)
        const wrongNameErrors = wrongName.filter( d => d.startsWith( "ERROR" ) );
        expect( wrongNameErrors.length ).toBeGreaterThan( 0 );
        expect( wrongNameErrors[0] ).toContain( "'Constr'" );
        expect( wrongNameErrors[0] ).toContain( "RawConstr" );

        const wrongField = await diagnosticsOf(`
export function main( n: int ): int {
    const RawConstr{ tag } = std.builtins.unConstrData( std.builtins.constrData( n, [] ) );
    return tag;
}`);
        expect( wrongField.filter( d => d.startsWith( "ERROR" ) )[0] ).toContain( "'tag'" );
    });

    test("map entries still destructure, a value destructured further too", async () => {
        const uplc = await compileFn(`
struct P { x: int, y: int }
export function main( n: int ): int {
    const m: LinearMap<int, P> = { 1: P.P{ x: n, y: 2 }, 2: P.P{ x: 10, y: 20 } };
    let total = 0;
    for( const { key, value: P{ x, y } } of m ) {
        total = total + key * 1000 + x * 10 + y;
    }
    const { key: firstKey } = m.head();
    return total + firstKey * 100000;
}`);
        // entries: 1000 + 70 + 2 = 1072 ; 2000 + 100 + 20 = 2120 ; firstKey 1
        expect( evalInt1( uplc, 7n ) ).toBe( 1072n + 2120n + 100000n );
    });
});

// --------------------------------------------------------------------------
// BUG 59 — warning 6134 on a const every continuing path reads
// --------------------------------------------------------------------------
describe("BUG 59 — warning 6134 is not raised for a const two statements read", () => {

    const prelude = `
function toValue( n: int ): Value {
    assert n > 0;
    return std.value.singleton( #aa, #bb, n );
}
`;
    const warnings6134 = async ( body: string ) => {
        const ds = await diagnosticsOf( prelude + body );
        expect( ds.filter( d => d.startsWith( "ERROR" ) ) ).toEqual( [] );
        return ds.filter( d => d.includes( "6134" ) );
    };

    // the kernel's loop over the outputs: `total` is read by the assert (as an argument of a
    // method of `Value`, which may not need it) AND by the statement after it. Two reads in
    // two statements meet before the first: the value is computed there, on every way
    test("read by an assert and by the statement after it, in a branch of a loop body", async () => {
        expect( await warnings6134(`
export function main( xs: List<int> ): int {
    const limit = std.value.singleton( #aa, #bb, 1000 );
    let sum = std.value.zero;
    for( const x of xs ) {
        if( x > 100 ) {
            sum = sum.union( limit );
        } else if( x > 10 ) {
            const total = toValue( x );
            assert limit.contains( total );
            sum = sum.union( total );
        }
    }
    return sum.amountOf( #aa, #bb );
}`) ).toEqual( [] );
    });

    test("read by an assert and by the return after it", async () => {
        expect( await warnings6134(`
export function main( n: int ): int {
    const limit = std.value.singleton( #aa, #bb, 1000 );
    const total = toValue( n );
    assert limit.contains( total );
    return total.amountOf( #aa, #bb );
}`) ).toEqual( [] );
    });

    test("read by the condition of an `if` and by one of its branches", async () => {
        expect( await warnings6134(`
export function main( n: int ): int {
    const limit = std.value.singleton( #aa, #bb, 1000 );
    const total = toValue( n );
    if( limit.contains( total ) ) {
        return total.amountOf( #aa, #bb );
    }
    return 0;
}`) ).toEqual( [] );
    });

    // the value really is computed on the way that reads it once only: evaluated, the
    // assert inside `toValue` fails although the branch reading `total` twice is not taken
    test("and the value is computed where the analysis says: before the assert", async () => {
        const uplc = await compileFn( prelude + `
export function main( n: int ): int {
    const limit = std.value.singleton( #aa, #bb, 1000 );
    const total = toValue( n );
    assert limit.contains( std.value.zero ) || limit.contains( total );
    return n > 100 ? total.amountOf( #aa, #bb ) : 0;
}`);
        // n = 0: `limit.contains( zero )` holds, so neither read of `total` is reached; still,
        // the two reads met before the assert, and `toValue( 0 )` fails there
        expect( () => evalInt1( uplc, 0n ) ).toThrow( /eval failed/ );
        expect( evalInt1( uplc, 5n ) ).toBe( 0n );
    });

    test("... and before the `if` whose condition and branch both may read it", async () => {
        const src = prelude + `
export function main( n: int ): int {
    const limit = std.value.singleton( #aa, #bb, 1000 );
    const total = toValue( n );
    if( n < 0 - 5 || limit.contains( total ) ) {
        return n > 100 ? total.amountOf( #aa, #bb ) : 1;
    }
    return 0;
}`;
        expect( ( await diagnosticsOf( src ) ).filter( d => d.includes( "6134" ) ) ).toEqual( [] );
        const uplc = await compileFn( src );
        // n = -10: the condition holds on its left side and the branch returns 1 without
        // reading `total`; the two reads met before the `if`, where `toValue( -10 )` fails
        expect( () => evalInt1( uplc, -10n ) ).toThrow( /eval failed/ );
        expect( evalInt1( uplc, 5n ) ).toBe( 1n );
    });

    test("... and before the `match` whose matched value and case both may read it", async () => {
        const src = prelude + `
function pick( n: int, v: Value ): Optional<int> {
    return n < 0 - 5 ? Some{ value: 1 } : Some{ value: v.amountOf( #aa, #bb ) };
}
export function main( n: int ): int {
    const total = toValue( n );
    let result = 0;
    match( pick( n, total ) ) {
        when Some{ value }: { result = n > 100 ? total.amountOf( #aa, #bb ) : value; }
        when None{}: { result = 0; }
    }
    return result;
}`;
        expect( ( await diagnosticsOf( src ) ).filter( d => d.includes( "6134" ) ) ).toEqual( [] );
        const uplc = await compileFn( src );
        expect( () => evalInt1( uplc, -10n ) ).toThrow( /eval failed/ );
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("it is still raised when one branch only reads the const", async () => {
        expect( ( await warnings6134(`
export function main( n: int ): int {
    const total = toValue( n );
    if( n > 10 ) {
        return total.amountOf( #aa, #bb );
    }
    return 0;
}`) ).length ).toBe( 1 );
    });

    test("it is still raised when an assert only MAY read it and nothing else does", async () => {
        expect( ( await warnings6134(`
export function main( n: int ): int {
    const limit = std.value.singleton( #aa, #bb, 1000 );
    const total = toValue( n );
    assert n > 1000 || limit.contains( total );
    return n;
}`) ).length ).toBe( 1 );
    });
});

// --------------------------------------------------------------------------
// BUG 61 — a name means what its own module says, whatever other modules call theirs
// --------------------------------------------------------------------------
describe("BUG 61 — functions of different modules with the same name", () => {

    test("two libraries each with a private `helper`", async () => {
        const uplc = await compileFn(`
import { a } from "./a.pebble";
import { b } from "./b.pebble";
export function main( n: int ): int {
    return a( n ) * 1000 + b( n );
}`, {
            "a.pebble": `
function helper( x: int ): int { return x + 1; }
export function a( x: int ): int { return helper( x ); }
`,
            "b.pebble": `
function helper( x: int ): int { return x * 2; }
export function b( x: int ): int { return helper( x ); }
`
        });
        // a( 5 ) = 6, b( 5 ) = 10; it was 10 and 10: both ran b's helper
        expect( evalInt1( uplc, 5n ) ).toBe( 6010n );
    });

    test("the entry module's private function named like a library's", async () => {
        const uplc = await compileFn(`
import { a } from "./a.pebble";
function helper( x: int ): int { return x * 3; }
export function main( n: int ): int {
    return a( n ) * 1000 + helper( n );
}`, {
            "a.pebble": `
function helper( x: int ): int { return x + 1; }
export function a( x: int ): int { return helper( x ); }
`
        });
        expect( evalInt1( uplc, 5n ) ).toBe( 6015n );
    });

    test("an imported function named like a private one of another module", async () => {
        const uplc = await compileFn(`
import { helper } from "./a.pebble";
import { b } from "./b.pebble";
export function main( n: int ): int {
    return helper( n ) * 1000 + b( n );
}`, {
            "a.pebble": `
export function helper( x: int ): int { return x + 1; }
`,
            "b.pebble": `
function helper( x: int ): int { return x * 2; }
export function b( x: int ): int { return helper( x ); }
`
        });
        expect( evalInt1( uplc, 5n ) ).toBe( 6010n );
    });

    test("two modules importing different functions under one alias", async () => {
        const uplc = await compileFn(`
import { a } from "./a.pebble";
import { b } from "./b.pebble";
export function main( n: int ): int {
    return a( n ) * 1000 + b( n );
}`, {
            "lib.pebble": `
export function inc( x: int ): int { return x + 1; }
export function dbl( x: int ): int { return x * 2; }
`,
            "a.pebble": `
import { inc as f } from "./lib.pebble";
export function a( x: int ): int { return f( x ); }
`,
            "b.pebble": `
import { dbl as f } from "./lib.pebble";
export function b( x: int ): int { return f( x ); }
`
        });
        expect( evalInt1( uplc, 5n ) ).toBe( 6010n );
    });

    test("an imported generic function named like a generic one of another module", async () => {
        const uplc = await compileFn(`
import { pick } from "./a.pebble";
import { b } from "./b.pebble";
export function main( n: int ): int {
    return pick( n, 0 ) * 1000 + b( n );
}`, {
            "a.pebble": `
export function pick<T>( x: T, y: T ): T { return x; }
`,
            "b.pebble": `
function pick<T>( x: T, y: T ): T { return y; }
export function b( x: int ): int { return pick( 0, x + 1 ); }
`
        });
        // a's pick( 5, 0 ) = 5, b( 5 ) = 6. The call found b's `pick` in the program's one
        // table of generic functions: "the type argument for 'T' cannot be inferred"
        expect( evalInt1( uplc, 5n ) ).toBe( 5006n );
    });

    test("an unannotated function takes nothing from another module's of the same name", async () => {
        const uplc = await compileFn(`
import { a } from "./a.pebble";
import { b } from "./b.pebble";
export function main( n: int ): int {
    return a( n ) * 1000 + b( #aabbcc ) + n;
}`, {
            "a.pebble": `
function helper( x: int ) { return x + 1; }
export function a( x: int ): int { return helper( x ); }
`,
            "b.pebble": `
function helper( x: bytes ) { return x.length(); }
export function b( x: bytes ): int { return helper( x ); }
`
        });
        expect( evalInt1( uplc, 5n ) ).toBe( 6008n );
    });

    // warnings 6133 and 6134 ask what the function a call calls can do: they asked the
    // program's one table by the bare name too
    test("the unused-value warning looks at the module's own function", async () => {
        const lib = {
            "a.pebble": `
function helper( x: int ): int { return x + 1; }
export function a( x: int ): int {
    const unused = helper( x );
    return x;
}
`
        };
        // a's `helper` cannot fail: nothing to warn about, whatever the entry calls its own
        const ds = await diagnosticsOf(`
import { a } from "./a.pebble";
function helper( x: int ): int { assert x > 0; return x; }
export function main( n: int ): int {
    return a( n ) + helper( n );
}`, lib );
        expect( ds.filter( d => d.startsWith( "ERROR" ) ) ).toEqual( [] );
        expect( ds.filter( d => d.includes( "6133" ) ) ).toEqual( [] );
    });

    test("... and at an imported function under the name it is imported with", async () => {
        const ds = await diagnosticsOf(`
import { check as verify } from "./lib.pebble";
export function main( n: int ): int {
    const unused = verify( n );
    return n;
}`, { "lib.pebble": `
export function check( x: int ): int { assert x > 0; return x; }
` });
        expect( ds.filter( d => d.startsWith( "ERROR" ) ) ).toEqual( [] );
        const warnings = ds.filter( d => d.includes( "6133" ) );
        expect( warnings.length ).toBe( 1 );
        expect( warnings[0] ).toContain( "'unused'" );
    });

    test("`export` takes the entry module's function, not a library's of the same name", async () => {
        const uplc = await compileFn(`
import { a } from "./a.pebble";
export function main( n: int ): int {
    return a( n ) + 1000;
}`, {
            "a.pebble": `
export function main( x: int ): int { return x * 7; }
export function a( x: int ): int { return main( x ) + 1; }
`
        });
        // a( 5 ) = 36; the entry's main = 1036. It was 35: the library's `main` was exported
        expect( evalInt1( uplc, 5n ) ).toBe( 1036n );
    });

    test("`export` of a function the entry module imports", async () => {
        const uplc = await compileFn(`
import { main } from "./a.pebble";
export function other( n: int ): int { return main( n ); }
`, {
            "a.pebble": `
export function main( x: int ): int { return x * 7; }
`
        });
        expect( evalInt1( uplc, 5n ) ).toBe( 35n );
    });
});

// --------------------------------------------------------------------------
// BUG 62 — a method is the one the receiver's declared type has
// --------------------------------------------------------------------------
describe("BUG 62 — a method of an alias, called on a variable annotated with the alias", () => {

    const amount = `
type Amount = int;
type Amount implements {
    double( self ): int { return self * 2; }
    plus( self, other: Amount ): Amount { return self + other; }
}
`;

    test("`const a: Amount = n; a.double()`", async () => {
        const uplc = await compileFn( amount + `
export function main( n: int ): int {
    const a: Amount = n;
    return a.double();
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 10n );
    });

    test("a `let` of the alias, reassigned, and a method returning the alias", async () => {
        const uplc = await compileFn( amount + `
export function main( n: int ): int {
    let a: Amount = n;
    a = a.plus( 1 );
    const b: Amount = a.plus( a );
    return b.double();
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 24n );
    });

    test("a parameter of the alias, and a converted value, as before", async () => {
        const uplc = await compileFn( amount + `
function twice( a: Amount ): int { return a.double(); }
export function main( n: int ): int {
    return twice( n ) + ( n as Amount ).double();
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 20n );
    });

    test("the methods of the type below still win over the alias when it declares none", async () => {
        const uplc = await compileFn(`
type Name = bytes;
export function main( n: int ): int {
    const name: Name = #aabbcc;
    return name.length() + n;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 8n );
    });
});

// --------------------------------------------------------------------------
// BUG 63 — a namespace's functions and constants see their module's, and are seen by it
// --------------------------------------------------------------------------
describe("BUG 63 — namespaces and the declarations of their module", () => {

    test("a namespace's function calls a function of the module", async () => {
        const uplc = await compileFn(`
function inc( x: int ): int { return x + 1; }
namespace M {
    function twiceInc( x: int ): int { return inc( x ) * 2; }
}
export function main( n: int ): int {
    return M.twiceInc( n );
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 12n );
    });

    test("in any order: module -> namespace -> nested namespace -> module", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    return M.twiceInc( n ) + M.K + other( n );
}
function other( x: int ): int { return M.viaPrivate( x ); }
namespace M {
    function twiceInc( x: int ): int { return inc( x ) * 2 + N.three(); }
    const K = inc( 100 );
    private function secret( x: int ): int { return x + K; }
    function viaPrivate( x: int ): int { return secret( x ); }
    namespace N {
        function three(): int { return inc( 2 ); }
    }
}
function inc( x: int ): int { return x + 1; }
`);
        // twiceInc( 5 ) = 6 * 2 + 3 = 15; K = 101; other( 5 ) = 5 + 101 = 106
        expect( evalInt1( uplc, 5n ) ).toBe( 15n + 101n + 106n );
    });

    test("`using` members of a namespace declared below", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    using { twice, K } = M;
    return twice( n ) + K;
}
namespace M {
    function twice( x: int ): int { return dbl( x ); }
    const K = dbl( 4 );
}
function dbl( x: int ): int { return x * 2; }
`);
        expect( evalInt1( uplc, 5n ) ).toBe( 18n );
    });

    test("a private member is still private", async () => {
        const ds = await diagnosticsOf(`
namespace M {
    private function secret( x: int ): int { return x; }
}
export function main( n: int ): int {
    return M.secret( n );
}`);
        expect( ds.filter( d => d.startsWith( "ERROR" ) ).join( "\n" ) ).toContain( "no exported member 'secret'" );
    });

    test("mutual recursion through a namespace is refused with its own error", async () => {
        const ds = await diagnosticsOf(`
export function main( n: int ): int { return a( n ); }
function a( x: int ): int { return x == 0 ? 0 : M.b( x - 1 ); }
namespace M {
    function b( x: int ): int { return x == 0 ? 1 : a( x - 1 ); }
}`);
        const errors = ds.filter( d => d.startsWith( "ERROR" ) );
        expect( errors.some( d => d.includes( "30210" ) ) ).toBe( true );
        expect( errors.join( "\n" ) ).not.toContain( "is not defined" );
    });
});

// --------------------------------------------------------------------------
// BUG 64 — `xs.head()` and `xs.tail()` behind an `if` do not run when the `if` is not taken
// --------------------------------------------------------------------------
describe("BUG 64 — the head and the tail of a list, read in a branch", () => {

    // the optimizer turns `headList( xs )` + `tailList( xs )` into one `case xs of cons h t`.
    // It put the case around the whole body of the loop: `xs` was destructured on EVERY
    // iteration, taken or not, and the script failed as soon as the list was empty
    test("in an `if` of a loop body: the list is read only when the branch is taken", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    let due: List<int> = [ 3 ];
    let acc = 0;
    for( const o of [ 5, 1, 2, 7 ] ) {
        if( o == n ) {
            const t = due.head();
            due = due.tail();
            acc = acc + t;
        }
    }
    assert due.isEmpty();
    return acc;
}`);
        // the branch is taken once, at 2; at 7 `due` is empty and nothing reads it
        expect( evalInt1( uplc, 2n ) ).toBe( 3n );
    });

    test("the same in an `else if`, with a list of structs", async () => {
        const uplc = await compileFn(`
struct Triple { target: bytes, count: int, value: List<int> }
export function main( n: int ): int {
    const first = Triple.Triple{ target: #aa, count: 3, value: [ 1 ] };
    let due: List<Triple> = [ first ];
    let acc = 0;
    for( const o of [ 5, 1, 2, 7 ] ) {
        if( o == 1 ) {
            acc = acc + 100;
        } else if( o == n ) {
            const triple = due.head();
            due = due.tail();
            acc = acc + triple.count;
        }
    }
    assert due.isEmpty();
    return acc;
}`);
        expect( evalInt1( uplc, 2n ) ).toBe( 103n );
    });

    test("an empty list whose head and tail are in branches never taken", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    let due: List<int> = n > 5 ? [ 3 ] : [];
    let acc = 0;
    for( const o of [ 1, 2 ] ) {
        if( n > 5 && o == 1 ) {
            acc = acc + due.head();
        } else if( n > 5 ) {
            due = due.tail();
        }
    }
    return acc + due.length();
}`);
        expect( evalInt1( uplc, 2n ) ).toBe( 0n );
        expect( evalInt1( uplc, 9n ) ).toBe( 3n );
    });

    test("an empty list read where it must not be still fails", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    let due: List<int> = [ 3 ];
    let acc = 0;
    for( const o of [ 2, 2 ] ) {
        if( o == n ) {
            const t = due.head();
            due = due.tail();
            acc = acc + t;
        }
    }
    return acc;
}`);
        // taken twice: the second time the list is empty
        expect( () => evalInt1( uplc, 2n ) ).toThrow( /eval failed/ );
        expect( evalInt1( uplc, 9n ) ).toBe( 0n );
    });

    test("read on every way, the head and the tail still cost one `case`", async () => {
        const uplc = await compileFn(`
export function main( n: int ): int {
    let due: List<int> = [ 3, 4 ];
    let acc = 0;
    for( const o of [ 5, 1 ] ) {
        const t = due.head();
        due = due.tail();
        acc = acc + t + o;
    }
    assert due.isEmpty();
    return acc + n;
}`);
        expect( evalInt1( uplc, 2n ) ).toBe( 15n );
    });
});

describe("BUG 64 — where the pass puts the `case`", () => {

    // the pass acts on a function in which the list is FREE: `outer` binds it, `inner` uses it
    const build = ( body: ( xs: symbol, k: symbol ) => IRTerm ): { inner: IRFunc, xs: symbol } => {
        const xs = Symbol( "xs" );
        const k = Symbol( "k" );
        const inner = new IRFunc( [ k ], body( xs, k ) );
        const outer = new IRFunc( [ xs ], inner );
        introduceCaseForDualHeadTailAndReturnRoot( outer );
        return { inner, xs };
    };
    const head = ( xs: symbol ) => _ir_apps( IRNative.headList, new IRVar( xs ) );
    const tail = ( xs: symbol ) => _ir_apps( IRNative.tailList, new IRVar( xs ) );
    const isListCase = ( t: IRTerm, xs: symbol ): t is IRCase =>
        t instanceof IRCase && t.constrTerm instanceof IRVar && t.constrTerm.name === xs;
    /** how many `headList( xs )` / `tailList( xs )` are left in `t` */
    const builtinsLeft = ( t: IRTerm ): number => {
        let n = 0;
        const stack: IRTerm[] = [ t ];
        while( stack.length > 0 )
        {
            const node = stack.pop()!;
            if(
                node instanceof IRApp
                && node.fn instanceof IRNative
                && ( node.fn.tag === IRNativeTag.headList || node.fn.tag === IRNativeTag.tailList )
            ) n++;
            stack.push( ...node.children() );
        }
        return n;
    };

    test("both reached whenever the body is: around the whole body, as before", () => {
        const { inner, xs } = build( xs => new IRConstr( 0, [ head( xs ), tail( xs ) ] ) );
        expect( isListCase( inner.body, xs ) ).toBe( true );
        expect( builtinsLeft( inner ) ).toBe( 0 );
    });

    test("one reached whenever the body is, the other in a branch: around the whole body", () => {
        const { inner, xs } = build( ( xs, k ) => new IRConstr( 0, [
            head( xs ),
            new IRCase( new IRVar( k ), [ IRConst.int( 0 ), tail( xs ) ] )
        ] ) );
        expect( isListCase( inner.body, xs ) ).toBe( true );
        expect( builtinsLeft( inner ) ).toBe( 0 );
    });

    test("both in one branch: around that branch, not around the body", () => {
        const { inner, xs } = build( ( xs, k ) => new IRCase( new IRVar( k ), [
            IRConst.int( 0 ),
            new IRConstr( 0, [ head( xs ), tail( xs ) ] )
        ] ) );
        // the body is still the branch on `k`...
        expect( isListCase( inner.body, xs ) ).toBe( false );
        expect( inner.body ).toBeInstanceOf( IRCase );
        const branches = ( inner.body as IRCase ).continuations;
        // ...whose first arm does not touch the list, and whose second destructures it
        expect( branches[0] ).toBeInstanceOf( IRConst );
        expect( isListCase( branches[1], xs ) ).toBe( true );
        expect( builtinsLeft( inner ) ).toBe( 0 );
    });

    test("one in each branch: no way through reads both, the builtins stay", () => {
        const { inner, xs } = build( ( xs, k ) => new IRCase( new IRVar( k ), [ head( xs ), tail( xs ) ] ) );
        expect( isListCase( inner.body, xs ) ).toBe( false );
        expect( builtinsLeft( inner ) ).toBe( 2 );
        const branches = ( inner.body as IRCase ).continuations;
        expect( isListCase( branches[0], xs ) ).toBe( false );
        expect( isListCase( branches[1], xs ) ).toBe( false );
    });
});
