import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { Data, DataConstr, DataI, DataList } from "@harmoniclabs/plutus-data";
import { testOptions, COMPILER_VERSION, EncodingStrategy } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";

/*
 * The declaration FORM of a single-constructor struct picks its data
 * encoding:
 *
 *   struct ListEncoded { a: int }                                -> listData( fields )
 *   struct SingleConstrEncoded { SingleConstrEncoded { a: int } } -> constrData( 0, fields )
 *
 * Every test asserts EVALUATED results: values are built and read back on
 * the CEK machine, through each lowering path a struct value can take
 * (parameter, const binding, cast, destructuring, loop variable, nested
 * field, generic instantiation).
 */

const BOTH_FORMS = `
struct ListEncoded {
    a: int
}
struct SingleConstrEncoded {
    SingleConstrEncoded { a: int }
}
`;

async function exportFn(
    src: string,
    functionName: string,
    encodingStrategy?: EncodingStrategy
): Promise<UPLCTerm>
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler( ioApi, {
        ...testOptions,
        compilerVersion: COMPILER_VERSION,
        ...( encodingStrategy ? { encodingStrategy } : {} )
    } as any );
    await compiler.export({ functionName, entry: "main.pebble", root: "/" } as any );
    const errors = compiler.diagnostics.map( d => d.toString() );
    if( errors.length > 0 ) throw new Error( "compilation failed:\n" + errors.join( "\n" ) );
    return parseUPLC( ioApi.outputs.get( "out/out.flat" ) as Uint8Array ).body;
}

function evalTo( uplc: UPLCTerm, arg: UPLCConst ): any
{
    const r = Machine.eval( new Application( uplc, arg ) ).result;
    if( r instanceof CEKError ) throw new Error( "eval failed: " + String( r.msg ) );
    if( !( r instanceof CEKConst ) ) throw new Error( "expected a constant result" );
    return r.value;
}

const listOf = ( ...ns: number[] ): Data => new DataList( ns.map( n => new DataI( n ) ) );
const constr0Of = ( ...ns: number[] ): Data => new DataConstr( 0, ns.map( n => new DataI( n ) ) );

jest.setTimeout( 300_000 );

describe("struct declaration form picks the data encoding", () => {

    test("shortcut form is built as listData( fields )", async () => {
        const uplc = await exportFn( BOTH_FORMS + `
export function build( n: int ): data {
    const v = ListEncoded{ a: n };
    return v as data;
}`, "build" );
        expect( evalTo( uplc, UPLCConst.int( 7 ) ) ).toEqual( listOf( 7 ) );
    });

    test("explicit single-constructor form is built as constrData( 0, fields )", async () => {
        const uplc = await exportFn( BOTH_FORMS + `
export function build( n: int ): data {
    const v = SingleConstrEncoded{ a: n };
    return v as data;
}`, "build" );
        expect( evalTo( uplc, UPLCConst.int( 7 ) ) ).toEqual( constr0Of( 7 ) );
    });

    test("shortcut form reads a list, and REJECTS the constructor encoding", async () => {
        const uplc = await exportFn( BOTH_FORMS + `
export function read( d: data ): int {
    const v = d as ListEncoded;
    return v.a;
}`, "read" );
        expect( evalTo( uplc, UPLCConst.data( listOf( 42 ) ) ) ).toBe( 42n );
        expect( () => evalTo( uplc, UPLCConst.data( constr0Of( 42 ) ) ) ).toThrow();
    });

    test("explicit form reads a constructor, and REJECTS the list encoding", async () => {
        const uplc = await exportFn( BOTH_FORMS + `
export function read( d: data ): int {
    const v = d as SingleConstrEncoded;
    return v.a;
}`, "read" );
        expect( evalTo( uplc, UPLCConst.data( constr0Of( 42 ) ) ) ).toBe( 42n );
        expect( () => evalTo( uplc, UPLCConst.data( listOf( 42 ) ) ) ).toThrow();
    });

    test("both forms in one program keep their own encoding", async () => {
        const uplc = await exportFn( BOTH_FORMS + `
export function both( n: int ): List<data> {
    const l = ListEncoded{ a: n };
    const c = SingleConstrEncoded{ a: n };
    return [ l as data, c as data ];
}`, "both" );
        expect( evalTo( uplc, UPLCConst.int( 3 ) ) ).toEqual([ listOf( 3 ), constr0Of( 3 ) ]);
    });

    test("multi-constructor structs are untouched (constructor index is the tag)", async () => {
        const uplc = await exportFn( `
struct Shape {
    Circle { r: int }
    Rect { w: int, h: int }
}
export function build( n: int ): data {
    const s: Shape = Shape.Rect{ w: n, h: n };
    return s as data;
}`, "build" );
        expect( evalTo( uplc, UPLCConst.int( 2 ) ) ).toEqual( new DataConstr( 1, [ new DataI( 2 ), new DataI( 2 ) ] ) );
    });

    test("empty shortcut struct is the empty list", async () => {
        const uplc = await exportFn( `
struct Unit {}
export function build( n: int ): data {
    const u = Unit{};
    return u as data;
}`, "build" );
        expect( evalTo( uplc, UPLCConst.int( 0 ) ) ).toEqual( new DataList( [] ) );
    });
});

