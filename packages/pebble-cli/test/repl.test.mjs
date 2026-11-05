// `pebble repl` driven through piped input, the way CI runs it on every OS. Needs `dist`
// built (`npm run build:no-gen`), with the compiler it should test in node_modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname( fileURLToPath( import.meta.url ) );
const cli = join( here, "..", "dist", "index.js" );
const repo = join( here, "..", "..", ".." );
const cape = join( repo, "examples", "uplc-cape" );

function repl( cwd, lines, args = [] )
{
    const r = spawnSync( process.execPath, [ cli, "repl", ...args ], {
        cwd,
        input: lines.join( "\n" ) + "\n",
        encoding: "utf8",
        // no history file, no colors (CI may force them)
        env: { ...process.env, PEBBLE_REPL_HISTORY: "", FORCE_COLOR: "0" },
        timeout: 120_000,
    });
    return { out: r.stdout.replace( /\r\n/g, "\n" ), err: r.stderr, code: r.status };
}

/** the sessions a README shows: `text` blocks with `pebble>` lines, from the first prompt on */
function readmeSessions( file )
{
    const md = readFileSync( file, "utf8" ).replace( /\r\n/g, "\n" );
    return [ ...md.matchAll( /```text\n([\s\S]*?)```/g ) ]
        .map( m => m[1] )
        .filter( block => block.includes( "pebble> " ) )
        .map( block => {
            const lines = block.split( "\n" );
            return lines.slice( lines.findIndex( l => l.startsWith( "pebble> " ) ) ).join( "\n" );
        });
}

// costs change with the compiler's optimizations; the values may not
const normalize = s => s.replace( /cpu: \d+ \| mem: \d+/g, "cpu: N | mem: N" ).trimEnd();

for( const readme of [ join( repo, "README.md" ), join( cape, "README.md" ) ] )
test( `the session in ${relative( repo, readme )} gives the output shown`, () => {
    const sessions = readmeSessions( readme );
    assert.ok( sessions.length > 0, "no session found" );
    for( const session of sessions )
    {
        const inputs = session.split( "\n" ).filter( l => l.startsWith( "pebble> " ) ).map( l => l.slice( "pebble> ".length ) );
        const { out, err, code } = repl( cape, inputs );
        assert.equal( normalize( out ), normalize( session ), err );
        assert.equal( code, 0 );
    }
});

test( "a failing line: its error points at what was typed, the next lines run, the exit code is 1", () => {
    const { out, code } = repl( cape, [ "const a: int = #ff;", "1 + 1" ] );
    assert.ok( out.includes(
        "error: Type 'bytes' is not assignable to type 'int'.\n" +
        "  1 | const a: int = #ff;\n" +
        "    |                ^^^\n"
    ), out );
    assert.ok( out.includes( "pebble> 1 + 1\n2\n" ), out );
    assert.equal( code, 1 );
});

test( "a multi-line input, a loop changing a let, an endless loop stopped by the budget", () => {
    const { out, code } = repl( cape, [
        "function double( x: int ): int {",
        "    return x * 2;",
        "}",
        "let total = 0;",
        "for( const x of [ 1, 2, 3 ] ) { total += double( x ); }",
        "total",
        "while( true ) { total += 1; }",
        "total",
    ]);
    assert.ok( out.includes( "pebble> function double( x: int ): int {\n  ...>     return x * 2;\n  ...> }\n" ), out );
    assert.ok( out.includes( "pebble> total\n12\n" ), out );
    assert.ok( out.includes( "error: out of budget" ), out );
    // the failed line changed nothing
    assert.ok( out.trimEnd().endsWith( "pebble> total\n12\ncpu: " + out.trimEnd().split( "cpu: " ).pop() ), out );
    assert.equal( code, 1 );
});

test( "commands", () => {
    const { out, code } = repl( cape, [ ":help", "const a = 1;", ":list", ":reset", ":list", ":quit", "this line is never read" ] );
    assert.ok( out.includes( "Each line runs as one program" ), out );
    assert.ok( out.includes( "1 | const a = 1;" ), out );
    assert.ok( out.includes( "no declarations" ), out );
    assert.ok( !out.includes( "never read" ), out );
    assert.equal( code, 0 );

    const unknown = repl( cape, [ ":nope" ] );
    assert.ok( unknown.out.includes( "unknown command :nope" ) );
    assert.equal( unknown.code, 1 );
});

test( "started in a subdirectory: imports resolve from it, the project is found above it", () => {
    const { out, code } = repl( join( cape, "src" ), [ "import { factorial } from \"./factorial.pebble\";", "factorial(4)" ] );
    assert.ok( out.includes( "pebble> factorial(4)\n24\n" ), out );
    assert.equal( code, 0 );
});

test( "--config names the project", () => {
    const elsewhere = mkdtempSync( join( tmpdir(), "pebble-repl-" ) );
    try {
        const { out, code } = repl( elsewhere, [ "import { factorial } from \"./src/factorial.pebble\";", "factorial(3)" ], [ "--config", join( cape, "pebble.config.json" ) ] );
        assert.ok( out.includes( "pebble> factorial(3)\n6\n" ), out );
        assert.equal( code, 0 );
    }
    finally { rmSync( elsewhere, { recursive: true, force: true } ); }
});

/** every file under `dir`, with its size and modification time */
function listing( dir )
{
    const files = {};
    const walk = d => {
        for( const name of readdirSync( d ) )
        {
            const full = join( d, name );
            const st = statSync( full );
            if( st.isDirectory() ) walk( full );
            else files[ relative( dir, full ) ] = `${st.size}@${st.mtimeMs}`;
        }
    };
    walk( dir );
    return files;
}

test( "the REPL writes nothing in the project", () => {
    const dir = mkdtempSync( join( tmpdir(), "pebble-repl-" ) );
    try {
        cpSync( cape, dir, { recursive: true } );
        const before = listing( dir );
        const { code } = repl( dir, [ "import { factorial } from \"./src/factorial.pebble\";", "factorial(3)", "const k = 2;", "function f(): int { return k; }" ] );
        assert.equal( code, 0 );
        assert.deepEqual( listing( dir ), before );
    }
    finally { rmSync( dir, { recursive: true, force: true } ); }
});

test( "an interactive session keeps its history in PEBBLE_REPL_HISTORY", {
    // a terminal is needed: util-linux `script` gives one
    skip: process.platform !== "linux" && "needs util-linux `script` for a terminal",
}, () => {
    const dir = mkdtempSync( join( tmpdir(), "pebble-history-" ) );
    const file = join( dir, "history" );
    try {
        const r = spawnSync( "script", [ "-qec", `"${process.execPath}" "${cli}" repl`, "/dev/null" ], {
            cwd: cape,
            input: "1 + 1\r2 + 2\r:quit\r",
            encoding: "utf8",
            env: { ...process.env, PEBBLE_REPL_HISTORY: file, FORCE_COLOR: "0" },
            timeout: 120_000,
        });
        assert.equal( r.status, 0, r.stdout + r.stderr );
        assert.deepEqual( readFileSync( file, "utf8" ).split( "\n" ).filter( l => l.length > 0 ), [ "1 + 1", "2 + 2", ":quit" ] );
    }
    finally { rmSync( dir, { recursive: true, force: true } ); }
});
