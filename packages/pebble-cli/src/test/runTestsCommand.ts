import * as path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { Compiler, CompilerOptions, productionOptions, TestResult } from "@harmoniclabs/pebble";
import { createFsIo } from "../utils/crateFsIo";
import { normalizeRoot, isRecord } from "../utils/miscellaneous";
import { discoverTestFiles } from "./discoverTestFiles";
import { formatTestResults } from "./formatTestResults";

export interface CliTestFlags {
    config?: string;
    testPathPattern?: string;
    testNamePattern?: string;
    propertyRuns?: string;
    seed?: string;
}

export async function runTestsCommand(
    target: string | undefined,
    flags: CliTestFlags
): Promise<void>
{
    const root = normalizeRoot();

    // load pebble.config.json if present, otherwise use defaults
    const configPath = path.resolve( root, flags.config ?? "./pebble.config.json" );
    let baseConfig: CompilerOptions = productionOptions;
    if( existsSync( configPath ) )
    {
        try {
            const txt = readFileSync( configPath, "utf8" );
            const parsed = JSON.parse( txt );
            if( isRecord( parsed ) ) baseConfig = {
                ...productionOptions,
                ...parsed,
                uplcOptimizations: {
                    ...productionOptions.uplcOptimizations,
                    ...(parsed.uplcOptimizations as any)
                }
            } as CompilerOptions;
        } catch {
            // ignore malformed config
        }
    }

    const testPathPattern = flags.testPathPattern ? new RegExp( flags.testPathPattern ) : undefined;
    const nameFilter = flags.testNamePattern ? new RegExp( flags.testNamePattern ) : undefined;
    const propertyIterations = flags.propertyRuns !== undefined ? Math.max( 1, Number( flags.propertyRuns ) | 0 ) : undefined;
    const seed = flags.seed !== undefined ? ( Number( flags.seed ) | 0 ) : undefined;

    const files = await discoverTestFiles( target, testPathPattern, root );

    if( files.length === 0 )
    {
        process.stdout.write( "no .pebble test files found\n" );
        return;
    }

    const io = createFsIo( root );
    const resultsByFile = new Map<string, TestResult[]>();

    for( const file of files )
    {
        const compiler = new Compiler( io, {
            ...baseConfig,
            root,
            entry: file,
            silent: true,
        });

        try {
            const results = await compiler.test({
                nameFilter,
                propertyIterations,
                seed,
            });
            if( results.length > 0 ) resultsByFile.set( file, results );
        } catch ( err ) {
            process.stderr.write(
                `error running tests in ${path.relative( root, file )}: ${err instanceof Error ? err.message : String( err )}\n`
            );
            process.exitCode = 1;
        }
    }

    const { text, summary } = formatTestResults( resultsByFile, root );
    process.stdout.write( text + "\n" );

    if( summary.failed > 0 ) process.exitCode = 1;
}
