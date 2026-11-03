import * as path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
    Compiler,
    DebugRun,
    debugRunToJson,
    formatDebugRun,
    formatDebugStep,
    parseSavedEvaluation,
    savedEvaluationTerm,
    stepJson,
} from "@harmoniclabs/pebble";
import { createFsIo } from "../utils/crateFsIo";
import { normalizeRoot } from "../utils/miscellaneous";
import { loadProjectConfig } from "../utils/loadProjectConfig";
import { discoverTestFiles } from "../test/discoverTestFiles";

export interface CliDebugFlags {
    config?: string;
    /** name of the test to debug (or part of it) */
    test?: string;
    /** a saved script evaluation (buildooor `saveFailedEvaluations`) to replay */
    eval?: string;
    /** 1-based step to print in full */
    step?: string;
    /** variables at every step */
    all?: boolean;
    json?: boolean;
    maxStates?: string;
    propertyRuns?: string;
    seed?: string;
}

/**
 * `pebble debug`: records one evaluation and prints it statement by statement, in source
 * order, with the values of the variables.
 *
 * - `--test <name>` runs a test (of `[path]`, or of the test files under the current directory);
 * - `--eval <file>` replays a script evaluation buildooor saved, against this project's program.
 *
 * Exits with 0 when the evaluation could be shown, whether it passed or failed; with 1 when it
 * could not (no such test, the script is not this project's, a compile error).
 */
export async function debugCommand( target: string | undefined, flags: CliDebugFlags ): Promise<void>
{
    const root = normalizeRoot();
    const baseConfig = loadProjectConfig( root, flags.config );
    const io = createFsIo( root );
    const maxStates = flags.maxStates !== undefined ? Math.max( 1, Number( flags.maxStates ) | 0 ) : undefined;
    const step = flags.step !== undefined ? Number( flags.step ) | 0 : undefined;

    if( ( flags.test === undefined ) === ( flags.eval === undefined ) )
    return fail( "pebble debug: give either --test <name> or --eval <file>" );

    let run: DebugRun;
    let title: string;
    try {
        if( flags.eval !== undefined )
        {
            const file = path.resolve( root, flags.eval );
            if( !existsSync( file ) ) return fail( `pebble debug: no such file ${flags.eval}` );
            const ev = parseSavedEvaluation( readFileSync( file, "utf8" ) );
            const compiler = new Compiler( io, { ...baseConfig, root, silent: true } );
            const result = await compiler.debugScript({
                term: savedEvaluationTerm( ev ),
                version: ev.program.version,
                costModel: ev.costModel as any,
                budget: ev.budget,
                maxStates,
            });
            run = result.run;
            title = [ ev.purpose, ev.index !== undefined ? `#${ev.index}` : undefined, ev.scriptHash ].filter( x => x !== undefined ).join( " " ) || path.basename( file );
        }
        else
        {
            const found = await debugTestIn( target, flags, root, baseConfig, io, maxStates );
            if( typeof found === "string" ) return fail( found );
            run = found.run;
            title = found.title;
        }
    }
    catch( e ) {
        return fail( "pebble debug: " + ( e instanceof Error ? e.message : String( e ) ) );
    }

    if( step !== undefined && ( step < 1 || step > run.steps.length ) )
    return fail( `pebble debug: no step ${step}; the run has ${run.steps.length} steps` );

    if( flags.json === true )
    {
        const json: any = debugRunToJson( run, { root, step, allVariables: flags.all === true } );
        json.title = title;
        if( step !== undefined ) json.selected = stepJson( run, run.steps[ step - 1 ], { root, step } );
        process.stdout.write( JSON.stringify( json, undefined, 2 ) + "\n" );
        return;
    }
    if( step !== undefined )
    {
        process.stdout.write( formatDebugStep( run, step, { root } ) + "\n" );
        return;
    }
    const outcome = run.failedStep >= 0 ? `failed at step ${run.failedStep + 1}` : run.recording.failed ? "failed" : "passed";
    process.stdout.write( `${title}: ${run.steps.length} steps, ${outcome}\n\n` + formatDebugRun( run, { root, allVariables: flags.all === true } ) + "\n" );
}

async function debugTestIn(
    target: string | undefined,
    flags: CliDebugFlags,
    root: string,
    baseConfig: ReturnType<typeof loadProjectConfig>,
    io: ReturnType<typeof createFsIo>,
    maxStates: number | undefined
): Promise<{ run: DebugRun, title: string } | string>
{
    const files = await discoverTestFiles( target, undefined, root );
    if( files.length === 0 ) return "pebble debug: no .pebble files found";
    const name = flags.test!;
    const misses: string[] = [];
    for( const file of files )
    {
        const compiler = new Compiler( io, { ...baseConfig, root, entry: file, silent: true } );
        try {
            const { test, run } = await compiler.debugTest({
                name,
                maxStates,
                propertyIterations: flags.propertyRuns !== undefined ? Math.max( 1, Number( flags.propertyRuns ) | 0 ) : undefined,
                seed: flags.seed !== undefined ? Number( flags.seed ) | 0 : undefined,
            });
            if( run === undefined )
            return `pebble debug: test "${test.name}" could not run: ${test.skippedReason ?? test.iterations[0]?.error?.msg ?? "unknown reason"}`;
            const inputs = test.iterations[ test.iterations.length - 1 ]?.inputs;
            const args = inputs !== undefined && inputs.length > 0
                ? "(" + inputs.map( i => `${i.name} = ${showInput( i.value )}` ).join( ", " ) + ")"
                : "";
            return { run, title: `test ${test.name}${args}  ${path.relative( root, file )}` };
        }
        catch( e ) {
            const msg = e instanceof Error ? e.message : String( e );
            // ambiguous names are an answer; missing ones mean "another file"
            if( !msg.startsWith( "no test named" ) ) return "pebble debug: " + msg;
            misses.push( path.relative( root, file ) );
        }
    }
    return `pebble debug: no test named "${name}" in ${misses.join( ", " )}`;
}

function showInput( v: unknown ): string
{
    if( typeof v === "bigint" ) return v.toString();
    if( v instanceof Uint8Array ) return "#" + Array.from( v ).map( b => b.toString( 16 ).padStart( 2, "0" ) ).join( "" );
    return String( v );
}

function fail( msg: string ): void
{
    process.stderr.write( msg + "\n" );
    process.exitCode = 1;
}
