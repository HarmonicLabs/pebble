import * as readline from "node:readline";
import * as path from "node:path";
import * as os from "node:os";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import chalk from "chalk";
import {
    COMPILER_VERSION,
    CompilerIoApi,
    DEFAULT_REPL_BUDGET,
    isIncompleteInput,
    ReplDiagnostic,
    ReplFailure,
    ReplPosition,
    ReplResult,
    ReplSession,
    ReplTestResult,
    semverSatisfies,
} from "@harmoniclabs/pebble";
import { createFsIo } from "../utils/crateFsIo";
import { loadProjectConfig } from "../utils/loadProjectConfig";

export interface ReplFlags {
    /** the project's config; default: the nearest `pebble.config.json` up from the working directory */
    config?: string;
}

const PROMPT = "pebble> ";
const CONTINUE_PROMPT = "  ...> ";
const BUFFER_NAME = "__repl__.pebble";

/** the directory of the nearest `pebble.config.json`, from `dir` up */
export function findProjectRoot( dir: string ): string | undefined
{
    dir = path.resolve( dir );
    while( true )
    {
        if( existsSync( path.join( dir, "pebble.config.json" ) ) ) return dir;
        const parent = path.dirname( dir );
        if( parent === dir ) return undefined;
        dir = parent;
    }
}

/**
 * The project's files, read only. The compiler asks for project paths (`/src/a.pebble`, from
 * the root); an existing absolute path is read as it is.
 */
function projectIo( root: string ): CompilerIoApi
{
    const fsIo = createFsIo( root );
    const onDisk = ( f: string ) => path.isAbsolute( f ) && existsSync( f ) ? f : path.join( root, f.replace( /^[\\/]+/, "" ) );
    return {
        ...fsIo,
        readFile: f => fsIo.readFile( onDisk( f ), root ),
        exsistSync: f => existsSync( onDisk( f ) ),
        listFiles: d => fsIo.listFiles( onDisk( d ), root ),
        writeFile: () => {},
    };
}

function historyFile(): string | undefined
{
    const env = process.env.PEBBLE_REPL_HISTORY;
    if( env !== undefined ) return env.trim().length > 0 ? env : undefined;
    return path.join( os.homedir(), ".pebble_repl_history" );
}

function loadHistory( file: string | undefined ): string[]
{
    if( file === undefined ) return [];
    try { return readFileSync( file, "utf8" ).split( "\n" ).filter( l => l.length > 0 ).slice( -1000 ).reverse(); }
    catch { return []; }
}

