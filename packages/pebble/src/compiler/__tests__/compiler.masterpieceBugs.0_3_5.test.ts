import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// Bug reports from `the-cardano-masterpiece` (PEBBLE_BUGS.md, against 0.3.5).

async function compile( src: string, extraModules?: Record<string, string> ) {
    const sources = new Map([ [ "main.pebble", fromUtf8( src ) ] ]);
    if( extraModules )
        for( const [ name, text ] of Object.entries( extraModules ) )
            sources.set( name, fromUtf8( text ) );
    const ioApi = createMemoryCompilerIoApi({
        sources,
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.compile({ entry: "main.pebble", root: "/" });
    return {
        output: ioApi.outputs.get("out/out.flat"),
        diagnostics: c.diagnostics.map( d => d.toString() ),
    };
}

describe("masterpiece bug 1 — context-destructured vars in nested struct literals", () => {
    test("`policy` from `const { tx, policy } = context` resolves inside a nested struct literal", async () => {
        const { diagnostics, output } = await compile(`
contract T {
    mint m() {
        const { tx, policy } = context;
        const a = Address.Address{
            payment: Credential.Script{ hash: policy },
            stake: undefined
        };
        assert tx.outputs.some( o => o.address == a );
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("masterpiece bug 2 — `let` accumulator assigned in `if` branches", () => {
    test("branch-assigned `let` read after the branches compiles", async () => {
        const { diagnostics, output } = await compile(`
contract T {
    spend s( redeemer: data ) {
        const { tx } = context;
        const xs = tx.outputs;
        const c1 = tx.inputs.length() > 0;
        const c2 = tx.inputs.length() > 1;
        let k = 0;
        if( c1 ) { assert xs[k].value.lovelaces() >= 0; k = k + 1; }
        if( c2 ) { assert xs[k].value.lovelaces() >= 0; k = k + 1; }
        assert xs.length() >= k;
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("masterpiece bug 3 — struct-param function + 2 validators", () => {
    test("free function with a user-struct param called from the second of two mints compiles", async () => {
        const { diagnostics, output } = await compile(`
struct Coordinates { x0: int, y0: int, x1: int, y1: int }

function bad( a: Coordinates ): boolean { return a.x0 == 0; }

contract T {
    mint free() {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) == 1;
    }
    mint split( a: Coordinates ) {
        const { tx, policy } = context;
        assert bad( a );
        assert tx.mint.amountOf( policy, # ) == 0;
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("masterpiece bug 4 — builtin-typed helper called from two spend methods of a state", () => {
    test("`valueEq` helper called at the end of both spend methods compiles", async () => {
        const { diagnostics, output } = await compile(`
function valueEq( a: Value, b: Value ): boolean {
    return a.contains( b ) && b.contains( a );
}

contract T {
    state St {
        n: int

        spend one( a: int ) {
            const { tx } = context;
            assert a >= 0;
            assert valueEq( tx.mint, tx.mint );
        }
        spend two( a: int ) {
            const { tx } = context;
            assert a >= 0;
            assert valueEq( tx.mint, tx.mint );
        }
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("masterpiece bug 5 — exported top-level consts", () => {
    test("`export const` can be imported from another module", async () => {
        const { diagnostics, output } = await compile(`
import { CANVAS_SIZE } from "./consts";

contract T {
    mint m() {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) == CANVAS_SIZE;
    }
}
`, {
            "consts.pebble": `export const CANVAS_SIZE = 1024;`,
        });
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("same const name in two modules does not crash", async () => {
        const { diagnostics, output } = await compile(`
import { other } from "./consts";

const SIZE = 16;

contract T {
    mint m() {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) == SIZE + other();
    }
}
`, {
            "consts.pebble": `
const SIZE = 32;
export function other(): int { return SIZE; }
`,
        });
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("masterpiece bug 6 — `LinearMap` as a declared type", () => {
    test("LinearMap works as a struct field type", async () => {
        const { diagnostics, output } = await compile(`
struct D {
    A { metadata: LinearMap<bytes, bytes>, version: int }
    B { idx: int }
}

contract T {
    spend s( redeemer: data ) {
        const { tx } = context;
        const d = redeemer as D;
        match d {
            when A{ version }: { assert version >= 0; }
            when B{ idx }: { assert idx >= 0; }
        }
        assert tx.inputs.length() > 0;
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("LinearMap works as a type alias target", async () => {
        const { diagnostics, output } = await compile(`
type Meta = LinearMap<bytes, bytes>;

contract T {
    spend s( redeemer: data ) {
        const { tx } = context;
        const m = std.builtins.unMapData( redeemer ) as Meta;
        assert tx.inputs.length() > 0;
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("masterpiece bug 7 — global const defined from another const, used in a free function", () => {
    test("derived global const referenced inside a free function compiles", async () => {
        const { diagnostics, output } = await compile(`
const LINE_LENGTH = 1024;
const CHUNK_SIZE = LINE_LENGTH * 8;

function isChunk( n: int ): boolean { return n == CHUNK_SIZE; }

contract T {
    mint m() {
        const { tx, policy } = context;
        assert isChunk( tx.mint.amountOf( policy, # ) );
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("masterpiece bug 8 — nested index expression with a loop variable", () => {
    test("`tx.refInputs[ idxs[n] ]` inside a loop that builds accumulators compiles", async () => {
        const { diagnostics, output } = await compile(`
struct Commit { C { owner: bytes, serial: int } }

contract T {
    spend s( redeemer: data ) {
        const { tx } = context;
        const commitRefIdxs = [ 0, 1 ];
        let owners: List<bytes> = [ # ];
        let serials: List<int> = [ 0 ];
        const nRefs = commitRefIdxs.length();
        for( let n = nRefs - 1; n >= 0; n = n - 1 ) {
            const ri = tx.refInputs[ commitRefIdxs[n] ];
            const InlineDatum{ datum: d } = ri.resolved.datum;
            const C{ owner, serial } = d as Commit;
            owners = owners.prepend( owner );
            serials = serials.prepend( serial );
        }
        assert owners.length() == 3;
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});
