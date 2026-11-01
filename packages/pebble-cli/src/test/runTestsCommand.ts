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
    /** emit machine-readable JSON results instead of the human report */
    json?: boolean;
    /** stop running after the first failing test file */
    bail?: boolean;
}

export async function runTestsCommand(
    target: string | undefined,
    flags: CliTestFlags
): Promise<void>
{
    const root = normalizeRoot();

    // load pebble.config.json if present, otherwise use defaults
    const configPath = path.resolve( root, flags.config ?? "./pebble.config.json" );
    // compilerVersion is intentionally not set here — it must come from the
    // user's pebble.config.json. If missing/invalid, the Compiler throws.
    let baseConfig: CompilerOptions = productionOptions as CompilerOptions;
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
        if( flags.bail === true && process.exitCode === 1 ) break;

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
            // A file that fails to compile yields NO test descriptors, so
            // `test()` returns `[]` without throwing. Previously that made the
            // compile error vanish and the run report "0 total". Surface the
            // compile diagnostics instead. (Errors render as `ERROR ...`.)
            const errorDiags = compiler.diagnostics.filter(
                d => String( d ).startsWith( "ERROR" )
            );
            if( errorDiags.length > 0 )
            {
                process.stderr.write(
                    `compile error in ${path.relative( root, file )}:\n`
                );
                for( const d of errorDiags )
                    process.stderr.write( "  " + String( d ) + "\n" );
                process.exitCode = 1;
            }
            if( results.length > 0 ) resultsByFile.set( file, results );
            if( flags.bail === true && results.some( r => !r.passed ) )
            {
                process.exitCode = 1;
                break;
            }
        } catch ( err ) {
            process.stderr.write(
                `error running tests in ${path.relative( root, file )}: ${err instanceof Error ? err.message : String( err )}\n`
            );
            process.exitCode = 1;
        }
    }

    if( flags.json === true )
    {
        const { summary } = formatTestResults( resultsByFile, root );
        const payload = {
            summary,
            files: Array.from( resultsByFile.entries() ).map( ([ file, results ]) => ({
                file: path.relative( root, file ),
                tests: results.map( r => ({
                    name: r.name,
                    kind: r.kind,
                    passed: r.passed,
                    skippedReason: r.skippedReason,
                    seed: r.seed,
                    shrinkSteps: r.shrinkSteps,
                    totalBudget: { cpu: r.totalBudget.cpu.toString(), mem: r.totalBudget.mem.toString() },
                    iterations: r.iterations.map( it => ({
                        passed: it.passed,
                        budgetSpent: { cpu: it.budgetSpent.cpu.toString(), mem: it.budgetSpent.mem.toString() },
                        logs: it.logs,
                        error: it.error?.msg,
                        inputs: it.inputs?.map( i => ({
                            name: i.name,
                            value: _jsonInputValue( i.value )
                        }))
                    }))
                }))
            }))
        };
        process.stdout.write( JSON.stringify( payload, undefined, 2 ) + "\n" );
        if( summary.failed > 0 ) process.exitCode = 1;
        return;
    }

    const { text, summary } = formatTestResults( resultsByFile, root );
    process.stdout.write( text + "\n" );

    if( summary.failed > 0 ) process.exitCode = 1;
}

function _jsonInputValue( v: unknown ): string
{
    if( typeof v === "bigint" ) return v.toString();
    if( typeof v === "boolean" ) return v ? "true" : "false";
    if( v instanceof Uint8Array ) return "#" + Array.from( v ).map( b => b.toString( 16 ).padStart( 2, "0" ) ).join( "" );
    return String( v );
}
