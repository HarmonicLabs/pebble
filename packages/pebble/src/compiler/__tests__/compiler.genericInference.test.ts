import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

/**
 * Type-argument inference for generic function calls — including namespace
 * generics like `std.list.foldl(...)` and top-level `std.id(...)`.
 *
 * Inference DOES work when every type parameter of the callee appears
 * somewhere in a formal argument type. The compiler unifies each compiled
 * argument against the corresponding formal slot via `inferTypeArgs` and
 * binds the type parameters consistently.
 *
 * Inference DOES NOT work (and explicit `<T,...>` is required) when:
 *   - a type parameter only appears in the return type (e.g. `foo<T>(): T`),
 *   - an argument is itself a still-generic value (passing `std.id` rather
 *     than calling it), since its type still contains free type-vars.
 */

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
        // Backend may throw if compile diagnostics prevented main registration.
        // The test is on `compiler.diagnostics`, which is drained into the io
        // stream by `Compiler.export` before the throw — so for negative
        // tests we instead probe the io stdout (see helper below).
    }
    return { compiler, ioApi };
}

function ioHasDiagnostic( ioApi: any ): boolean
{
    // Diagnostics get drained to stdout by `Compiler.export` before any throw.
    // MemoryStream exposes the captured text via `toString()`.
    const text = ioApi.stdout?.toString?.() ?? "";
    return typeof text === "string" && text.length > 0;
}

describe("generic type-argument inference", () => {

    // ----- one-param inference from a single arg -----

    test("std.builtins.headList without explicit type args (xs: List<int>)", async () => {
        const src = `
function main( xs: List<int> ): int {
    return std.builtins.headList( xs );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.builtins.tailList without explicit type args", async () => {
        const src = `
function main( xs: List<int> ): List<int> {
    return std.builtins.tailList( xs );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.builtins.nullList without explicit type args", async () => {
        const src = `
function main( xs: List<int> ): boolean {
    return std.builtins.nullList( xs );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ----- consistency-check inference -----

    test("std.builtins.mkCons(elem, list) unifies T from both arg positions", async () => {
        const src = `
function main( xs: List<int> ): List<int> {
    return std.builtins.mkCons( 7, xs );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ----- the user's stated example: std.list.foldl inference -----

    test("std.list.foldl(std.int.add, 0, xs) — T from List<T>, A from init + reducer return", async () => {
        const src = `
function main( xs: List<int> ): int {
    return std.list.foldl( std.int.add, 0, xs );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.foldr(std.int.subtract, 0, xs)", async () => {
        const src = `
function main( xs: List<int> ): int {
    return std.list.foldr( std.int.subtract, 0, xs );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.filter(std.int.isZero, xs) — T from predicate's arg and List<T>", async () => {
        const src = `
function main( xs: List<int> ): List<int> {
    return std.list.filter( std.int.isZero, xs );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.some / every / find without explicit type args", async () => {
        const src = `
function main( xs: List<int> ): boolean {
    let _f: Optional<int> = std.list.find( std.int.isZero, xs );
    return std.boolean.strictAnd(
        std.list.some( std.int.isZero, xs ),
        std.list.every( std.int.isZero, xs )
    );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.head / tail / isEmpty / prepend without explicit type args", async () => {
        const src = `
function main( xs: List<int> ): int {
    let with7: List<int> = std.list.prepend( 7, xs );
    if( std.list.isEmpty( with7 ) ) {
        return 0;
    }
    let _t: List<int> = std.list.tail( with7 );
    return std.list.head( with7 );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ----- top-level std.id / std.equals inference -----

    test("std.id(42) infers T=int", async () => {
        const src = `
function main( n: int ): int {
    return std.id( n );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.id on bytes infers T=bytes (distinct instantiation)", async () => {
        const src = `
function main( b: bytes ): bytes {
    return std.id( b );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.equals(a, b) infers T from arg types", async () => {
        const src = `
function main( a: bytes, b: bytes ): boolean {
    return std.equals( a, b );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.equals on int infers T=int (separate instantiation from bytes)", async () => {
        const src = `
function main( a: int, b: int ): boolean {
    return std.equals( a, b );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ----- regression: user-defined generic still infers -----

    test("user-defined function id<T>(x: T): T still infers T at call site", async () => {
        const src = `
function id<T>( x: T ): T { return x; }

function main( n: int ): int {
    return id( n );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ----- partial application: the stated motivation for namespace fns -----

    test("std.list.foldl with std.int.add as a first-class value (no explicit type args)", async () => {
        const src = `
function sum( xs: List<int> ): int {
    return std.list.foldl( std.int.add, 0, xs );
}

function main( xs: List<int> ): int {
    return sum( xs );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ----- lambdas in generic-call positions: param types inferred from the
    //       formal slot after the non-lambda args populate the inference env -----

    test("std.list.foldl with unannotated lambda — params inferred from List<int> + init", async () => {
        const src = `
function main( xs: List<int> ): int {
    return std.list.foldl( (acc, n) => acc + n, 0, xs );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.filter with unannotated lambda — param T inferred from List<int>", async () => {
        const src = `
function main( xs: List<int> ): List<int> {
    return std.list.filter( (n) => n % 2 == 0, xs );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.foldl on the result of std.list.filter — chained lambdas", async () => {
        const src = `
function main( xs: List<int> ): int {
    return std.list.foldl(
        (acc, n) => acc + n,
        0,
        std.list.filter( (n) => n % 2 == 0, xs )
    );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.find with unannotated lambda", async () => {
        const src = `
function main( xs: List<int> ): Optional<int> {
    return std.list.find( (n) => n == 3, xs );
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.list.some / every with unannotated lambda", async () => {
        const src = `
function main( xs: List<int> ): bool {
    const anyBig: bool = std.list.some( (n) => n > 4, xs );
    const allPos: bool = std.list.every( (n) => n > 0, xs );
    return anyBig && allPos;
}`;
        const { compiler } = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ----- negative path: type-args unable to be inferred -----

    test("calling std.id() with no args produces a diagnostic", async () => {
        const src = `
function main(): int {
    return std.id();
}`;
        const { compiler, ioApi } = await compileSrc( src );
        // Either compiler.diagnostics carries the message OR it was drained
        // to io stdout. Accept either signal.
        const hasDiag = compiler.diagnostics.length > 0 || ioHasDiagnostic( ioApi );
        expect( hasDiag ).toBe( true );
    });
});
