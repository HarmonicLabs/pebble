import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8, fromHex } from "@harmoniclabs/uint8array-utils";
import { Application, UPLCConst, parseUPLC } from "@harmoniclabs/uplc";
import { CEKConst, CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB } from "@harmoniclabs/plutus-data";

// Bugs found in pebble-simple-orderbook (against 0.3.4).

async function exportFn( name: string, src: string ) {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "t.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    await c.export({ functionName: name, entry: "t.pebble", root: "/" });
    if( c.diagnostics.length ) throw new Error( "compile failed: " + c.diagnostics.map( d => d.toString() ).join( "\n" ) );
    return parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
}
function apply( u: any, ...consts: any[] ): string {
    let t = u; for( const c of consts ) t = new Application( t, c );
    const r = Machine.evalSimple( t );
    return r instanceof CEKError ? "REJECT" : ( r instanceof CEKConst ? String( ( r as CEKConst ).value ) : "OTHER" );
}
const I = ( n: number ) => UPLCConst.int( n );
const B = ( h: string ) => UPLCConst.byteString( fromHex( h ) as any );

// A `case` arm deconstructing `P{ field: alias }` registered the SSA rename
// under the struct FIELD name instead of the alias the body references — so an
// outer variable/parameter sharing the field's name was shadowed by the field
// value (silent miscompilation: the orderbook's `aa2 == askAmount - paid`
// became `120 == 120 - 80` because the `askAmount` parameter read the field).
describe("orderbook: `case` arm field alias must not shadow same-named outer vars", () => {

    test("a parameter named like a deconstructed struct field reads its own value", async () => {
        const u = await exportFn( "f",
            `struct OD { F{ o: bytes } P{ x1: bytes, askAmount: int } }
             function f( d: data, askAmount: int ): boolean {
                 return case (d as OD)
                     is F{ o: fo } => false
                     is P{ x1: xx, askAmount: aa2 } => ( askAmount == 200 );
             }`
        );
        const datum = new DataConstr( 1, [ new DataB( fromHex("aa") ), new DataI( 120 ) ] ); // P{ x1:#aa, askAmount:120 }
        // the PARAM askAmount is 200; it must read 200, NOT the field's 120
        expect( apply( u, UPLCConst.data( datum ), I( 200 ) ) ).toBe( "true" );
    });

    test("the alias still reads the field; the param keeps its own value (full orderbook shape)", async () => {
        const u = await exportFn( "f", `
struct OrderDatum { FullFill{ owner: bytes } PartialFill{ owner: bytes, askPolicy: bytes, askName: bytes, offeredPolicy: bytes, offeredName: bytes, offeredTotal: int, askAmount: int } }
struct Wrap { Inl{ d: data } }
function f( w: data, owner: bytes, askPolicy: bytes, askName: bytes, offeredPolicy: bytes, offeredName: bytes, remaining: int, askAmount: int, paid: int ): boolean {
    return case (w as Wrap) is Inl{ d: cdData } => (
        case (cdData as OrderDatum)
            is FullFill{ owner: fo } => false
            is PartialFill{ owner: o2, askPolicy: ap2, askName: an2, offeredPolicy: op2, offeredName: on2, offeredTotal: ot2, askAmount: aa2 } => (
                o2 == owner && ap2 == askPolicy && an2 == askName && op2 == offeredPolicy && on2 == offeredName &&
                ot2 == remaining && aa2 == askAmount - paid && aa2 >= 0
            )
    );
}`);
        const datum = new DataConstr( 1, [
            new DataB( fromHex("11") ), new DataB( fromHex("aa") ), new DataB( fromHex("bb") ),
            new DataB( fromHex("cc") ), new DataB( fromHex("dd") ), new DataI( 600 ), new DataI( 120 ),
        ]);
        const wData = new DataConstr( 0, [ datum ] );
        // every field matches: aa2=120 == askAmount(200) - paid(80) = 120, ot2=600 == remaining
        expect( apply( u, UPLCConst.data( wData ), B("11"), B("aa"), B("bb"), B("cc"), B("dd"), I(600), I(200), I(80) ) ).toBe( "true" );
    });

    test("shorthand `P{ field }` still binds the field", async () => {
        const u = await exportFn( "f",
            `struct OD { F{ o: bytes } P{ x1: bytes, askAmount: int } }
             function f( d: data ): int {
                 return case (d as OD) is F{ o: fo } => 0 is P{ x1: xx, askAmount } => ( askAmount );
             }`
        );
        const datum = new DataConstr( 1, [ new DataB( fromHex("aa") ), new DataI( 120 ) ] );
        expect( apply( u, UPLCConst.data( datum ) ) ).toBe( "120" );
    });
});
