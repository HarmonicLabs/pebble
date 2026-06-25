import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

/**
 * Encoding consistency for user structs across function boundaries.
 *
 * Unlike `Optional` (whose parameters are forced to the SoP encoding via
 * `optionalsAsSop`, see compiler.bugReport4), user structs resolve to their
 * **data** encoding both as a function return type and as a function
 * parameter type (a user struct cannot be generic, so the SoP-encoded
 * resolver path is never taken for it).
 *
 * Therefore a struct returned by one function and passed straight into another
 * function's struct parameter matches without any encoding conversion: there
 * is no data<->SoP bridge inserted for structs (which would be expensive), the
 * two sides simply share the same (data) encoding.
 *
 * This is verified at runtime (not only at compile time): the program is
 * executed and the traced result is checked.
 */
describe("struct encoding across function boundaries", () => {

    async function run( srcText: string ) {
        const fileName = "structReturnArg.pebble";
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        const result = await compiler.run({ entry: fileName, root: "/" });
        return { result, diagnostics: compiler.diagnostics };
    }

    test("a struct returned by one function is consumed by another's struct param, and evaluates correctly", async () => {

        const { result, diagnostics } = await run(`
struct Foo { Mk{ x: int, y: int } }

function mkFoo(): Foo { return Foo.Mk{ x: 1, y: 2 }; }

function useFoo( f: Foo ): int { return f.x + f.y; }

trace useFoo( mkFoo() );
`);

        // compiles cleanly (no data<->SoP conversion needed for structs)
        expect( diagnostics.map( d => d.toString() ) ).toEqual( [] );
        expect( diagnostics.length ).toBe( 0 );

        // and executes to the expected value
        expect( result.logs.length ).toBe( 1 );
        expect( result.logs[0] ).toBe( "3" );
    });

    test("struct round-tripped through two functions preserves all fields at runtime", async () => {

        const { result, diagnostics } = await run(`
struct Pair { Mk{ a: int, b: int } }

function swap( p: Pair ): Pair { return Pair.Mk{ a: p.b, b: p.a }; }

function diff( p: Pair ): int { return p.a - p.b; }

// swap returns a struct that is fed straight into another struct param
trace diff( swap( Pair.Mk{ a: 10, b: 4 } ) );
`);

        expect( diagnostics.map( d => d.toString() ) ).toEqual( [] );
        expect( diagnostics.length ).toBe( 0 );

        // swap(10,4) -> (4,10); diff -> 4 - 10 = -6
        expect( result.logs.length ).toBe( 1 );
        expect( result.logs[0] ).toBe( "-6" );
    });
});
