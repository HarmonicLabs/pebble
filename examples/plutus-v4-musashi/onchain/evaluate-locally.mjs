// Evaluates out/out.flat on the CEK machine against V4 script contexts built
// from the real plutus-ledger-api 1.71 encodings (the compiler's test
// fixtures): one valid spend and four that must be rejected.
//
//   node onchain/evaluate-locally.mjs      (from examples/plutus-v4-musashi,
//                                           after `npm i` in packages/pebble)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import url from "node:url";

const here = path.dirname( url.fileURLToPath( import.meta.url ) );
const pkg = path.resolve( here, "../../../packages/pebble" );
const require = createRequire( path.join( pkg, "package.json" ) );
const { parseUPLC, UPLCConst, Application } = require( "@harmoniclabs/uplc" );
const { Machine, CEKError } = require( "@harmoniclabs/plutus-machine" );
const { dataFromCbor, DataConstr, DataList, DataI, DataB } = require( "@harmoniclabs/plutus-data" );

const fixtures = JSON.parse( readFileSync(
    path.join( pkg, "src/compiler/__tests__/fixtures/v4-data-encodings.json" ), "utf8"
) ).fixtures;
const fixture = name => dataFromCbor( Buffer.from( fixtures[ name ], "hex" ) );
const program = parseUPLC( readFileSync( path.resolve( here, "../out/out.flat" ) ) ).body;

const secret = Buffer.from( "pebble-v4-on-musashi" );
const notBefore = 1_793_000_000_000n;
const datum = new DataConstr( 0, [
    new DataB( createHash( "sha256" ).update( secret ).digest() ),
    new DataI( notBefore )
]);
const some = x => new DataConstr( 0, [ x ] );
const none = new DataConstr( 1, [] );

// V4 ScriptContext = List [ TxInfo, redeemer, ScriptInfo, ScriptHash ]
function context({ lowerBound, sec = secret, subTx = false }) {
    const tx = fixture( "txinfo_full" ).list.slice();
    tx[1] = subTx ? some( new DataI( 0 ) ) : none;                     // txInfoSubTxIx
    tx[10] = new DataList([                                            // txInfoValidRange
        lowerBound === undefined ? none : some( new DataI( lowerBound ) ),
        none
    ]);
    const spending = new DataConstr( 1, [ fixture( "txoutref" ), some( datum ) ] ); // SpendingScript ref (Just datum)
    const redeemer = new DataConstr( 0, [ new DataB( sec ) ] );                    // unlock( secret )
    return new DataList([ new DataList( tx ), redeemer, spending, new DataB( Buffer.alloc( 28 ) ) ]);
}

let failures = 0;
function expect( name, ctx, shouldAccept ) {
    const r = Machine.eval( new Application( program, UPLCConst.data( ctx ) ) );
    const accepted = !( r.result instanceof CEKError );
    const ok = accepted === shouldAccept;
    if( !ok ) failures++;
    console.log(
        ( ok ? "PASS " : "FAIL " ) + name.padEnd( 26 ),
        accepted ? "accepted" : "rejected" + ( r.logs.length ? ` (${ r.logs.join( "; " ) })` : "" ),
        `| cpu ${ r.budgetSpent.cpu } mem ${ r.budgetSpent.mem }`
    );
}

expect( "valid unlock",             context({ lowerBound: notBefore + 1000n }), true );
expect( "wrong secret",             context({ lowerBound: notBefore + 1000n, sec: Buffer.from( "nope" ) }), false );
expect( "too early",                context({ lowerBound: notBefore - 1n }), false );
expect( "no lower bound",           context({}), false );
expect( "inside a sub-transaction", context({ lowerBound: notBefore + 1000n, subTx: true }), false );
process.exit( failures ? 1 : 0 );
