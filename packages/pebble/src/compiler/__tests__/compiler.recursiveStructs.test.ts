import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

// Recursive structs (0.4.3): forward declaration lets a struct's fields
// reference the struct itself (or a later sibling). Data-encoded recursion
// is fully supported (decode is lazy, one level per `case`); runtime (SoP)
// recursion is runtime-only — building/matching works, crossing the data
// boundary is a clear compile error.
//
// Every test in this file doubles as a NO-HANG guard: pre-0.4.3 the type
// walks (isConcrete/clone/decode-once/SoP encoders) recursed forever on
// self-referential types, so each test runs under the suite timeout.

/** compile a single exported function to UPLC; throws if diagnostics exist */
async function compileFn( name: string, src: string ): Promise<UPLCTerm> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: name, entry: "test.pebble", root: "/" });
    if( c.diagnostics.length )
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));
    return parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
}

/** run `check()` and return the diagnostic strings */
async function checkOnly( src: string ): Promise<string[]> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.check({ entry: "test.pebble", root: "/" });
    return c.diagnostics.map(d => d.toString());
}

const errorsOnly = ( ds: string[] ) => ds.filter( d => d.startsWith("ERROR") );

function evalInt1( uplc: UPLCTerm, n: bigint ): bigint {
    const r = Machine.eval( new Application( uplc, UPLCConst.int( n ) ) ).result;
    return (r as CEKConst).value as bigint;
}

// generous for CI, but each test previously risked an INFINITE loop —
// the timeout is what turns a regression into a failure instead of a hang
jest.setTimeout( 60_000 );

