import { Compiler } from "./dist/compiler/Compiler.js";
import { createMemoryCompilerIoApi } from "./dist/compiler/io/CompilerIoApi.js";
import { testOptions, COMPILER_VERSION } from "./dist/IR/toUPLC/CompilerOptions.js";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { readFileSync } from "node:fs";

const SRC = readFileSync( "/home/michele/hlabs/packages/plutus/the-cardano-masterpiece/bug-repros/bug22-minimal.pebble", "utf8" );

const variants = {
    production: { groupApplications: true, inlineSingleUse: true, simplifyWrappedPartialFuncApps: true, removeForceDelay: true },
    debug:      { groupApplications: false, inlineSingleUse: false, simplifyWrappedPartialFuncApps: false, removeForceDelay: true },
    noInline:   { groupApplications: true, inlineSingleUse: false, simplifyWrappedPartialFuncApps: true, removeForceDelay: true },
    noGroup:    { groupApplications: false, inlineSingleUse: true, simplifyWrappedPartialFuncApps: true, removeForceDelay: true },
    noSimplify: { groupApplications: true, inlineSingleUse: true, simplifyWrappedPartialFuncApps: false, removeForceDelay: true },
};

import { parseUPLC, UPLCConst, Application } from "@harmoniclabs/uplc";
import { Machine, CEKError } from "@harmoniclabs/plutus-machine";
import { DataConstr, DataI, DataB, DataMap, DataList, DataPair } from "@harmoniclabs/plutus-data";
import { fromHex } from "@harmoniclabs/uint8array-utils";

const ref = new DataConstr( 0, [ new DataB( fromHex("aa".repeat(32)) ), new DataI( 0 ) ] );
const addr = new DataConstr( 0, [ new DataConstr( 1, [ new DataB( fromHex("cc".repeat(28)) ) ] ), new DataConstr( 1, [] ) ]);
const lovelaces = ( n ) => new DataMap([ new DataPair( new DataB( new Uint8Array(0) ), new DataMap([ new DataPair( new DataB( new Uint8Array(0) ), new DataI( n ) ) ]) ) ]);
const txOut = ( v ) => new DataConstr( 0, [ addr, v, new DataConstr(0,[]), new DataConstr(1,[]) ] );
const txIn = new DataConstr( 0, [ ref, txOut( lovelaces( 2_000_000 ) ) ] );
const tx = new DataConstr( 0, [
    new DataList([ txIn ]), new DataList([]), new DataList([ txOut( lovelaces( 3_000_000 ) ) ]),
    new DataI(0), new DataMap([]), new DataList([]), new DataMap([]), new DataI(0),
    new DataList([]), new DataMap([]), new DataMap([]), new DataB( fromHex("dd".repeat(32)) ),
    new DataMap([]), new DataList([]), new DataConstr(1,[]), new DataConstr(1,[]),
]);
const ctx = new DataConstr( 0, [ tx, new DataConstr(0,[]), new DataConstr( 1, [ ref, new DataConstr( 0, [ new DataConstr(0,[new DataI(1)]) ] ) ] ) ]);

for( const [name, opts] of Object.entries( variants ) ) {
    const ioApi = createMemoryCompilerIoApi({ sources: new Map([ [ "main.pebble", fromUtf8( SRC ) ] ]), useConsoleAsOutput: true });
    const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION, uplcOptimizations: opts } );
    await c.compile({ entry: "main.pebble", root: "/" });
    const out = ioApi.outputs.get("out/out.flat");
    const applied = new Application( parseUPLC( out ).body, UPLCConst.data( ctx ) );
    const r = Machine.evalSimple( applied );
    console.log( name.padEnd(12), r instanceof CEKError ? "ERROR: " + String(r.msg ?? "").slice(0,60) : "ACCEPT" );
}
