import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { CEKConst, CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB, Data } from "@harmoniclabs/plutus-data";

// Bug 16 from `the-cardano-masterpiece` (PEBBLE_BUGS.md):
// a `const` referenced only inside a lambda was inlined into the closure
// and re-evaluated PER CALL — sha256-of-8KB re-ran once per list element
// (~24B CPU steps over 128 elements, blowing the 10B tx limit).
// TOTAL (cannot-fail) values are now floated out of closures/loop bodies,
// so lambdas only access evaluated constants. Partial computations keep
// their lazy in-closure placement (bug-12 safety).

async function runBudget( src: string ): Promise<{ cpu: bigint, logs: string[] }> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    const r: any = await c.run({ entry: "main.pebble", root: "/" });
    return { cpu: r.budgetSpent?.cpu ?? BigInt(-1), logs: r.logs };
}

const script = ( n: number ) => `
const xs: List<bytes> = [ ${ Array.from({length:n}, () => "#aa").join(", ") } ];
const expensive = std.crypto.sha2_256( std.builtins.replicateByte( 8192, 255 ) );
const allDiff = xs.every( c => c != expensive );
trace allDiff ? 1 : 0;
`;

jest.setTimeout( 300_000 );

describe("masterpiece bug 16 — consts referenced in lambdas are not re-evaluated per call", () => {

    test("hash-heavy const in a per-element closure evaluates ONCE", async () => {
        const b2 = await runBudget( script( 2 ) );
        const b8 = await runBudget( script( 8 ) );
        expect( b2.logs ).toEqual( [ "1" ] );
        expect( b8.logs ).toEqual( [ "1" ] );
        // pre-fix this ratio was ~4.0 (the sha256 re-ran per element);
        // with the const evaluated once it must be near 1
        const ratio = Number( b8.cpu ) / Number( b2.cpu );
        expect( ratio ).toBeLessThan( 1.5 );
    });

    // retest datapoint from the masterpiece repo (2026-07-23): the real
    // contract passes replicateByte a COMPUTED const (`CHUNK_SIZE =
    // LINE_LENGTH * 8`), which reaches the totality check as letted
    // arithmetic — the first fix only accepted bare `IRConst` args, so the
    // const stayed in the closure and still re-ran per element (27.0B CPU
    // on-chain vs 3.19B). `comptimeInt` now sees through letted consts and
    // const integer arithmetic.
    test("replicateByte with a NAMED (derived) const size still floats", async () => {
        const mk = ( n: number ) => `
const LINE_LENGTH = 1024;
const CHUNK_SIZE = LINE_LENGTH * 8;
const xs: List<bytes> = [ ${ Array.from({length:n}, () => "#aa").join(", ") } ];
const expensive = std.crypto.sha2_256( std.builtins.replicateByte( CHUNK_SIZE, 255 ) );
const allDiff = xs.every( c => c != expensive );
trace allDiff ? 1 : 0;
`;
        const b2 = await runBudget( mk( 2 ) );
        const b8 = await runBudget( mk( 8 ) );
        expect( b2.logs ).toEqual( [ "1" ] );
        expect( b8.logs ).toEqual( [ "1" ] );
        expect( Number( b8.cpu ) / Number( b2.cpu ) ).toBeLessThan( 1.5 );
    });

    test("full masterpiece shape (derived const size + user-function wrapper + chained consts) floats", async () => {
        const mk = ( n: number ) => `
const LINE_LENGTH = 1024;
const CHUNK_SIZE = LINE_LENGTH * 8;
function cidV1Raw( content: bytes ): bytes {
    return std.bytes.concat( #01551220, std.crypto.sha2_256( content ) );
}
const xs: List<bytes> = [ ${ Array.from({length:n}, () => "#aa").join(", ") } ];
const initialChunk = std.builtins.replicateByte( CHUNK_SIZE, 255 );
const initialCid = cidV1Raw( initialChunk );
const allDiff = xs.every( c => c != initialCid );
trace allDiff ? 1 : 0;
`;
        const b2 = await runBudget( mk( 2 ) );
        const b8 = await runBudget( mk( 8 ) );
        expect( b2.logs ).toEqual( [ "1" ] );
        expect( b8.logs ).toEqual( [ "1" ] );
        expect( Number( b8.cpu ) / Number( b2.cpu ) ).toBeLessThan( 1.5 );
    });

    // BUG 24 (2026-07-23): a DEEPER const chain regressed compute-once —
    // `CHUNK_SIZE / 2` uses divideInteger, which the comptime evaluator
    // could not see through, so the whole chain (half -> concat -> hash)
    // was deemed unsafe and re-ran per element (25.8B CPU on-chain).
    // Division by a comptime non-zero constant is now accepted as total.
    test("const chain with DIVISION in replicateByte size still floats (bug 24)", async () => {
        const mk = ( n: number ) => `
const LINE_LENGTH = 1024;
const CHUNK_SIZE = LINE_LENGTH * 8;
function cidV1Raw( content: bytes ): bytes {
    return std.bytes.concat( #01551220, std.crypto.sha2_256( content ) );
}
const xs: List<bytes> = [ ${ Array.from({length:n}, () => "#aa").join(", ") } ];
const half = std.builtins.replicateByte( CHUNK_SIZE / 2, 255 );
const initialChunk = std.bytes.concat( half, half );
const initialCid = cidV1Raw( initialChunk );
const allDiff = xs.every( c => c != initialCid );
trace allDiff ? 1 : 0;
`;
        const b2 = await runBudget( mk( 2 ) );
        const b8 = await runBudget( mk( 8 ) );
        expect( b2.logs ).toEqual( [ "1" ] );
        expect( b8.logs ).toEqual( [ "1" ] );
        expect( Number( b8.cpu ) / Number( b2.cpu ) ).toBeLessThan( 1.5 );
    });

    test("partial computations still evaluate lazily inside the closure", async () => {
        // `ys.head()` CAN fail; it must NOT be floated out of the lambda:
        // with an empty `ys` the `every` short-circuits (empty list -> true)
        // and head() must never run
        const { logs } = await runBudget(`
const xs: List<bytes> = [];
const ys: List<bytes> = [];
const ok = xs.every( c => c == ys.head() );
trace ok ? 1 : 0;
`);
        expect( logs ).toEqual( [ "1" ] );
    });
});
