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
import { runTestsCommand } from "./test/runTestsCommand";
import { debugCommand } from "./debug/debugCommand";

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
    .option("--canonical", "Emit spec-compliant UPLC concrete syntax (parseable by plutus-core) instead of the richer pebble format")
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

program.command("test [path]")
    .description("Discover and run `test name() { ... }` blocks under [path] (default: current directory). Reports execution costs (cpu/mem) for each test. Property tests (params present) sample N iterations.")
    .option("-c, --config <string>", "The config file path", "./pebble.config.json")
    .option("--testPathPattern <regex>", "Run tests only in files whose path matches this regex")
    .option("-t, --testNamePattern <regex>", "Run only tests whose name matches this regex")
    .option("--property-runs <n>", "Number of iterations per property test (default 100)")
    .option("--seed <int>", "Seed for the property-test PRNG (default 0)")
    .option("--json", "Emit machine-readable JSON results on stdout instead of the human report")
    .option("--bail", "Stop running after the first failing test file")
    .action( async ( target, opts ) => {
        await runTestsCommand( target, {
            config: opts.config,
            testPathPattern: opts.testPathPattern,
            testNamePattern: opts.testNamePattern,
            propertyRuns: opts.propertyRuns,
            seed: opts.seed,
            json: opts.json === true,
            bail: opts.bail === true,
        });
    });

program.command("debug [path]")
    .description("Run one evaluation and print it statement by statement, in source order, with the values of the variables: a test (--test) or a script evaluation buildooor saved (--eval). Exits 0 whenever the evaluation could be shown, passed or failed.")
    .option("-c, --config <string>", "The config file path", "./pebble.config.json")
    .option("--test <name>", "Debug the test with this name (or part of it), among the tests of [path] (default: the current directory)")
    .option("--eval <file>", "Replay a saved script evaluation (buildooor's `saveFailedEvaluations`) against this project's program")
    .option("--step <n>", "Print step n in full: the open calls and every variable in scope with its whole value")
    .option("--all", "List the variables in scope at every step")
    .option("--json", "Emit the steps, variables and result as JSON on stdout")
    .option("--max-states <n>", "Record at most n machine states (default 2000000)")
    .option("--property-runs <n>", "Iterations of a property test to look for a failure in (default 100)")
    .option("--seed <int>", "Seed for the property-test PRNG (default 0)")
    .action( async ( target, opts ) => {
        await debugCommand( target, {
            config: opts.config,
            test: opts.test,
            eval: opts.eval,
            step: opts.step,
            all: opts.all === true,
            json: opts.json === true,
            maxStates: opts.maxStates,
            propertyRuns: opts.propertyRuns,
            seed: opts.seed,
        });
    });

program.parse();