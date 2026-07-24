import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// 0.3.7 lambda-capture rule (masterpiece bug 16, deliverable b):
// lambdas may only capture `const` bindings. A `const` is computed once at
// its declaration, so a closure reading it is a plain variable access; a
// mutable `let` crossing a function boundary has no sound meaning on-chain
// (closures cannot observe later reassignments), so both reading and
// writing one from inside a lambda is a compile error (30207).

async function compile( src: string ): Promise<string[]> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    try {
        await compiler.compile({ entry: "main.pebble", root: "/" });
    } catch {
        // compile throws when diagnostics contain errors; we inspect them below
    }
    return compiler.diagnostics
        .map( d => String( d ) )
        .filter( s => s.startsWith( "ERROR" ) );
}

jest.setTimeout( 300_000 );

describe("0.3.7 — lambdas can only capture `const` bindings (30207)", () => {

    test("lambda READING an outer mutable `let` is a compile error", async () => {
        const errors = await compile(`
contract C {
    mint m( n: int ) {
        let threshold: int = n;
        const xs: List<int> = [ 1, 2, 3 ];
        assert xs.every( x => x < threshold ) else "no";
    }
}
`);
        expect( errors.length ).toBeGreaterThan( 0 );
        expect( errors.some( e => e.includes("30207") || e.includes("can only capture") ) ).toBe( true );
    });

    test("lambda WRITING an outer mutable `let` is a compile error", async () => {
        const errors = await compile(`
contract C {
    mint m( n: int ) {
        let count: int = 0;
        const xs: List<int> = [ 1, 2, 3 ];
        const ys = xs.filter( x => {
            count++;
            return x > 0;
        });
        assert ys.length() == 3 else "no";
    }
}
`);
        expect( errors.length ).toBeGreaterThan( 0 );
        expect( errors.some( e => e.includes("30207") || e.includes("can only capture") ) ).toBe( true );
    });

    test("lambda capturing an outer `const` compiles fine", async () => {
        const errors = await compile(`
contract C {
    mint m( n: int ) {
        const threshold: int = n;
        const xs: List<int> = [ 1, 2, 3 ];
        assert xs.every( x => x < threshold + 100 ) else "no";
    }
}
`);
        expect( errors ).toEqual( [] );
    });

    test("loop bodies mutating an outer `let` are still allowed (no function boundary)", async () => {
        const errors = await compile(`
contract C {
    mint m( n: int ) {
        const xs: List<int> = [ 1, 2, 3 ];
        let sum: int = 0;
        for( const x of xs ) {
            sum += x;
        }
        assert sum == 6 + n - n else "no";
    }
}
`);
        expect( errors ).toEqual( [] );
    });

    test("named function reading an outer top-level `const` compiles fine", async () => {
        const errors = await compile(`
const BASE: int = 42;
function addBase( x: int ): int {
    return x + BASE;
}
contract C {
    mint m( n: int ) {
        assert addBase( n ) >= 42 else "no";
    }
}
`);
        expect( errors ).toEqual( [] );
    });

    test("lambda parameter shadowing an outer `let` is NOT a capture", async () => {
        const errors = await compile(`
contract C {
    mint m( n: int ) {
        let x: int = n;
        x += 1;
        const xs: List<int> = [ 1, 2, 3 ];
        assert xs.every( x => x > 0 ) else "no";
        assert x > 0 else "no";
    }
}
`);
        expect( errors ).toEqual( [] );
    });
});
