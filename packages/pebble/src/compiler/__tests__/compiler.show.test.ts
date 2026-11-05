import { Application, constT, parseUPLC, UPLCConst } from "@harmoniclabs/uplc";
import { Machine } from "@harmoniclabs/plutus-machine";
import { DataB, DataI } from "@harmoniclabs/plutus-data";
import { Pair } from "@harmoniclabs/pair";
import { toUtf8 } from "@harmoniclabs/uint8array-utils";
import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

/**
 * Built-in `Show` interface coverage.
 *
 * Every Pebble type with a built-in `_showIR` lowering should support
 * `.show()` returning UTF-8 bytes (hex for raw bytes, decimal for ints,
 * "true"/"false" for booleans, serialiseData+hex for data, recursive
 * formatting for lists/maps).
 *
 * User-declared `type X implements Show { show(self): bytes { ... } }`
 * impls take precedence over the built-in path (the regular method
 * dispatch resolves first).
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
        // backend may throw on diagnostics
    }
    return compiler;
}

describe("Show built-in interface", () => {

    test("int.show() compiles", async () => {
        const src = `
function main( n: int ): bytes {
    return n.show();
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("bytes.show() compiles (hex encoding)", async () => {
        const src = `
function main( b: bytes ): bytes {
    return b.show();
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("boolean.show() compiles", async () => {
        const src = `
function main( b: boolean ): bytes {
    return b.show();
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("data.show() compiles", async () => {
        const src = `
function main( d: data ): bytes {
    return d.show();
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("List<int>.show() compiles", async () => {
        const src = `
function main( xs: List<int> ): bytes {
    return xs.show();
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("List<bytes>.show() compiles", async () => {
        const src = `
function main( xs: List<bytes> ): bytes {
    return xs.show();
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("List<List<int>>.show() compiles (nested)", async () => {
        const src = `
function main( xs: List<List<int>> ): bytes {
    return xs.show();
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("Value.show() (LinearMap of LinearMap) compiles", async () => {
        const src = `
function main( v: Value ): bytes {
    return v.show();
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("LinearMap.show() shows keys and values with their types", async () => {
        // they printed as the CBOR of their data: `{01: 41ab, 16: 42cdef}`
        const compiler = await compileSrc( `
function main( m: LinearMap<int, bytes> ): bytes {
    return m.show();
}` );
        expect( compiler.diagnostics ).toEqual( [] );
        const body = parseUPLC( ( compiler.io as any ).outputs.get( "out/out.flat" ) ).body;
        const map = UPLCConst.listOf( constT.pairOf( constT.data, constT.data ) )([
            new Pair( new DataI( 1 ), new DataB( "ab" ) ),
            new Pair( new DataI( 22 ), new DataB( "cdef" ) ),
        ] as any );
        const result = Machine.eval( new Application( body, map ) ).result as any;
        expect( toUtf8( result.value ) ).toBe( "{1: ab, 22: cdef}" );
    });

    test("data-encoded struct .show() compiles via auto-derive", async () => {
        const src = `
data struct Point { x: int, y: int }

function main( p: Point ): bytes {
    return p.show();
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // Since 0.4.3 the `self` receiver of a user
    // `type X implements I { method( self ) ... }` block is typed with the
    // implementing type in place, so user interface impls compile.
    test("user-impl `type X implements Show` overrides auto-derive", async () => {
        const src = `
data struct Point { x: int, y: int }

type Point implements Show {
    show( self ): bytes {
        return self.x.show();
    }
}

function main( p: Point ): bytes {
    return p.show();
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    // ---- trace integration: any Show-able value can be traced ----

    test("trace bytes; (already utf8) compiles", async () => {
        const src = `
function main( msg: bytes, n: int ): int {
    trace msg;
    return n;
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("trace int; (auto-shows via decimal) compiles", async () => {
        const src = `
function main( n: int ): int {
    trace n;
    return n;
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("trace boolean; compiles via Show", async () => {
        const src = `
function main( b: boolean, n: int ): int {
    trace b;
    return n;
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("trace List<int>; compiles via Show", async () => {
        const src = `
function main( xs: List<int>, n: int ): int {
    trace xs;
    return n;
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("trace data; compiles via Show", async () => {
        const src = `
function main( d: data, n: int ): int {
    trace d;
    return n;
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("trace data-struct; compiles via auto-derived Show", async () => {
        const src = `
data struct Point { x: int, y: int }

function main( p: Point, n: int ): int {
    trace p;
    return n;
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });
});