describe("encodingStrategy", () => {

    const src = BOTH_FORMS + `
export function build( n: int ): data {
    const v = ListEncoded{ a: n };
    return v as data;
}`;

    test("\"legacy\" keeps the shortcut form as constrData( 0, fields )", async () => {
        const uplc = await exportFn( src, "build", "legacy" );
        expect( evalTo( uplc, UPLCConst.int( 7 ) ) ).toEqual( constr0Of( 7 ) );
    });

    test("\"default\" (the pre-0.5.0 spelling) still means legacy", async () => {
        const uplc = await exportFn( src, "build", "default" );
        expect( evalTo( uplc, UPLCConst.int( 7 ) ) ).toEqual( constr0Of( 7 ) );
    });

    test("\"minimal\" is what no option gives", async () => {
        const uplc = await exportFn( src, "build", "minimal" );
        expect( evalTo( uplc, UPLCConst.int( 7 ) ) ).toEqual( listOf( 7 ) );
    });

    test("`untagged` forces the list encoding under \"legacy\"", async () => {
        const uplc = await exportFn( `
untagged struct Forced { a: int }
export function build( n: int ): data {
    const v = Forced{ a: n };
    return v as data;
}`, "build", "legacy" );
        expect( evalTo( uplc, UPLCConst.int( 7 ) ) ).toEqual( listOf( 7 ) );
    });
});

