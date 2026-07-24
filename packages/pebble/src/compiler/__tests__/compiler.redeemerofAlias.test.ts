import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// `redeemerof` results are TYPES, not scope entries: each use resolves to
// the TIR struct type registered when the contract's types were derived.
// The way to NAME one is a `type` alias — these tests pin that down.

const VAULT = `
export contract Vault {
    state Locked {
        owner: bytes

        spend withdraw( part: int ) {
            const { tx } = context;
            assert part > 0;
        }
        spend close() {
            const { tx } = context;
            assert tx.inputs.length() > 0;
        }
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

describe("`type X = redeemerof C` aliases", () => {

    test("cross-module alias of the direct union", async () => {
        const { diagnostics, output } = await compile(`
import { Vault } from "./vault.pebble";

type VaultRedeemer = redeemerof Vault;

contract Main {
    spend s( redeemer: data ) {
        const { tx } = context;
        match ( redeemer as VaultRedeemer ) {
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

    test("cross-module alias of a state union", async () => {
        const { diagnostics, output } = await compile(`
import { Vault } from "./vault.pebble";

type LockedRedeemer = redeemerof Vault.Locked;

contract Main {
    spend s( redeemer: data ) {
        const { tx } = context;
        match ( redeemer as LockedRedeemer ) {
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

    test("constructor narrowing on the alias (`VaultRedeemer.open`)", async () => {
        const { result, diagnostics } = await run(`
import { Vault } from "./vault.pebble";

type VaultRedeemer = redeemerof Vault;

const d = std.builtins.constrData( 0, [ std.builtins.iData( 42 ) ] ) as data;
const open{ amount } = d as VaultRedeemer.open;
trace amount;
`);
        expect( diagnostics ).toEqual( [] );
        expect( result.logs ).toEqual( [ "42" ] );
    });

    test("alias as struct field type (cross-module)", async () => {
        const { diagnostics, output } = await compile(`
import { Vault } from "./vault.pebble";

type VaultRedeemer = redeemerof Vault;

struct Wrapped {
    W { inner: VaultRedeemer }
}

contract Main {
    spend s( redeemer: data ) {
        const { tx } = context;
        const W{ inner } = redeemer as Wrapped;
        match inner {
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

    test("same-file alias of an exported contract (alias BEFORE the contract)", async () => {
        const { diagnostics, output } = await compile(`
type MyRedeemer = redeemerof Self;

export contract Self {
    mint go( n: int ) {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) == n;
    }
    mint stop() {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) == 0;
    }
}
`, {});
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("`redeemerof` directly in function signatures", async () => {
        const { diagnostics, output } = await compile(`
import { Vault } from "./vault.pebble";

function openAmount( r: redeemerof Vault ): int {
    const open{ amount } = r;
    return amount;
}

contract Main {
    spend s( redeemer: data ) {
        const { tx } = context;
        assert openAmount( redeemer as redeemerof Vault ) > 0;
        assert tx.inputs.length() > 0;
    }
}
`);
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("`using X = redeemerof C` (not a type-alias form)", () => {

    test("errors instead of silently misbehaving", async () => {
        const { diagnostics, output } = await compile(`
import { Vault } from "./vault.pebble";

contract Main {
    spend s( redeemer: data ) {
        const { tx } = context;
        using VaultRedeemer = redeemerof Vault;
        assert tx.inputs.length() > 0;
    }
}
`);
        // `using` aliases NAMESPACES; the type-alias form is
        // `type X = redeemerof C;` — this must be a diagnostic, not a crash
        expect( diagnostics.length ).toBeGreaterThan( 0 );
        expect( output ).toBe( undefined );
    });
});