export async function pebbleRepl( flags: ReplFlags = {} ): Promise<void>
{
    const cwd = process.cwd();
    const configPath = flags.config === undefined ? undefined : path.resolve( cwd, flags.config );
    const root = configPath !== undefined ? path.dirname( configPath ) : ( findProjectRoot( cwd ) ?? cwd );
    const config = loadProjectConfig( root, configPath === undefined ? undefined : path.basename( configPath ) );
    const hasConfig = existsSync( configPath ?? path.join( root, "pebble.config.json" ) );

    // the session's source sits in the working directory: relative imports resolve from there
    const fromRoot = path.relative( root, cwd ).split( path.sep ).filter( s => s.length > 0 );
    const bufferPath = "/" + [ ...( fromRoot[0] === ".." ? [] : fromRoot ), BUFFER_NAME ].join( "/" );

    const session = new ReplSession({ io: projectIo( root ), config, root, bufferPath });

    const interactive = process.stdin.isTTY === true;
    const history = interactive ? historyFile() : undefined;
    // newest first, as readline keeps it; its `history` event gives each change
    let historyLines: readonly string[] = loadHistory( history );
    const rl = readline.createInterface({
        input: process.stdin,
        output: interactive ? process.stdout : undefined,
        terminal: interactive,
        history: historyLines.slice(),
        historySize: 1000,
        removeHistoryDuplicates: true,
    } as readline.ReadLineOptions );
    rl.on( "history", ( lines: string[] ) => { historyLines = lines; });

    if( interactive )
    {
        console.log( chalk.bold( `Pebble REPL ${COMPILER_VERSION}` ) + chalk.dim( hasConfig ? `, project ${root}` : "" ) );
        console.log( chalk.dim( "Type :help for help." ) );
    }
    if( hasConfig && typeof config.compilerVersion === "string" && !semverSatisfies( COMPILER_VERSION, config.compilerVersion ) )
    console.log( chalk.yellow( `warning: pebble.config.json asks for compiler ${config.compilerVersion}; this is ${COMPILER_VERSION}` ) );

    // lines in order, whether typed or piped: a pipe delivers them before they are asked for
    const CANCEL = Symbol( "cancel" );
    type Line = string | undefined | typeof CANCEL;
    const queue: string[] = [];
    let waiter: (( line: Line ) => void) | undefined = undefined;
    let closed = false;
    const deliver = ( line: Line ) => { const w = waiter; waiter = undefined; w?.( line ); };
    rl.on( "line", line => { if( waiter !== undefined ) deliver( line ); else queue.push( line ); });
    rl.on( "close", () => { closed = true; deliver( undefined ); });

    let interruptedOnce = false;
    let pending = false;
    rl.on( "SIGINT", () => {
        const hadInput = pending || rl.line.length > 0;
        // drop what was typed (it stays on screen, as in node's REPL)
        ( rl as any ).line = "";
        ( rl as any ).cursor = 0;
        if( !hadInput )
        {
            if( interruptedOnce ) { rl.close(); return; }
            interruptedOnce = true;
            process.stdout.write( "\n" + chalk.dim( "(to exit, press Ctrl+C again or Ctrl+D, or type :quit)" ) );
        }
        process.stdout.write( "\n" );
        deliver( CANCEL );
    });

    const readLine = ( prompt: string ): Promise<Line> => {
        if( queue.length === 0 && !closed && interactive ) { rl.setPrompt( chalk.blue( prompt ) ); rl.prompt(); }
        const line: Promise<Line> = (
            queue.length > 0 ? Promise.resolve( queue.shift() ) :
            closed ? Promise.resolve( undefined ) :
            new Promise<Line>( resolve => { waiter = resolve; } )
        );
        // piped: show the line, so the output reads as a session
        return line.then( l => { if( !interactive && typeof l === "string" ) process.stdout.write( prompt + l + "\n" ); return l; });
    };

    let failed = false;
    loop: while( true )
    {
        pending = false;
        const first = await readLine( PROMPT );
        if( first === undefined ) break;
        if( first === CANCEL ) continue;
        interruptedOnce = false;

        const trimmed = first.trim();
        if( trimmed.length === 0 ) continue;
        if( trimmed.startsWith( ":" ) && !trimmed.startsWith( "::" ) )
        {
            switch( trimmed.split( /\s+/ )[0] )
            {
                case ":quit": case ":q": case ":exit": break loop;
                case ":help": printHelp( root, cwd, hasConfig ); continue;
                case ":reset": session.reset(); console.log( chalk.dim( "the session is empty" ) ); continue;
                case ":list": printList( session ); continue;
                default:
                    console.log( chalk.red( "error" ) + `: unknown command ${trimmed.split( /\s+/ )[0]}; :help lists them` );
                    failed = true;
                    continue;
            }
        }

        let input = first;
        pending = true;
        let cancelled = false;
        while( isIncompleteInput( input ) )
        {
            const next = await readLine( CONTINUE_PROMPT );
            // at the end of the input, what there is goes to the compiler, which says what is missing
            if( next === undefined ) break;
            if( next === CANCEL ) { cancelled = true; break; }
            input += "\n" + next;
        }
        pending = false;
        if( cancelled ) continue;

        const result = await session.eval( input );
        printResult( result );
        if( !result.ok || result.tests.some( t => !t.passed ) ) failed = true;
    }

    if( history !== undefined )
    {
        try { writeFileSync( history, historyLines.slice().reverse().join( "\n" ) + "\n" ); }
        catch { /* a history is a convenience */ }
    }
    rl.close();
    if( interactive ) process.stdout.write( "\n" );
    // piped: a failing line fails the run, so a script of lines can check a project
    else if( failed ) process.exitCode = 1;
}

function printHelp( root: string, cwd: string, hasConfig: boolean ): void
{
    const n = ( x: bigint ) => x.toLocaleString( "en-US" );
    console.log([
        "Each line runs as one program: your declarations so far, then the line.",
        "",
        "  expressions    1 + 2, factorial( 5 )        shows the value and what it cost",
        "  declarations   const, let, function, struct, import, contract",
        "                                              kept for the lines after",
        "  statements     if, for, while, trace, assert, fail, x = ...",
        "                                              run; what they change in a let is kept",
        "  tests          test name() { ... }          runs at once, is not kept",
        "  contracts      contract C { ... }           type-checked; methods run under `pebble test`",
        "",
        "  Functions, contracts and tests can use constants and other declarations, not lets.",
        "",
        "  :help     this help",
        "  :list     the declarations kept",
        "  :reset    forget them",
        "  :quit     exit (also Ctrl+D, or Ctrl+C twice)",
        "",
        `Imports resolve from ${cwd}` + ( hasConfig ? `; the project is ${root}.` : "." ),
        `A line can spend ${n( DEFAULT_REPL_BUDGET.cpu )} cpu and ${n( DEFAULT_REPL_BUDGET.mem )} mem, a mainnet transaction's limit.`,
    ].join( "\n" ) );
}