describe("list-encoded structs through every lowering path", () => {

    const P = `
struct P { x: int, y: int }
struct Outer { Outer { label: int, inner: P } }
struct Box<T> { v: T }
`;

    test("function parameter field access", async () => {
        const uplc = await exportFn( P + `
export function f( p: P ): int { return p.x * 10 + p.y; }`, "f" );
        expect( evalTo( uplc, UPLCConst.data( listOf( 4, 2 ) ) ) ).toBe( 42n );
    });

    test("const re-binding, then field access", async () => {
        const uplc = await exportFn( P + `
export function f( p: P ): int {
    const q: P = p;
    return q.x * 10 + q.y;
}`, "f" );
        expect( evalTo( uplc, UPLCConst.data( listOf( 4, 2 ) ) ) ).toBe( 42n );
    });

    test("literal bound to a const, then field access", async () => {
        const uplc = await exportFn( P + `
export function f( n: int ): int {
    const p = P{ x: n, y: 2 };
    return p.x * 10 + p.y;
}`, "f" );
        expect( evalTo( uplc, UPLCConst.int( 4 ) ) ).toBe( 42n );
    });

    test("literal -> data -> struct round trip", async () => {
        const uplc = await exportFn( P + `
export function f( n: int ): int {
    const lit = P{ x: n, y: 2 };
    const d = lit as data;
    const p = d as P;
    return p.x * 10 + p.y;
}`, "f" );
        expect( evalTo( uplc, UPLCConst.int( 4 ) ) ).toBe( 42n );
    });

    test("named destructuring", async () => {
        const uplc = await exportFn( P + `
export function f( p: P ): int {
    const P{ x, y } = p;
    return x * 10 + y;
}`, "f" );
        expect( evalTo( uplc, UPLCConst.data( listOf( 4, 2 ) ) ) ).toBe( 42n );
    });

    test("unnamed destructuring", async () => {
        const uplc = await exportFn( P + `
export function f( p: P ): int {
    const { x, y } = p;
    return x * 10 + y;
}`, "f" );
        expect( evalTo( uplc, UPLCConst.data( listOf( 4, 2 ) ) ) ).toBe( 42n );
    });

    test("loop variable", async () => {
        const uplc = await exportFn( P + `
export function f( d: data ): int {
    const ps = d as List<P>;
    let total = 0;
    for( const p of ps ) total = total + p.x * p.y;
    return total;
}`, "f" );
        expect( evalTo( uplc, UPLCConst.data( new DataList([ listOf( 2, 3 ), listOf( 4, 9 ) ]) ) ) ).toBe( 42n );
    });

    test("list-encoded struct nested in a constructor-encoded one", async () => {
        const uplc = await exportFn( P + `
export function f( o: Outer ): int {
    return o.label + o.inner.x * 10 + o.inner.y;
}`, "f" );
        const outer = new DataConstr( 0, [ new DataI( 100 ), listOf( 4, 2 ) ] );
        expect( evalTo( uplc, UPLCConst.data( outer ) ) ).toBe( 142n );
    });

    test("nested destructuring across the two encodings", async () => {
        const uplc = await exportFn( P + `
export function f( o: Outer ): int {
    const Outer{ label, inner: P{ x, y } } = o;
    return label + x * 10 + y;
}`, "f" );
        const outer = new DataConstr( 0, [ new DataI( 100 ), listOf( 4, 2 ) ] );
        expect( evalTo( uplc, UPLCConst.data( outer ) ) ).toBe( 142n );
    });

    test("generic shortcut struct", async () => {
        const uplc = await exportFn( P + `
export function f( n: int ): data {
    const b: Box<int> = Box{ v: n };
    return b as data;
}`, "f" );
        expect( evalTo( uplc, UPLCConst.int( 42 ) ) ).toEqual( listOf( 42 ) );
    });

    test("generic shortcut struct read back from a list", async () => {
        const uplc = await exportFn( P + `
export function f( d: data ): int {
    const b = d as Box<int>;
    return b.v;
}`, "f" );
        expect( evalTo( uplc, UPLCConst.data( listOf( 42 ) ) ) ).toBe( 42n );
    });

    test("`case` over a list-encoded struct", async () => {
        const uplc = await exportFn( P + `
export function f( p: P ): int {
    return case p
        is P{ x, y } => x * 10 + y;
}`, "f" );
        expect( evalTo( uplc, UPLCConst.data( listOf( 4, 2 ) ) ) ).toBe( 42n );
    });

    test("equality compares the encoded values", async () => {
        const uplc = await exportFn( P + `
export function f( p: P ): bool {
    return p == P{ x: 4, y: 2 };
}`, "f" );
        expect( evalTo( uplc, UPLCConst.data( listOf( 4, 2 ) ) ) ).toBe( true );
        expect( evalTo( uplc, UPLCConst.data( listOf( 4, 3 ) ) ) ).toBe( false );
    });
});

describe("the two encodings do not convert into each other silently", () => {

    test("casting between same-shape structs of different encoding is a compile error", async () => {
        await expect( exportFn( `
data struct ListEncoded { a: int }
data struct SingleConstrEncoded { SingleConstrEncoded { a: int } }
export function f( d: data ): int {
    const c = d as SingleConstrEncoded;
    const l = c as ListEncoded;
    return l.a;
}`, "f" ) ).rejects.toThrow();
    });

    test("casting between same-shape structs of the SAME encoding still works", async () => {
        const uplc = await exportFn( `
data struct A { a: int }
data struct B { a: int }
export function f( d: data ): int {
    const x = d as A;
    const y = x as B;
    return y.a;
}`, "f" );
        expect( evalTo( uplc, UPLCConst.data( listOf( 42 ) ) ) ).toBe( 42n );
    });

    test("`untagged` is accepted inside a namespace", async () => {
        const uplc = await exportFn( `
namespace N {
    export untagged struct U { a: int }
    export struct S { a: int }
}
export function f( d: data ): int {
    const u = d as N.U;
    const s = d as N.S;
    return u.a + s.a;
}`, "f", "legacy" );
        // under "legacy" only `U` is list-encoded, so reading the same
        // list as `S` must fail
        expect( () => evalTo( uplc, UPLCConst.data( listOf( 21 ) ) ) ).toThrow();
        const onlyU = await exportFn( `
namespace N {
    export untagged struct U { a: int }
}
export function f( d: data ): int {
    const u = d as N.U;
    return u.a * 2;
}`, "f", "legacy" );
        expect( evalTo( onlyU, UPLCConst.data( listOf( 21 ) ) ) ).toBe( 42n );
    });
});
