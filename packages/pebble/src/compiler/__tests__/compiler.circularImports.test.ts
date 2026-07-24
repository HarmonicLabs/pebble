import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// 0.3.7: import cycles are allowed as long as only TYPE and CONTRACT
// symbols cross the cycle-closing edge. value (function/const) imports
// across a back edge produce diagnostic 6056.

async function compileProject( entry: string, files: Record<string, string> ) {
    const sources = new Map(
        Object.entries( files ).map(([ name, text ]) => [ name, fromUtf8( text ) ] as [string, Uint8Array])
    );
    const ioApi = createMemoryCompilerIoApi({ sources, useConsoleAsOutput: true });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    try {
        await c.compile({ entry, root: "/" });
    } catch {
        // diagnostics inspected by callers
    }
    return {
        output: ioApi.outputs.get("out/out.flat"),
        diagnostics: c.diagnostics.map( d => d.toString() ),
    };
}

// A and B are contracts that each decode the OTHER's datum/redeemer.
const MUTUAL_A = `
import { B } from "./b.pebble";

export contract A {
    state Holding {
        owner: bytes

        spend release( amount: int ) {
            const { tx } = context;
            const InlineDatum{ datum: od } = tx.outputs[0].datum;
            const Pending{ n } = od as B.Pending;
            assert n == amount;
        }
    }
}
`;
const MUTUAL_B = `
import { A } from "./a.pebble";

export contract B {
    state Pending {
        n: int

        spend accept() {
            const { tx } = context;
            const InlineDatum{ datum: od } = tx.outputs[0].datum;
            const Holding{ owner } = od as A.Holding;
            assert owner.length() == 28;
        }
    }
}
`;

describe("circular imports — contract type exchange", () => {

    test("A <-> B compiles with A as entry", async () => {
        const { diagnostics, output } = await compileProject( "a.pebble", {
            "a.pebble": MUTUAL_A,
            "b.pebble": MUTUAL_B,
        });
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("A <-> B compiles with B as entry (determinism)", async () => {
        const { diagnostics, output } = await compileProject( "b.pebble", {
            "a.pebble": MUTUAL_A,
            "b.pebble": MUTUAL_B,
        });
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("redeemerof across the cycle", async () => {
        const { diagnostics, output } = await compileProject( "a.pebble", {
            "a.pebble": `
import { B } from "./b.pebble";

export contract A {
    mint check() {
        const { tx, policy } = context;
        const r = ( std.builtins.iData( 0 ) as data ) as redeemerof B.Pending;
        match r {
            when accept{}: { assert true; }
        }
        assert tx.mint.amountOf( policy, # ) == 1;
    }
}
`,
            "b.pebble": MUTUAL_B,
        });
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("circular imports — value imports across the back edge", () => {

    test("function imported FROM the in-flight cycle target -> 6056", async () => {
        // entry = a; b closes the cycle back to a. when b compiles, a has
        // only run its types pass — importing a FUNCTION from a at that
        // point can never succeed.
        const { diagnostics } = await compileProject( "a.pebble", {
            "a.pebble": `
import { B } from "./b.pebble";

export function helper( n: int ): boolean { return n > 0; }

export contract A {
    state Holding {
        owner: bytes
        spend release() {
            const { tx } = context;
            const InlineDatum{ datum: od } = tx.outputs[0].datum;
            const Pending{ n } = od as B.Pending;
            assert n > 0;
        }
    }
}
`,
            "b.pebble": `
import { A, helper } from "./a.pebble";

export contract B {
    state Pending {
        n: int
        spend accept() {
            const { tx } = context;
            assert helper( tx.inputs.length() );
        }
    }
}
`,
        });
        expect( diagnostics.some( d => d.includes("6056") ) ).toBe( true );
    });

    test("value imports resolve when the exporter completes before the importer's values pass", async () => {
        // the cycle TARGET's own deferred imports are re-consumed after its
        // cycle mates finished — so the target CAN import functions.
        const { diagnostics, output } = await compileProject( "a.pebble", {
            "a.pebble": `
import { helper } from "./b.pebble";

export contract A {
    state Holding {
        owner: bytes
        spend release() {
            const { tx } = context;
            assert helper( tx.inputs.length() );
        }
    }
}
`,
            "b.pebble": `
import { A } from "./a.pebble";

export function helper( n: int ): boolean { return n > 0; }

export contract B {
    mint x() {
        const { tx, policy } = context;
        const InlineDatum{ datum: od } = tx.outputs[0].datum;
        const Holding{ owner } = od as A.Holding;
        assert tx.mint.amountOf( policy, # ) == 1;
    }
}
`,
        });
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});

describe("circular imports — shapes", () => {

    test("3-node cycle with contract types", async () => {
        const { diagnostics, output } = await compileProject( "a.pebble", {
            "a.pebble": `
import { C } from "./c.pebble";

export contract A {
    state SA {
        x: int
        spend sa() {
            const { tx } = context;
            const InlineDatum{ datum: od } = tx.outputs[0].datum;
            const SC{ z } = od as C.SC;
            assert z > 0;
        }
    }
}
`,
            "b.pebble": `
import { A } from "./a.pebble";

export contract B {
    state SB {
        y: int
        spend sb() {
            const { tx } = context;
            const InlineDatum{ datum: od } = tx.outputs[0].datum;
            const SA{ x } = od as A.SA;
            assert x > 0;
        }
    }
}
`,
            "c.pebble": `
import { B } from "./b.pebble";

export contract C {
    state SC {
        z: int
        spend sc() {
            const { tx } = context;
            const InlineDatum{ datum: od } = tx.outputs[0].datum;
            const SB{ y } = od as B.SB;
            assert y > 0;
        }
    }
}
`,
        });
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("diamond over a cycle: D -> {A, B}, A <-> B", async () => {
        const { diagnostics, output } = await compileProject( "d.pebble", {
            "d.pebble": `
import { A } from "./a.pebble";
import { B } from "./b.pebble";

contract D {
    spend s( redeemer: data ) {
        const { tx } = context;
        const InlineDatum{ datum: od } = tx.outputs[0].datum;
        match ( od as A ) {
            when Holding{ owner }: { assert owner.length() == 28; }
        }
        const InlineDatum{ datum: od2 } = tx.outputs[1].datum;
        match ( od2 as B ) {
            when Pending{ n }: { assert n >= 0; }
        }
    }
}
`,
            "a.pebble": MUTUAL_A,
            "b.pebble": MUTUAL_B,
        });
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("non-cyclic projects still compile (regression)", async () => {
        const { diagnostics, output } = await compileProject( "main.pebble", {
            "main.pebble": `
import { double } from "./lib.pebble";
contract Main {
    mint m() {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) == double( 1 );
    }
}
`,
            "lib.pebble": `export function double( n: int ): int { return n * 2; }`,
        });
        expect( diagnostics ).toEqual( [] );
        expect( output instanceof Uint8Array ).toBe( true );
    });
});