function printList( session: ReplSession ): void
{
    const decls = session.declarations;
    if( decls.length === 0 ) { console.log( chalk.dim( "no declarations" ) ); return; }
    const width = String( decls[ decls.length - 1 ].line ).length;
    for( const d of decls )
    {
        const lines = d.text.split( "\n" );
        console.log( chalk.dim( String( d.line ).padStart( width ) + " | " ) + lines[0] );
        for( const l of lines.slice( 1 ) ) console.log( chalk.dim( " ".repeat( width ) + " | " ) + l );
    }
}

function printResult( r: ReplResult ): void
{
    for( const log of r.logs ) console.log( chalk.magenta( "trace:" ), log );
    for( const d of r.diagnostics ) printDiagnostic( d );
    if( r.failure !== undefined ) printFailure( r.failure );
    if( r.value !== undefined ) console.log( colorValue( r.value.text, r.value.node.kind ) );
    for( const c of r.contracts ) console.log( chalk.dim( `contract ${c}: type-checked; its methods run under \`pebble test\`` ) );
    for( const t of r.tests ) printTest( t );
    // a declaration is quiet; what runs shows its cost
    if( r.budget !== undefined && ( r.value !== undefined || r.failure !== undefined || r.declared.length === 0 ) )
    console.log( chalk.dim( `cpu: ${r.budget.cpu} | mem: ${r.budget.mem}` ) );
}

function colorValue( text: string, kind: string ): string
{
    switch( kind )
    {
        case "int": return chalk.yellow( text );
        case "bool": return chalk.blue( text );
        case "bytes": return chalk.cyan( text );
        case "string": return chalk.green( text );
        default: return text;
    }
}

function printDiagnostic( d: ReplDiagnostic ): void
{
    const label = d.category === "error" ? chalk.red( "error" ) : d.category === "warning" ? chalk.yellow( "warning" ) : chalk.blue( "info" );
    console.log( `${label}: ${d.message}` );
    if( d.position !== undefined ) printPosition( d.position );
    if( d.note !== undefined ) console.log( chalk.dim( "  note: " ) + d.note );
}

function printFailure( f: ReplFailure ): void
{
    const message = f.outOfBudget
        ? `out of budget: a line can spend ${DEFAULT_REPL_BUDGET.cpu.toLocaleString( "en-US" )} cpu and ${DEFAULT_REPL_BUDGET.mem.toLocaleString( "en-US" )} mem`
        : f.message;
    console.log( `${chalk.red( "error" )}: ${message}` );
    if( f.position !== undefined ) printPosition( f.position );
    for( const frame of f.stack )
    {
        if( frame.name === undefined ) continue;
        const where = frame.position === undefined ? "" : " " + chalk.dim( describePosition( frame.position ) );
        console.log( `  in ${frame.name}${where}` );
    }
}

function printTest( t: ReplTestResult ): void
{
    const runs = t.kind === "property" ? chalk.dim( ` (${t.runs} runs)` ) : "";
    const cost = chalk.dim( `  [cpu: ${t.budget.cpu}, mem: ${t.budget.mem}]` );
    if( t.skippedReason !== undefined ) { console.log( `${chalk.yellow( "SKIP" )} ${t.name}: ${t.skippedReason}` ); return; }
    if( t.passed ) { console.log( `${chalk.green( "PASS" )} ${t.name}${runs}${cost}` ); return; }
    console.log( `${chalk.red( "FAIL" )} ${t.name}${runs}${cost}` );
    for( const log of t.logs ) console.log( chalk.magenta( "  trace:" ), log );
    if( t.inputs !== undefined && t.inputs.length > 0 ) console.log( `  with ${t.inputs.join( ", " )}` );
    if( t.message !== undefined ) console.log( `  ${chalk.red( "error" )}: ${t.message}` );
    if( t.position !== undefined ) printPosition( t.position );
}

/** where a position is, in words */
function describePosition( p: ReplPosition ): string
{
    if( p.in === "file" ) return `at ${p.path}:${p.line}:${p.column}`;
    if( p.in === "session" ) return `entered on line ${p.sessionLine}`;
    return `at ${p.line}:${p.column}`;
}

/** the line of text with the position underlined */
function printPosition( p: ReplPosition ): void
{
    if( p.in !== "input" ) console.log( chalk.dim( "  " + describePosition( p ) ) );
    if( p.lineText.length === 0 ) return;
    const gutter = String( p.line );
    console.log( chalk.dim( `  ${gutter} | ` ) + p.lineText );
    console.log( chalk.dim( `  ${" ".repeat( gutter.length )} | ` ) + " ".repeat( p.column - 1 ) + chalk.red( "^".repeat( Math.max( 1, p.length ) ) ) );
}
