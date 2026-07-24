import { Compiler } from "./dist/compiler/Compiler.js";
import { createMemoryCompilerIoApi } from "./dist/compiler/io/CompilerIoApi.js";
import { testOptions, COMPILER_VERSION } from "./dist/IR/toUPLC/CompilerOptions.js";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, prettyUPLC } from "@harmoniclabs/uplc";
import { readFileSync } from "node:fs";

const SRC = readFileSync( "/home/michele/hlabs/packages/plutus/the-cardano-masterpiece/bug-repros/bug22-minimal.pebble", "utf8" );

const ioApi = createMemoryCompilerIoApi({
    sources: new Map([ [ "main.pebble", fromUtf8( SRC ) ] ]),
    useConsoleAsOutput: true,
});
const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
await c.compile({ entry: "main.pebble", root: "/" });
const out = ioApi.outputs.get("out/out.flat");
console.log( prettyUPLC( parseUPLC( out ).body, 2 ) );
