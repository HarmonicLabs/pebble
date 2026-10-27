import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { Data, DataB, DataConstr, DataI, DataList, dataFromCbor } from "@harmoniclabs/plutus-data";

// `withdraw` methods read the withdrawing account as `context.credential`.
// The contract sugar used to expose it only as `context.policy` (a copy of
// the `mint` branch), so `const { credential } = context` did not compile
// under either target. `policy` still works, for existing code.

const fixturesPath = path.resolve( __dirname, "fixtures/v4-data-encodings.json" );
const hasFixtures = existsSync( fixturesPath );
const fixtures: Record<string, string> = hasFixtures
    ? JSON.parse( readFileSync( fixturesPath, "utf8" ) ).fixtures
    : {};
const fx = ( name: string ) => dataFromCbor( fromHex( fixtures[ name ] ) );

async function compileContract( src: string, target?: string ): Promise<{ flat?: Uint8Array; error?: string }>
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: false,
    });
    const c = new Compiler( ioApi, {
        ...testOptions,
        compilerVersion: COMPILER_VERSION,
        ...( target ? { targetPlutusVersion: target } : {} ),
    } as any );
    try {
        return { flat: await c.compile({ entry: "main.pebble", root: "/" } as any ) };
    } catch ( e ) {
        return { error: e instanceof Error ? e.message : String( e ) };
    }
}

/** V4 context for the `Withdrawing` fixture: the withdrawing account is the
 * fixture's `accA` (a key credential), and `txinfo_full` withdraws 9 from it */
function withdrawContext( redeemer: Data ): Data
{
    const tx = ( fx( "txinfo_full" ) as DataList ).list.slice();
    tx[1] = new DataConstr( 1, [] ); // subTxIx = None: top level
    return new DataList([ new DataList( tx ), redeemer, fx( "scriptinfo_withdrawing" ), new DataB( new Uint8Array( 28 ) ) ]);
}

function accepts( flat: Uint8Array, c: Data ): boolean
{
    return !( Machine.eval( new Application( parseUPLC( flat ).body, UPLCConst.data( c ) ) ).result instanceof CEKError );
}

jest.setTimeout( 300_000 );

describe("withdraw methods: context.credential", () => {

    ( hasFixtures ? test : test.skip )("experimental-v4: credential is the withdrawing account", async () => {
        const r = await compileContract(`
contract W {
    withdraw observe( expected: int ) {
        const { tx, credential } = context;
        assert credential is PubKey else "key account";
        const Some{ value: amount } = tx.withdrawals.lookup( credential );
        assert amount == expected else "amount";
    }
}`, "experimental-v4" );
        expect( r.error ).toBeUndefined();
        // the single direct method takes one int: Constr 0 [ I n ]
        expect( accepts( r.flat!, withdrawContext( new DataConstr( 0, [ new DataI( 9 ) ] ) ) ) ).toBe( true );
        expect( accepts( r.flat!, withdrawContext( new DataConstr( 0, [ new DataI( 10 ) ] ) ) ) ).toBe( false );
    });

    test("v3: context.credential compiles", async () => {
        const r = await compileContract(`
contract W {
    withdraw observe() {
        const { tx, credential } = context;
        assert credential is Script else "script account";
    }
}`);
        expect( r.error ).toBeUndefined();
    });

    test("context.policy still compiles in withdraw methods", async () => {
        const r = await compileContract(`
contract W {
    withdraw observe() {
        const { policy } = context;
        assert policy is Script else "script account";
    }
}`);
        expect( r.error ).toBeUndefined();
    });
});
