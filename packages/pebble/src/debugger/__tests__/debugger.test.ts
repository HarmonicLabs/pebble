import { testOptions, productionOptions, COMPILER_VERSION, CompilerOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../../compiler/io/CompilerIoApi";
import { Compiler } from "../../compiler/Compiler";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { CEKConst, CEKConstr } from "@harmoniclabs/plutus-machine";
import { DataB, DataConstr, DataI, DataList } from "@harmoniclabs/plutus-data";
import { constT } from "@harmoniclabs/uplc";
import { DebugRun } from "../DebugRun";
import { debugRunToJson, formatDebugRun, stmtText, valueText } from "../report";
import { decodeValue, formatValue, valueToJson } from "../renderValue";
import { TirDataStructType, TirSoPStructType, TirStructConstr, TirStructField } from "../../compiler/tir/types/TirStructType";
import { TirSopOptT } from "../../compiler/tir/types/TirNativeType/native/Optional/sop";
import { TirListT } from "../../compiler/tir/types/TirNativeType/native/list";
import { int_t, bool_t, bytes_t } from "../../compiler/tir/program/stdScope/stdScope";

/**
 * The debugger: a recorded evaluation shown statement by statement in source order, with the
 * values of the variables. The steps are golden: `line text` per step, indented by call depth.
 */

const lines = ( ...ls: string[] ) => ls.join( "\n" );

function makeCompiler( src: string, cfg: Partial<CompilerOptions> = {} ): Compiler
{
    const io = createMemoryCompilerIoApi({ sources: new Map([[ "main.pebble", fromUtf8( src ) ]]), useConsoleAsOutput: false });
    return new Compiler( io, { ...testOptions, ...cfg, entry: "main.pebble", root: "/", compilerVersion: COMPILER_VERSION } as CompilerOptions );
}

async function debugTest( src: string, name: string, cfg: Partial<CompilerOptions> = {} ): Promise<DebugRun>
{
    const { run, test } = await makeCompiler( src, cfg ).debugTest({ name } as any );
    if( run === undefined ) throw new Error( "test did not run: " + JSON.stringify( test ) );
    return run;
}

/** `line text`, indented two spaces per call level, `!` at the failed step */
function steps( run: DebugRun ): string[]
{
    return run.steps.map( s => {
        const line = s.stmt.range.source.lineAt( s.stmt.range.start );
        return `${"  ".repeat( s.depth - 1 )}${line} ${stmtText( s.stmt.range )}${s.failed ? " !" : ""}`;
    });
}

/** `name = value` of the variables in scope at the step whose text starts with `text` (the `nth` one) */
function varsAt( run: DebugRun, text: string, nth: number = 0 ): string[]
{
    const found = run.steps.filter( s => stmtText( s.stmt.range ).startsWith( text ) )[ nth ];
    if( found === undefined ) throw new Error( `no step "${text}" #${nth}` );
    return run.variablesAt( found.index ).map( v => `${v.v.name} = ${valueText( v )}` );
}

const FIXTURE = lines(
/*  1 */ "function sumTo( n: int ): int {",
/*  2 */ "    let acc = 0;",
/*  3 */ "    for( let i = 1; i <= n; i++ ) {",
/*  4 */ "        acc = acc + i;",
/*  5 */ "    }",
/*  6 */ "    return acc;",
/*  7 */ "}",
/*  8 */ "",
/*  9 */ "function classify( x: int ): int {",
/* 10 */ "    if( x > 10 ) {",
/* 11 */ "        return 2;",
/* 12 */ "    }",
/* 13 */ "    let y = x * 2;",
/* 14 */ "    if( y > 10 ) {",
/* 15 */ "        y = y - 1;",
/* 16 */ "    } else {",
/* 17 */ "        y = y + 1;",
/* 18 */ "    }",
/* 19 */ "    return y;",
/* 20 */ "}",
/* 21 */ "",
/* 22 */ "function firstBig( xs: List<int> ): int {",
/* 23 */ "    for( const x of xs ) {",
/* 24 */ "        if( x > 5 ) return x;",
/* 25 */ "    }",
/* 26 */ "    return 0;",
/* 27 */ "}",
/* 28 */ "",
/* 29 */ "test sums() {",
/* 30 */ "    const s = sumTo( 4 );",
/* 31 */ "    assert s == 10;",
/* 32 */ "    const c = classify( 3 );",
/* 33 */ "    assert c == 7;",
/* 34 */ "    const f = firstBig( [ 1, 7, 9 ] );",
/* 35 */ "    assert f == 7;",
/* 36 */ "    const big = classify( 20 );",
/* 37 */ "    assert big == 3 else \"big is 2, not 3\";",
/* 38 */ "}",
/* 39 */ "",
/* 40 */ "test passes() {",
/* 41 */ "    const a = 2;",
/* 42 */ "    const b = a * 21;",
/* 43 */ "    assert b == 42;",
/* 44 */ "}",
);

describe("debugger", () => {

    test("statements in source order, each call under the statement that makes it, until the failure", async () => {
        const run = await debugTest( FIXTURE, "sums" );
        expect( steps( run ) ).toEqual([
            "30 const s = sumTo( 4 )",
            "  2 let acc = 0",
            "  3 for( let i = 1; i <= n; i++ ) {",
            "  3 i <= n", "  4 acc = acc + i", "  3 i++",
            "  3 i <= n", "  4 acc = acc + i", "  3 i++",
            "  3 i <= n", "  4 acc = acc + i", "  3 i++",
            "  3 i <= n", "  4 acc = acc + i", "  3 i++",
            "  3 i <= n",
            "31 assert s == 10;",
            "32 const c = classify( 3 )",
            "  10 if( x > 10 ) {",
            "  13 let y = x * 2",
            "  14 if( y > 10 ) {",
            "  17 y = y + 1",
            "  19 return y;",
            "33 assert c == 7;",
            "34 const f = firstBig( [ 1, 7, 9 ] )",
            "  23 for( const x of xs ) {",
            "  23 const x", "  24 if( x > 5 ) return x;",
            "  23 const x", "  24 if( x > 5 ) return x;", "  24 return x;",
            "35 assert f == 7;",
            "36 const big = classify( 20 )",
            "  10 if( x > 10 ) {",
            "  11 return 2;",
            "37 assert big == 3 else \"big is 2, not 3\"; !",
        ]);
        expect( run.failedStep ).toBe( run.steps.length - 1 );
        expect( varsAt( run, "assert big" ) ).toEqual([ "s = 10", "c = 7", "f = 7", "big = 2" ]);
        expect( run.recording.logs ).toEqual([ "big is 2, not 3" ]);
    });

    test("a loop runs one iteration frame per iteration, with that iteration's values", async () => {
        const run = await debugTest( FIXTURE, "sums" );
        // before `acc = acc + i` runs, and before `i++` runs, in iterations 1 and 3
        expect( varsAt( run, "acc = acc + i", 0 ) ).toEqual([ "n = 4", "acc = 0", "i = 1" ]);
        expect( varsAt( run, "i++", 0 ) ).toEqual([ "n = 4", "acc = 1", "i = 1" ]);
        expect( varsAt( run, "acc = acc + i", 2 ) ).toEqual([ "n = 4", "acc = 3", "i = 3" ]);
        // the exit check sees the final values
        expect( varsAt( run, "i <= n", 4 ) ).toEqual([ "n = 4", "acc = 10", "i = 5" ]);

        const iterations = run.steps
            .filter( s => s.frame.fn.kind === "loop" && stmtText( s.stmt.range ) === "i <= n" )
            .map( s => s.frame.iteration );
        expect( iterations ).toEqual([ 1, 2, 3, 4, 5 ]);
        // the `for` declares `i` with the first iteration's value
        const forStep = run.steps.find( s => s.stmt.kind === "for" )!;
        expect( run.declaredAt( forStep.index ).map( v => `${v.v.name} = ${valueText( v )}` ) ).toEqual([ "i = 1" ]);
    });

    test("a reassigned variable shows the value it has at each statement", async () => {
        const run = await debugTest( FIXTURE, "sums" );
        expect( varsAt( run, "y = y + 1" ) ).toEqual([ "x = 3", "y = 6" ]);
        expect( varsAt( run, "return y;" ) ).toEqual([ "x = 3", "y = 7" ]);
        const decl = run.steps.find( s => stmtText( s.stmt.range ) === "let y = x * 2" )!;
        expect( run.declaredAt( decl.index ).map( v => valueText( v ) ) ).toEqual([ "6" ]);
    });

    test("stack, and stepping into, over and out of calls", async () => {
        const run = await debugTest( FIXTURE, "sums" );
        const inClassify = run.steps.findIndex( s => stmtText( s.stmt.range ) === "y = y + 1" );
        expect( run.stackAt( inClassify ).map( f => f.name ) ).toEqual([ "classify", "test sums" ]);
        expect( stmtText( run.stackAt( inClassify )[1].stmt!.range ) ).toBe( "const c = classify( 3 )" );

        const callC = run.steps.findIndex( s => stmtText( s.stmt.range ) === "const c = classify( 3 )" );
        expect( stmtText( run.steps[ run.next( callC, "into" ) ].stmt.range ) ).toBe( "if( x > 10 ) {" );
        expect( stmtText( run.steps[ run.next( callC, "over" ) ].stmt.range ) ).toBe( "assert c == 7;" );
        expect( stmtText( run.steps[ run.next( inClassify, "out" ) ].stmt.range ) ).toBe( "assert c == 7;" );
        expect( run.prev( callC, "into" ) ).toBe( callC - 1 );
        expect( run.next( run.steps.length - 1, "into" ) ).toBe( -1 );
    });

    test("a passing test shows every statement", async () => {
        const run = await debugTest( FIXTURE, "passes" );
        expect( steps( run ) ).toEqual([ "41 const a = 2", "42 const b = a * 21", "43 assert b == 42;" ]);
        expect( run.failedStep ).toBe( -1 );
        expect( run.declaredAt( 1 ).map( v => valueText( v ) ) ).toEqual([ "42" ]);
    });

    test("a property test is debugged with its smallest failing inputs", async () => {
        const src = lines(
            "test small( x: int ) {",
            "    const y = x * 2;",
            "    assert y < 20;",
            "}",
        );
        const { run, test } = await makeCompiler( src ).debugTest({ name: "small" } as any );
        expect( test.passed ).toBe( false );
        expect( run ).toBeDefined();
        const failed = run!.steps[ run!.failedStep ];
        expect( stmtText( failed.stmt.range ) ).toBe( "assert y < 20;" );
        const vars = run!.variablesAt( failed.index ).map( v => `${v.v.name} = ${valueText( v )}` );
        const inputs = test.iterations[ test.iterations.length - 1 ].inputs!;
        expect( vars ).toEqual([ `x = ${inputs[0].value}`, `y = ${BigInt( inputs[0].value as any ) * BigInt( 2 )}` ]);
    });

    test("unknown and ambiguous test names are errors", async () => {
        await expect( makeCompiler( FIXTURE ).debugTest({ name: "nope" } as any ) ).rejects.toThrow( /no test named "nope"/ );
        await expect( makeCompiler( FIXTURE ).debugTest({ name: "s" } as any ) ).rejects.toThrow( /more than one test/ );
    });

    test("text and JSON reports", async () => {
        const run = await debugTest( FIXTURE, "sums" );
        const text = formatDebugRun( run );
        expect( text ).toContain( "→ classify" );
        expect( text ).toMatch( /assert big == 3 else "big is 2, not 3";\s+<- failed/ );
        expect( text ).toContain( "trace: big is 2, not 3" );

        const json = debugRunToJson( run );
        expect( json.result.passed ).toBe( false );
        expect( json.failedStep ).toBe( run.steps.length );
        const last = json.steps[ json.steps.length - 1 ];
        expect( last.failed ).toBe( true );
        expect( last.variables?.map( v => [ v.name, v.type, v.value ] ) ).toEqual([
            [ "s", "int", 10 ], [ "c", "int", 7 ], [ "f", "int", 7 ], [ "big", "int", 2 ]
        ]);
        expect( last.stack?.map( f => f.function ) ).toEqual([ "test sums" ]);
        // JSON-serializable as is
        expect( () => JSON.stringify( json ) ).not.toThrow();
    });
});

describe("debug information never changes the program", () => {

    const CONTRACT = lines(
        "contract Counter {",
        "    param owner: PubKeyHash;",
        "    spend take( amount: int ) {",
        "        const { tx } = context;",
        "        assert tx.requiredSigners.includes( this.owner );",
        "        let total = 0;",
        "        for( const i of tx.inputs ) {",
        "            total = total + 1;",
        "        }",
        "        assert total > amount;",
        "    }",
        "}",
    );

    for( const [ label, options ] of [ [ "test options", testOptions ], [ "production options", productionOptions ] ] as const )
    test( `${label}: the same bytes with and without it`, async () => {
        const plain = await makeCompiler( CONTRACT, options ).compileWithSourceMap();
        const debug = await makeCompiler( CONTRACT, options ).compileWithDebugInfo();
        expect( toHex( debug.bytes ) ).toBe( toHex( plain.bytes ) );
        expect( debug.sourceMap ).toEqual( plain.sourceMap );
        // the contract's method is a region, its statements stops
        expect( debug.debugTable.structure.regions.map( r => `${r.purpose} ${r.name}` ) ).toEqual([ "spend take" ]);
        expect( debug.debugTable.structure.vars.filter( v => !v.hidden ).map( v => v.name ) ).toEqual(
            expect.arrayContaining([ "owner", "amount", "tx", "total", "i" ])
        );
    });
});

describe("values are shown with their Pebble type", () => {

    const txOutRef = new TirDataStructType( "TxOutRef", "", [
        new TirStructConstr( "TxOutRef", [ new TirStructField( "id", bytes_t ), new TirStructField( "index", int_t ) ] )
    ], new Map() );
    const shape = new TirSoPStructType( "Shape", "", [
        new TirStructConstr( "Circle", [ new TirStructField( "r", int_t ) ] ),
        new TirStructConstr( "Square", [ new TirStructField( "side", int_t ), new TirStructField( "filled", bool_t ) ] ),
    ], new Map() );

    test("data structs, by constructor and field names", () => {
        const v = new CEKConst( constT.data, new DataConstr( 0, [ new DataB( "abcd" ), new DataI( 3 ) ] ) );
        const node = decodeValue( v, txOutRef );
        expect( formatValue( node ) ).toBe( "TxOutRef{ id: #abcd, index: 3 }" );
        expect( valueToJson( node ) ).toEqual({ TxOutRef: { id: "#abcd", index: 3 } });
    });

    test("SoP structs and optionals", () => {
        const square = new CEKConstr( 1, [ new CEKConst( constT.int, BigInt( 4 ) ), new CEKConst( constT.bool, true ) ] );
        expect( formatValue( decodeValue( square, shape ) ) ).toBe( "Square{ side: 4, filled: true }" );
        const some = new CEKConstr( 0, [ new CEKConst( constT.data, new DataI( 7 ) ) ] );
        expect( formatValue( decodeValue( some, new TirSopOptT( int_t ) ) ) ).toBe( "Some{ value: 7 }" );
        expect( formatValue( decodeValue( new CEKConstr( 1, [] ), new TirSopOptT( int_t ) ) ) ).toBe( "None{}" );
    });

    test("lists, and data that does not fit its type", () => {
        const list = new CEKConst( constT.listOf( constT.int ), [ BigInt( 1 ), BigInt( 2 ) ] as any );
        expect( formatValue( decodeValue( list, new TirListT( int_t ) ) ) ).toBe( "[1, 2]" );
        const odd = new CEKConst( constT.data, new DataList([ new DataI( 1 ) ]) );
        expect( formatValue( decodeValue( odd, txOutRef ) ) ).toBe( "[1]" );
        expect( valueToJson( decodeValue( odd, txOutRef ) ) ).toEqual({ list: [{ int: 1 }] });
    });

    test("long values are cut when asked", () => {
        const v = new CEKConst( constT.data, new DataConstr( 0, [ new DataB( "ab".repeat( 32 ) ), new DataI( 3 ) ] ) );
        expect( formatValue( decodeValue( v, txOutRef ), { maxBytes: 8 } ) ).toBe( "TxOutRef{ id: #abababab…, index: 3 }" );
        expect( formatValue( decodeValue( v, txOutRef ), { maxDepth: 0 } ) ).toBe( "TxOutRef{ … }" );
    });
});
