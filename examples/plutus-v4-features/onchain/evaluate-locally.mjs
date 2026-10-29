// Evaluates out/out.flat on the CEK machine against V4 script contexts built
// from the real plutus-ledger-api 1.71 encodings (the compiler's test
// fixtures): for every method, one context it must accept and one it must
// reject.
//
//   node onchain/evaluate-locally.mjs      (from examples/plutus-v4-features,
//                                           after `npm i` in packages/pebble)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname( url.fileURLToPath( import.meta.url ) );
const pkg = path.resolve( here, "../../../packages/pebble" );
const require = createRequire( path.join( pkg, "package.json" ) );
const { parseUPLC, UPLCConst, Application } = require( "@harmoniclabs/uplc" );
const { Machine, CEKError } = require( "@harmoniclabs/plutus-machine" );
const { dataFromCbor, DataConstr, DataList, DataMap, DataPair, DataI, DataB } = require( "@harmoniclabs/plutus-data" );

const fixtures = JSON.parse( readFileSync(
    path.join( pkg, "src/compiler/__tests__/fixtures/v4-data-encodings.json" ), "utf8"
) ).fixtures;
const fixture = name => dataFromCbor( Buffer.from( fixtures[ name ], "hex" ) );
const program = parseUPLC( readFileSync( path.resolve( here, "../out/out.flat" ) ) ).body;

const C = ( i, fs = [] ) => new DataConstr( i, fs );
const some = x => C( 0, [ x ] ), none = C( 1 );
const map = entries => new DataMap( entries.map( ([ k, v ]) => new DataPair( k, v ) ) );
const pubKey = b => C( 0, [ new DataB( Buffer.alloc( 28, b ) ) ] );
const script = b => C( 1, [ new DataB( Buffer.alloc( 28, b ) ) ] );
const accA = pubKey( 0xaa );   // the fixtures' key account
const credS = script( 0x11 );  // the fixtures' script credential

// TxInfo field indices (V4): 1 subTxIx, 5 mint, 7 withdrawals,
// 8 directDeposits, 9 accountBalanceIntervals, 12 requiredTopLevelGuards
function context({ redeemer, info, subTx = false, set = {} }) {
    const tx = fixture( "txinfo_full" ).list.slice();
    tx[1] = subTx ? some( new DataI( 3 ) ) : none;
    for( const [ i, v ] of Object.entries( set ) ) tx[ Number( i ) ] = v;
    return new DataList([ new DataList( tx ), redeemer, info, new DataB( Buffer.alloc( 28 ) ) ]);
}

let failures = 0;
function expect( name, ctx, shouldAccept ) {
    const r = Machine.eval( new Application( program, UPLCConst.data( ctx ) ) );
    const accepted = !( r.result instanceof CEKError );
    const ok = accepted === shouldAccept;
    if( !ok ) failures++;
    console.log(
        ( ok ? "PASS " : "FAIL " ) + name.padEnd( 52 ),
        accepted ? "accepted" : "rejected" + ( r.logs.length ? ` (${ r.logs.join( "; " ) })` : "" )
    );
}

const spending = fixture( "scriptinfo_spending" );
// 0 inSubTx( topGuard ): spending inside a sub-transaction that requires credS at the top level
expect( "inSubTx: in a sub-transaction, guard required",       context({ redeemer: C( 0, [ credS ] ), info: spending, subTx: true }), true );
expect( "inSubTx: at the top level",                           context({ redeemer: C( 0, [ credS ] ), info: spending }), false );
expect( "inSubTx: a guard the batch does not require",         context({ redeemer: C( 0, [ accA ] ), info: spending, subTx: true }), false );

// 1 mintOne
const minting = fixture( "scriptinfo_minting" ); // policy #cccc
const mint = n => map([[ new DataB( Buffer.from( "cccc", "hex" ) ), map([[ new DataB( Buffer.from( "v4" ) ), new DataI( n ) ]]) ]]);
expect( "mintOne: one token",                                  context({ redeemer: C( 1 ), info: minting, set: { 5: mint( 1 ) } }), true );
expect( "mintOne: two tokens",                                 context({ redeemer: C( 1 ), info: minting, set: { 5: mint( 2 ) } }), false );

// 2 observeWithdrawal: withdrawing account accA
const withdrawing = fixture( "scriptinfo_withdrawing" );
expect( "observeWithdrawal: zero withdrawal",                  context({ redeemer: C( 2 ), info: withdrawing, set: { 7: map([[ accA, new DataI( 0 ) ]]) } }), true );
expect( "observeWithdrawal: non-zero withdrawal",              context({ redeemer: C( 2 ), info: withdrawing, set: { 7: map([[ accA, new DataI( 9 ) ]]) } }), false );

// 3 observeAccounts( depositTo, amount )
const both = ( lo, hi ) => C( 2, [ new DataI( lo ), new DataI( hi ) ] );
const accounts = interval => ({ 8: map([[ credS, new DataI( 1000000 ) ]]), 9: map([[ accA, interval ]]) });
expect( "observeAccounts: deposit and interval as declared",   context({ redeemer: C( 3, [ credS, new DataI( 1000000 ) ] ), info: withdrawing, set: accounts( both( 0, 1000000 ) ) }), true );
expect( "observeAccounts: different deposit amount",           context({ redeemer: C( 3, [ credS, new DataI( 2000000 ) ] ), info: withdrawing, set: accounts( both( 0, 1000000 ) ) }), false );
expect( "observeAccounts: exact interval instead of bounds",   context({ redeemer: C( 3, [ credS, new DataI( 1000000 ) ] ), info: withdrawing, set: accounts( C( 3, [ new DataI( 0 ) ] ) ) }), false );

// 4 registerAccount: CertifyingScript 0 (RegAccount account deposit)
const certifying = ( account, deposit ) => C( 3, [ new DataI( 0 ), C( 0, [ account, new DataI( deposit ) ] ) ] );
expect( "registerAccount: script account, 2 ADA",              context({ redeemer: C( 4 ), info: certifying( credS, 2000000 ) }), true );
expect( "registerAccount: key account",                        context({ redeemer: C( 4 ), info: certifying( accA, 2000000 ) }), false );

// 5 subTxGuard, 6 batchGuard( expectedSubTxs )
expect( "subTxGuard: guard inside a sub-transaction",          context({ redeemer: C( 5 ), info: fixture( "scriptinfo_guarding_sub" ), subTx: true }), true );
expect( "subTxGuard: at the top level",                        context({ redeemer: C( 5 ), info: fixture( "scriptinfo_guarding_sub" ) }), false );
expect( "batchGuard: top-level guard sees one sub-transaction", context({ redeemer: C( 6, [ new DataI( 1 ) ] ), info: fixture( "scriptinfo_guarding_top" ) }), true );
expect( "batchGuard: wrong batch size",                        context({ redeemer: C( 6, [ new DataI( 2 ) ] ), info: fixture( "scriptinfo_guarding_top" ) }), false );

process.exit( failures ? 1 : 0 );