// --------------------------------------------------------------------------
// data-encoded recursion — fully supported
// --------------------------------------------------------------------------
describe("recursive struct — data encoding", () => {

    test("IntList declaration compiles clean (regression: was `IntList is not defined`)", async () => {
        const ds = errorsOnly( await checkOnly(`
struct IntList {
    Nil {}
    Cons { value: int, next: IntList }
}
export function main( n: int ): int { return n; }`) );
        expect( ds ).toEqual( [] );
    });

    test("IntList build + match + recursive sum evaluates", async () => {
        const uplc = await compileFn("main", `
data struct IntList {
    Nil {}
    Cons { value: int, next: IntList }
}
function sum( l: IntList ): int {
    return case l
        is Nil{} => 0
        is Cons{ value, next } => value + sum( next );
}
export function main( n: int ): int {
    const l: IntList = IntList.Cons{ value: n, next: IntList.Cons{ value: 1, next: IntList.Nil{} } };
    return sum( l );
}`);
        expect( evalInt1( uplc, 10n ) ).toBe( 11n );
    });

    test("single-constructor recursive struct via Optional field", async () => {
        const uplc = await compileFn("main", `
data struct Node { value: int, next: Optional<Node> }
export function main( n: int ): int {
    const node: Node = Node{ value: n, next: undefined };
    return node.value;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("mutually recursive structs build + traverse", async () => {
        const uplc = await compileFn("main", `
data struct A { Stop{} Next{ b: B } }
data struct B { Wrap{ a: A, tag: int } }
function depth( a: A ): int {
    return case a
        is Stop{} => 0
        is Next{ b } => case b is Wrap{ a, tag } => 1 + depth( a ) ;
}
export function main( n: int ): int {
    const a: A = A.Next{ b: B.Wrap{ a: A.Stop{}, tag: n } };
    return depth( a ) + n;
}`);
        expect( evalInt1( uplc, 10n ) ).toBe( 11n );
    });

    test("`as data` on a recursive DATA struct is the identity (no hang)", async () => {
        const ds = errorsOnly( await checkOnly(`
data struct IntList { Nil {} Cons { value: int, next: IntList } }
export function main( n: int ): int {
    const l: IntList = IntList.Cons{ value: n, next: IntList.Nil{} };
    const d = l as data;
    return n;
}`) );
        expect( ds ).toEqual( [] );
    });

    test("show() on a recursive data struct compiles (no hang)", async () => {
        const ds = errorsOnly( await checkOnly(`
data struct IntList { Nil {} Cons { value: int, next: IntList } }
export function main( n: int ): int {
    const l: IntList = IntList.Cons{ value: n, next: IntList.Nil{} };
    trace l.show();
    return n;
}`) );
        expect( ds ).toEqual( [] );
    });

    test("pathological direct self-field declaration does not hang the compiler", async () => {
        // `S` is uninhabitable, but the DECLARATION must still terminate
        const ds = errorsOnly( await checkOnly(`
data struct S { s: S }
export function main( n: int ): int { return n; }`) );
        expect( ds ).toEqual( [] );
    });
});

// --------------------------------------------------------------------------
// runtime (SoP) recursion — runtime-only, data boundary is a clear error
// --------------------------------------------------------------------------
describe("recursive struct — runtime (SoP) encoding", () => {

    test("recursive runtime struct builds and matches at runtime", async () => {
        const uplc = await compileFn("main", `
runtime struct RList {
    Nil {}
    Cons { value: int, next: RList }
}
function sum( l: RList ): int {
    return case l
        is Nil{} => 0
        is Cons{ value, next } => value + sum( next );
}
export function main( n: int ): int {
    const l: RList = RList.Cons{ value: n, next: RList.Cons{ value: 2, next: RList.Nil{} } };
    return sum( l );
}`);
        expect( evalInt1( uplc, 7n ) ).toBe( 9n );
    });

    test("recursive runtime struct crossing the data boundary is a clear error (no hang)", async () => {
        const ds = errorsOnly( await checkOnly(`
runtime struct RList {
    Nil {}
    Cons { value: int, next: RList }
}
export function main( n: int ): int {
    const l: RList = RList.Cons{ value: n, next: RList.Nil{} };
    const d = l as data;
    return n;
}`) );
        expect( ds.length ).toBeGreaterThan( 0 );
        expect( ds.join("\n") ).toContain( "cannot be converted" );
    });
});

// --------------------------------------------------------------------------
// generic + recursive combined
// --------------------------------------------------------------------------
describe("recursive struct — generic recursive (Tree<T>)", () => {

    test("Tree<int> build + recursive traversal evaluates", async () => {
        const uplc = await compileFn("main", `
data struct Tree<T> {
    Leaf { value: T }
    Branch { value: T, left: Tree<T>, right: Tree<T> }
}
function total( t: Tree<int> ): int {
    return case t
        is Leaf{ value } => value
        is Branch{ value, left, right } => value + total( left ) + total( right );
}
export function main( n: int ): int {
    const t: Tree<int> = Tree.Branch{
        value: n,
        left: Tree.Leaf{ value: 1 },
        right: Tree.Branch{ value: 2, left: Tree.Leaf{ value: 3 }, right: Tree.Leaf{ value: 4 } }
    };
    return total( t );
}`);
        expect( evalInt1( uplc, 10n ) ).toBe( 20n );
    });

    test("two instantiations of the same recursive generic coexist", async () => {
        const ds = errorsOnly( await checkOnly(`
struct Tree<T> {
    Leaf { value: T }
    Branch { value: T, left: Tree<T>, right: Tree<T> }
}
export function main( n: int ): int {
    const ti: Tree<int> = Tree.Leaf{ value: n };
    const tb: Tree<bytes> = Tree.Leaf{ value: #00 };
    return n;
}`) );
        expect( ds ).toEqual( [] );
    });

    test("plain `struct Tree<T>` (both encodings) compiles the README example", async () => {
        const ds = errorsOnly( await checkOnly(`
struct Tree<T> {
    Leaf { value: T }
    Branch { value: T, left: Tree<T>, right: Tree<T> }
}
export function main( n: int ): int { return n; }`) );
        expect( ds ).toEqual( [] );
    });
});
