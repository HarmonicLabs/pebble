#!/usr/bin/env node

import { Command } from "commander";
import { PEBBLE_VERSION, PEBBLE_LIB_VERSION, PEBBLE_COMMIT_HASH } from "./version.generated";
import { initPebbleProject } from "./init/initPebbleProject";
import { compilePebbleProject } from "./compile/compilePebbleProject";
import { completeCompileOptions } from "./compile/completeCompileOptions";
import { completeExportOptions } from "./export/completeExportOptions";
import { exportPebbleFunction } from "./export/exportPebbleFunction";
import { prettyPrintUplcFromFile } from "./uplc/pretty/prettyPrintUplcFromFile";
import { pebbleRepl } from "./repl/pebbleRepl";

const program = new Command();

const versionOutput = (
`pebble-cli version:      ${PEBBLE_VERSION}
pebble language version: ${PEBBLE_LIB_VERSION}
commit hash:             ${PEBBLE_COMMIT_HASH}`
)

program
    .name("pebble")
    .description("A simple, yet rock solid, functional language with an imperative bias, targeting UPLC")
    .option("-v, --version", "show version number")
    .action(( opts ) => {
        if( opts.version )
        {
            console.log( versionOutput );
            process.exit(0);
            return;
        }
        program.help();
    });

program.command("help")
    .description("Display help for pebble commands")
    .action(() => {
        program.help();
    });

program.command("version")
    .description("Output the version number")
    .action(() => {
        console.log( versionOutput );
        process.exit(0);
    });

program.command("compile")
    .description("Compiles a pebble project")
    .option("-c, --config <string>", "The config file path", "./pebble.config.json")
    .option("--entry <string>", "The entry file path .pebble file (used only if missing in the configuration)", "./index.pebble")
    .option("-o, --output <string>", "The output file path (used only if missing in the configuration)", "./out.flat")
    .action(async ( opts ) => {
        await compilePebbleProject( completeCompileOptions( opts ) );
    });

program.command("export")
    .description("Compiles and exports a single function from a pebble project")
    .option("--function-name <string>", "The name of the function to export")
    .option("-c, --config <string>", "The config file path", "./pebble.config.json")
    .option("--entry <string>", "The entry file path .pebble file (will overwrite if present in the configuration)")
    .option("-o, --output <string>", "The output file path (will overwrite if present in the configuration)")
    .action( async ( opts ) => {
        await exportPebbleFunction( completeExportOptions( opts ) );
    });

const uplcSubcommand = program.command("uplc")
    .description("Utilities for UPLC programs stored in flat-encoded files");

uplcSubcommand.command("pretty")
    .description("Pretty prints a UPLC program from a flat UPLC file")
    .option("-i, --input <string>", "The input flat-encoded UPLC file path", "./out/out.flat")
    .option("-o, --output <string>", "The output file path (extension: .uplc) (if missing, prints to console)")
    .action( prettyPrintUplcFromFile );

/*
TODO:

uplcSubcommand.command("apply")
    .description("Applies arguments to a UPLC program from a flat-encoded UPLC file")

uplcSubcommand.command("eval")
    .description("Evaluates a UPLC program from a flat-encoded UPLC file")
*/

program.command("init")
    .description("Creates a new directory with a fresh pebble project")
    .action( initPebbleProject );

/*
// TODO
defineVersionManager( program );
//*/

program.command("repl")
    .description("Start an interactive Pebble REPL")
    .action( pebbleRepl );

program.parse();