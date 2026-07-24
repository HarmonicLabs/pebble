import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// 0.3.7 feature: cross-contract type access.
// `export contract C` exports C's type-level symbols:
//  - datum union under `C` (`od as C`, `od as C.State`)
//  - redeemer unions via `redeemerof C` / `redeemerof C.State`

const VAULT = `
export contract Vault {
    state Locked {
        owner: bytes
        amount: int

        spend withdraw( part: int ) {
            const { tx } = context;
            assert part > 0;
            assert tx.inputs.length() > 0;
        }
        spend close() {
            const { tx } = context;
            assert tx.inputs.length() > 0;
        }
    }
    state Idle {
        owner: bytes
    }

    mint open( amount: int ) {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) == amount;
    }
    mint burn() {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) < 0;
    }
}
`;

async function compile( entrySrc: string, modules: Record<string, string> = { "vault.pebble": VAULT } ) {
    const sources = new Map([ [ "main.pebble", fromUtf8( entrySrc ) ] ]);
    for( const [ name, text ] of Object.entries( modules ) )
        sources.set( name, fromUtf8( text ) );
    const ioApi = createMemoryCompilerIoApi({ sources, useConsoleAsOutput: true });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    try {
        await c.compile({ entry: "main.pebble", root: "/" });
    } catch {
        // diagnostics inspected by callers
    }
    return {
        output: ioApi.outputs.get("out/out.flat"),
        diagnostics: c.diagnostics.map( d => d.toString() ),
    };
}

async function run( src: string, modules: Record<string, string> = { "vault.pebble": VAULT } ) {
    const sources = new Map([ [ "main.pebble", fromUtf8( src ) ] ]);
    for( const [ name, text ] of Object.entries( modules ) )
        sources.set( name, fromUtf8( text ) );
    const ioApi = createMemoryCompilerIoApi({ sources, useConsoleAsOutput: true });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    const r = await c.run({ entry: "main.pebble", root: "/" });
    return { result: r, diagnostics: c.diagnostics.map( d => d.toString() ) };
}

describe("export contract — datum access", () => {

    test("`od as Vault` and `od as Vault.Locked` cross-module", async () => {
        const { diagnostics, output } = await compile(`
import { Vault } from "./vault.pebble";

contract Main {
    spend s( redeemer: data ) {
        const { tx } = context;
        const InlineDatum{ datum: od } = tx.outputs[0].datum;
        const Locked{ owner, amount } = od as Vault.Locked;
        assert amount > 0;
        assert owner.length() == 28;
        assert tx.inputs.length() > 0;
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("match over the whole datum union", async () => {
        const { diagnostics, output } = await compile(`
import { Vault } from "./vault.pebble";

contract Main {
    spend s( redeemer: data ) {
        const { tx } = context;
        const InlineDatum{ datum: od } = tx.outputs[0].datum;
        match ( od as Vault ) {
            when Locked{ owner, amount }: { assert amount >= 0; }
            when Idle{ owner }: { assert owner.length() == 28; }
        }
        assert tx.inputs.length() > 0;
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("redeemerof — compile", () => {

    test("`redeemerof Vault` (direct methods union) cross-module", async () => {
        const { diagnostics, output } = await compile(`
import { Vault } from "./vault.pebble";

contract Main {
    spend s( redeemer: data ) {
        const { tx } = context;
        match ( redeemer as redeemerof Vault ) {
            when open{ amount }: { assert amount > 0; }
            when burn{}: { assert true; }
        }
        assert tx.inputs.length() > 0;
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("`redeemerof Vault.Locked` (state spend union) cross-module", async () => {
        const { diagnostics, output } = await compile(`
import { Vault } from "./vault.pebble";

contract Main {
    spend s( redeemer: data ) {
        const { tx } = context;
        match ( redeemer as redeemerof Vault.Locked ) {
            when withdraw{ part }: { assert part > 0; }
            when close{}: { assert true; }
        }
        assert tx.inputs.length() > 0;
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("redeemerof — execution round-trips", () => {

    test("direct union: merged tag order is spend, mint, ... (open=0, burn=1)", async () => {
        // Vault has no direct spend methods, so mint methods start at tag 0.
        // build the redeemer with the DECLARED union type of another module
        // and decode it through `redeemerof`.
        const { result, diagnostics } = await run(`
import { Vault } from "./vault.pebble";

const r = ( std.builtins.constrData( 0, [ std.builtins.iData( 42 ) ] ) ) as redeemerof Vault;
const open{ amount } = r;
trace amount;
`);
        expect( diagnostics ).toEqual( [] );
        expect( result.logs ).toEqual( [ "42" ] );
    });

    test("state union: withdraw=0 in Locked's own union", async () => {
        const { result, diagnostics } = await run(`
import { Vault } from "./vault.pebble";

const r = ( std.builtins.constrData( 0, [ std.builtins.iData( 7 ) ] ) ) as redeemerof Vault.Locked;
const withdraw{ part } = r;
trace part;
`);
        expect( diagnostics ).toEqual( [] );
        expect( result.logs ).toEqual( [ "7" ] );
    });

    test("decoding the WRONG direct constructor tag fails", async () => {
        const { result } = await run(`
import { Vault } from "./vault.pebble";

const r = ( std.builtins.constrData( 1, [] ) ) as redeemerof Vault;
const open{ amount } = r;
trace amount;
`);
        expect( result.logs ).not.toEqual( [ "42" ] );
    });
});

describe("redeemerof / export contract — diagnostics", () => {

    test("unknown state -> 30203", async () => {
        const { diagnostics } = await compile(`
import { Vault } from "./vault.pebble";
function f( d: data ): int { const withdraw{ part } = d as redeemerof Vault.NoSuchState; return part; }
`);
        expect( diagnostics.some( d => d.includes("30203") ) ).toBe( true );
    });

    test("per-method attempt -> 30205", async () => {
        const { diagnostics } = await compile(`
import { Vault } from "./vault.pebble";
function f( d: data ): int { const withdraw{ part } = d as redeemerof Vault.Locked.withdraw; return part; }
`);
        expect( diagnostics.some( d => d.includes("30205") ) ).toBe( true );
    });

    test("not a contract -> 30201", async () => {
        const { diagnostics } = await compile(`
struct NotAContract { A { x: int } }
contract Main {
    spend s( redeemer: data ) {
        const { tx } = context;
        const r = redeemer as redeemerof NotAContract;
        assert tx.inputs.length() > 0;
    }
}
`, {});
        expect( diagnostics.some( d => d.includes("30201") ) ).toBe( true );
    });

    test("state without spend methods -> 30204", async () => {
        const { diagnostics } = await compile(`
import { Vault } from "./vault.pebble";
function f( d: data ): int { const x{ n } = d as redeemerof Vault.Idle; return n; }
`);
        expect( diagnostics.some( d => d.includes("30204") ) ).toBe( true );
    });

    test("non-exported contract is not importable", async () => {
        const { diagnostics } = await compile(`
import { Hidden } from "./hidden.pebble";
contract Main {
    mint m() {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) == 1;
    }
}
`, {
            "hidden.pebble": `
contract Hidden {
    mint x() {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) == 1;
    }
}
`,
        });
        expect( diagnostics.some( d => d.includes("2305") ) ).toBe( true );
    });

    test("duplicate method names in different states are allowed", async () => {
        const { diagnostics, output } = await compile(`
export contract Both {
    state A {
        n: int
        spend go() { const { tx } = context; assert tx.inputs.length() > 0; }
    }
    state B {
        m: int
        spend go() { const { tx } = context; assert tx.inputs.length() > 1; }
    }
}
`, {});
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});
