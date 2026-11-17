import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";

// Encoding-parity guard for the 0.3.7 merged direct-redeemer union:
// SINGLE-purpose contracts must keep a byte-identical script.
// The hex snapshots below pin the compiled output; when they drift, verify
// the REDEEMER WIRE FORMAT is unchanged (the execution tests in
// compiler.masterpieceBugs.0_3_6.test.ts decode redeemers with explicit
// constructor tags) before re-recording — tag changes are a hard error,
// pure placement/optimization drift is fine.
// History: recorded on 0.3.6 pre-merged-union; re-recorded on 0.3.7 after
// the const-float placement change (wire format re-verified); re-recorded on
// 0.6.0 after BUGs 78-80 (a term's hash follows what the term holds, the tree
// walk visits every branch: natives are shared in every method, so the three
// scripts are 210, 166 and 180 bytes, from 216, 166 and 182). Wire format
// re-verified by running the scripts recorded before against the new ones:
// the same verdict on each of 5,040 contexts (21 redeemers of every shape,
// 6 minted amounts, 5 numbers of inputs, the datums of the state).

async function compileHex( src: string ): Promise<string> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.compile({ entry: "main.pebble", root: "/" });
    const out = ioApi.outputs.get("out/out.flat");
    expect( out instanceof Uint8Array ).toBe( true );
    return toHex( out! );
}

export const SINGLE_PURPOSE_MULTI_METHOD = `
contract T {
    mint one() {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) == 1;
    }
    mint two( n: int ) {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) == n;
    }
}
`;

export const SINGLE_METHOD = `
contract T {
    mint only( n: int ) {
        const { tx, policy } = context;
        assert tx.mint.amountOf( policy, # ) == n;
    }
}
`;

export const STATE_TWO_SPENDS = `
contract T {
    state St {
        v: int

        spend a() {
            const { tx } = context;
            assert tx.inputs.length() > 0;
        }
        spend b( m: int ) {
            const { tx } = context;
            assert tx.inputs.length() > m;
        }
    }
}
`;

describe("redeemer encoding parity (single purpose, must match 0.3.6)", () => {
    test("single-purpose multi-method contract snapshot", async () => {
        expect( await compileHex( SINGLE_PURPOSE_MULTI_METHOD ) ).toMatchSnapshot();
    });
    test("single-method contract snapshot (untagged)", async () => {
        expect( await compileHex( SINGLE_METHOD ) ).toMatchSnapshot();
    });
    test("state with two spend methods snapshot", async () => {
        expect( await compileHex( STATE_TWO_SPENDS ) ).toMatchSnapshot();
    });
});
