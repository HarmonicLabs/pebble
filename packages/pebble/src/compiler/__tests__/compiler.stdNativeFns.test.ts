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
    await compiler.export({ functionName, entry: "src/main.pebble", root: "/" });
    return compiler;
}

describe("std native-fn namespaces", () => {

    // ---- std.list ----
    test("std.list.length<int> compiles", async () => {
        const src = `
function main( xs: List<int> ): int {
    return std.list.length<int>( xs );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.foldl with partial-applied operator-like fn (the user's motivation)", async () => {
        const src = `
function main( xs: List<int> ): int {
    return std.list.foldl<int,int>( std.int.add, 0, xs );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.foldr<int,int> compiles", async () => {
        const src = `
function main( xs: List<int> ): int {
    return std.list.foldr<int,int>( std.int.subtract, 0, xs );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.filter<int> with partial-applied predicate", async () => {
        const src = `
function main( xs: List<int> ): List<int> {
    return std.list.filter<int>( std.int.isZero, xs );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.some<int> + std.list.every<int> compile", async () => {
        const src = `
function main( xs: List<int> ): boolean {
    return std.boolean.strictAnd(
        std.list.some<int>( std.int.isZero, xs ),
        std.list.every<int>( std.int.isZero, xs )
    );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.find<int> returns Optional<int>", async () => {
        const src = `
function main( xs: List<int> ): Optional<int> {
    return std.list.find<int>( std.int.isZero, xs );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list head / tail / isEmpty / prepend / drop compile", async () => {
        const src = `
function main( xs: List<int> ): int {
    using { head, isEmpty, prepend, drop, tail } = std.list;
    let with7: List<int> = prepend<int>( 7, xs );
    let dropped: List<int> = drop<int>( 1, with7 );
    if( isEmpty<int>( dropped ) ) {
        return 0;
    }
    return head<int>( tail<int>( with7 ) );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // NOTE: `std.linearMap.*` is registered but cannot be tested end-to-end
    // here because the user-facing `LinearMap<K,V>` type-annotation form
    // is not yet wired through the parser (`LinearMap` is not a keyword
    // and not registered as a named AST type). The functions ARE present
    // and reachable via `using { ... } = std.linearMap;`; verification is
    // deferred to a follow-up that adds `LinearMap` as an AST-level
    // type-name binding.

    // ---- std.bytes ----
    test("std.bytes monomorphic ops compile (length, slice, concat, greaterThan)", async () => {
        const src = `
function main( a: bytes, b: bytes ): boolean {
    let _len: int = std.bytes.length( a );
    let _cat: bytes = std.bytes.concat( a, b );
    let _slc: bytes = std.bytes.slice( 0, 2, a );
    return std.bytes.greaterThan( a, b );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // NOTE: `std.bytes.toInt` / `std.bytes.fromInt` are registered against
    // `_bytesToIntBE` / `_intToBytesBE` but those IRNativeTag entries do not
    // yet have an IR-to-UPLC lowering (nativeToIR.ts throws). Skipping
    // end-to-end execution here; the namespace path itself is resolvable.

    // ---- std.int ----
    test("std.int.add / subtract / negate / isZero / exponentiate compile", async () => {
        const src = `
function main( a: int, b: int ): int {
    let s: int = std.int.add( a, b );
    let d: int = std.int.subtract( a, b );
    let n: int = std.int.negate( s );
    let _: boolean = std.int.isZero( n );
    return std.int.exponentiate( d, 2 );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.int comparisons compile", async () => {
        const src = `
function main( a: int, b: int ): boolean {
    return std.boolean.strictAnd(
        std.int.greaterThan( a, b ),
        std.int.lessThanEquals( a, b )
    );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.int.increment / decrement compile", async () => {
        const src = `
function main( n: int ): int {
    return std.int.decrement( std.int.increment( n ) );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ---- std.boolean ----
    test("std.boolean.not / strictAnd / strictOr compile", async () => {
        // NOTE: `std.boolean.equals` and `std.boolean.toInt` are registered but
        // their underlying `_equalBoolean` / `_boolToInt` IR tags lack a
        // nativeToIR lowering. They're reachable as identifiers; full
        // end-to-end execution is left for a follow-up that adds those
        // IR-to-UPLC translations.
        const src = `
function main( a: boolean, b: boolean ): boolean {
    let n: boolean = std.boolean.not( a );
    let cmb: boolean = std.boolean.strictAnd( n, b );
    return std.boolean.strictOr( cmb, b );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ---- std.data ----
    test("std.data.strToData / strFromData round-trip compiles", async () => {
        const src = `
function main( s: string ): string {
    return std.data.strFromData( std.data.strToData( s ) );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ---- top-level std.id<T> / std.equals<T> ----
    test("std.id<int> compiles and types correctly", async () => {
        const src = `
function main( n: int ): int {
    return std.id<int>( n );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.equals<int> compiles", async () => {
        const src = `
function main( a: int, b: int ): boolean {
    return std.equals<int>( a, b );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.equals<bytes> compiles", async () => {
        const src = `
function main( a: bytes, b: bytes ): boolean {
    return std.equals<bytes>( a, b );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("partial application of std.int.add as a foldl reducer works", async () => {
        // This is the user's stated motivation: operator-like natives are
        // exposable as first-class values; `+` cannot be passed but
        // `std.int.add` can.
        const src = `
function sum( xs: List<int> ): int {
    return std.list.foldl<int,int>( std.int.add, 0, xs );
}
function main( xs: List<int> ): int {
    return sum( xs );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });
});
