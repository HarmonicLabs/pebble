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
        const src = `
function main( m: Value, k: PolicyId, v: LinearMap<TokenName, int> ): Value {
    return std.linearMap.prepend<PolicyId, LinearMap<TokenName, int>>( k, v, m );
}`;
        const { compiler } = await compileSrc( src );
        // `Value` is the prelude alias for LinearMap<PolicyId, LinearMap<TokenName, int>>;
        // the constraints should auto-satisfy through ToData for both K and V.
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
