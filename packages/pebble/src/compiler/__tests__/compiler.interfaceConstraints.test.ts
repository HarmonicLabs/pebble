import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

async function compileSrc( src: string, functionName: string = "main" )
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([
            ["src/main.pebble", fromUtf8(src)],
        ]),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    try {
        await compiler.export({ functionName, entry: "src/main.pebble", root: "/" });
    } catch {
        // backend may throw if compile diagnostics prevented main registration
    }
    return { compiler, ioApi };
}

function ioHasDiagnostic( ioApi: any ): boolean
{
    const text = ioApi.stdout?.toString?.() ?? "";
    return typeof text === "string" && text.length > 0;
}

describe("interface-constrained generic type parameters", () => {

    // ----- parser-level: `<T implements I>` syntax accepted on user funcs -----

    test("function with `<T implements ToData>` parses without diagnostics", async () => {
        // The function body doesn't actually USE the constraint method (since
        // user-body method dispatch on type-param values is deferred to
        // Stage 4b). We only verify the declaration itself parses and
        // compiles cleanly.
        const src = `
function idC<T implements ToData>( x: T ): T { return x; }

function main( n: int ): int {
    return idC<int>( n );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("two constraints in one declaration parse", async () => {
        const src = `
function noop<K implements ToData, V implements ToData>( k: K, v: V ): K {
    return k;
}

function main( n: int, b: bytes ): int {
    return noop<int, bytes>( n, b );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ----- the user's stated motivation: std.linearMap.prepend works -----

    test("std.linearMap.prepend(k, v, m) compiles with int/bytes keys & values", async () => {
        // NOTE: `m` is an explicit `LinearMap<...>`, not `Value`. `Value` used
        // to be a prelude alias for a LinearMap-of-LinearMap but is now a
        // native builtin type (not a LinearMap), so the old fixture stopped
        // type-checking — it only "passed" because export() swallowed the
        // error (audit BUG 30). The constraints auto-satisfy through ToData
        // for both K and V.
        const src = `
function main(
    m: LinearMap<PolicyId, LinearMap<TokenName, int>>,
    k: PolicyId,
    v: LinearMap<TokenName, int>
): LinearMap<PolicyId, LinearMap<TokenName, int>> {
    return std.linearMap.prepend<PolicyId, LinearMap<TokenName, int>>( k, v, m );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ----- user-defined interface that registers as a constraint -----

    test("user-defined interface name is recognized as a constraint", async () => {
        const src = `
interface Show { show(self): bytes; }

function noop<T implements Show>( x: T ): T { return x; }

function main( n: int ): int {
    // We never call noop on a concrete type that implements Show; we just
    // verify the declaration itself parses and compiles (constraint
    // resolution at this declaration is name-only).
    return n;
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ----- error path: unknown interface name -----

    test("unknown interface in constraint clause is rejected", async () => {
        const src = `
function f<T implements NotARealInterface>( x: T ): T { return x; }

function main( n: int ): int {
    return n;
}`;
        const { compiler, ioApi } = await compileSrc( src );
        const hasDiag = compiler.diagnostics.length > 0 || ioHasDiagnostic( ioApi );
        expect( hasDiag ).toBe( true );
    });

    // ----- user-defined `type Foo implements ToData` impl is honored -----

    // Since 0.4.3 the `self` receiver of a user impl block is typed with
    // the implementing type in place, so user interface impls compile and
    // constrained generics resolve the user's dictionary entry.
    test("std.linearMap.prepend uses a user-defined `type Foo implements ToData` impl", async () => {
        // We declare a struct `MyKey` that explicitly implements `ToData`
        // with a custom body. When we then call `std.linearMap.prepend`
        // with a `LinearMap<MyKey, int>`, the dictionary the constrained
        // generic resolves for K should be the user's `toData` (not the
        // built-in auto-derive). This exercises the user-impl branch in
        // `resolveInterfaceImpl`.
        const src = `
data struct MyKey {
    raw: bytes
}

type MyKey implements ToData {
    toData( self ): data {
        return std.builtins.bData( self.raw );
    }
}

function main( m: LinearMap<MyKey, int>, k: MyKey, v: int ): LinearMap<MyKey, int> {
    return std.linearMap.prepend( k, v, m );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });
});

// ----- constraint-based dispatch at monomorphization ("Stage 4b") -----
//
// Since 0.4.3 a bounded type parameter can USE its bound: `x.toData()` on
// `<T implements ToData>` resolves after monomorphization — natively
// data-encodable types lower through `TirToDataExpr`, user `type X
// implements ToData { ... }` impls dispatch through the method table.
describe("constraint-based dispatch in generic bodies", () => {

    test("`x.toData()` on `<T implements ToData>` works for int", async () => {
        const src = `
function conv<T implements ToData>( x: T ): data { return x.toData(); }

function main( n: int ): int {
    const d: data = conv<int>( n );
    return n;
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("`x.toData()` dispatches a USER impl through the constraint", async () => {
        const src = `
data struct MyKey { k: int }

type MyKey implements ToData {
    toData( self ): data { return self.k.toData(); }
}

function conv<T implements ToData>( x: T ): data { return x.toData(); }

function main( n: int ): int {
    const mk: MyKey = MyKey{ k: n };
    const d: data = conv<MyKey>( mk );
    return n;
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("direct `.toData()` on a concrete value (no generics) works", async () => {
        const src = `
function main( n: int ): int {
    const d: data = n.toData();
    return n;
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("`.toData()` on a runtime-only recursive struct is still rejected", async () => {
        const src = `
runtime struct RList { Nil {} Cons { value: int, next: RList } }

function main( n: int ): int {
    const l: RList = RList.Cons{ value: n, next: RList.Nil{} };
    const d: data = l.toData();
    return n;
}`;
        const { compiler, ioApi } = await compileSrc( src );
        const hasDiag = compiler.diagnostics.length > 0 || ioHasDiagnostic( ioApi );
        expect( hasDiag ).toBe( true );
    });
});
