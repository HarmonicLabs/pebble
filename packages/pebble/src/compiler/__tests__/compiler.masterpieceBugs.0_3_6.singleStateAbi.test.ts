import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKConst, CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB, Data } from "@harmoniclabs/plutus-data";

// single-state contract, mirroring Ownership's `Free { coords }` shape
const SRC = `
struct Coordinates { x0: int, y0: int, x1: int, y1: int }

contract SC {
    state Free {
        coords: Coordinates;

        spend claim() {
            const { tx, state: { coords } } = context;
            assert coords.x0 == 0;
        }
    }
}
`;

async function compileIt( src: string ) {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.compile({ entry: "main.pebble", root: "/" });
    const d = c.diagnostics.map( x => x.toString() );
    if( d.length ) throw new Error( d[0] );
    return ioApi.outputs.get("out/out.flat")!;
}

// spend ctx: DataConstr(0, [ tx, redeemer, Spend{ ref, optionalDatum } ])
function spendCtx( datum: Data ): DataConstr {
    const txFields: Data[] = Array.from( { length: 16 }, () => new DataI( 0 ) );
    const ref = new DataConstr( 0, [ new DataB( fromHex("aa".repeat(32)) ), new DataI( 0 ) ] );
    return new DataConstr( 0, [
        new DataConstr( 0, txFields ),
        new DataConstr( 0, [] ),                 // redeemer (claim has no args)
        new DataConstr( 1, [ ref, new DataConstr( 0, [ datum ] ) ] ), // Spend{ ref, Some{datum} }
    ]);
}

function evalWith( flat: Uint8Array, datum: Data ): string {
    const applied = new Application( parseUPLC( flat ).body, UPLCConst.data( spendCtx( datum ) ) );
    const r = Machine.evalSimple( applied );
    return r instanceof CEKError ? "ERROR: " + String( r.msg ?? "" ).slice( 0, 70 ) : "ACCEPT";
}

const coords = new DataConstr( 0, [ new DataI(0), new DataI(0), new DataI(4), new DataI(4) ] );
const bare = coords;                                 // datum = the single state's fields directly?
const wrapped = new DataConstr( 0, [ coords ] );     // datum = Constr 0 [ coords ]

jest.setTimeout( 120_000 );

// Bug 17 from `the-cardano-masterpiece` (PEBBLE_BUGS.md): reported as
// "single-state datum ABI: spend dispatch and `as Contract` cast disagree".
// Pinned here: they AGREE — under the default encoding strategy a
// single-state contract's datum is the WRAPPED record
// `Constr 0 [ ...state fields ]` for BOTH the dispatch and the union cast.
// (The confusion came from State.md documenting bare "raw fields" for
// single-state contracts, and from casting the state datum `as <FieldStruct>`
// instead of `as <Contract>`.)
describe("masterpiece bug 17 — single-state datum ABI is consistent (wrapped)", () => {

    test("spend dispatch expects the wrapped state record", async () => {
        const flat = await compileIt( SRC );
        expect( evalWith( flat, wrapped ) ).toBe( "ACCEPT" );
        expect( evalWith( flat, bare ) ).not.toBe( "ACCEPT" );
    });

    test("`od as Contract` agrees with the dispatch on the same datum", async () => {
        const SRC2 = SRC.replace(
            `assert coords.x0 == 0;`,
            `assert coords.x0 == 0;
            const { optionalDatum } = context;
            const Some{ value: od } = optionalDatum;
            const Free{ coords: c2 } = od as SC;
            assert c2.x0 == 0;`
        );
        const flat2 = await compileIt( SRC2 );
        expect( evalWith( flat2, wrapped ) ).toBe( "ACCEPT" );
        expect( evalWith( flat2, bare ) ).not.toBe( "ACCEPT" );
    });
});
