// `pebble compile` and `pebble export` on projects with errors and warnings. Needs `dist` built
// (`npm run build:no-gen`), with the compiler it should test in node_modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname( fileURLToPath( import.meta.url ) );
const cli = join( here, "..", "dist", "index.js" );

/** a project in a new directory, with `source` as its `src/index.pebble` */
function project( source )
{
    const dir = mkdtempSync( join( tmpdir(), "pebble-compile-" ) );
    mkdirSync( join( dir, "src" ) );
    writeFileSync( join( dir, "src", "index.pebble" ), source );
    writeFileSync( join( dir, "pebble.config.json" ), JSON.stringify({
        entry: "./src/index.pebble",
        outDir: "./out",
        compilerVersion: ">=0.6.0",
    }));
    return dir;
}

function pebble( cwd, args )
{
    const r = spawnSync( process.execPath, [ cli, ...args ], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "0" },
        timeout: 120_000,
    });
    return { out: r.stdout.replace( /\r\n/g, "\n" ), err: r.stderr.replace( /\r\n/g, "\n" ), code: r.status };
}

const withTypeError = `
function f( x: int ): int { return x; }
contract C {
    spend s() {
        const bad: int = #00;
    }
}
`;

for( const args of [ [ "compile" ], [ "export", "--function-name", "f" ] ] )
test( `pebble ${args[0]} with a type error: the error once, how many, exit code 1, no stack`, () => {
    const dir = project( withTypeError );
    try {
        const { out, err, code } = pebble( dir, args );
        assert.equal( out.split( "\n" ).filter( l => l.startsWith( "ERROR 2322" ) ).length, 1, out );
        assert.equal( err.trim(), "compilation failed: 1 error" );
        assert.equal( code, 1 );
        assert.ok( !existsSync( join( dir, "out", "out.flat" ) ) );
    }
    finally { rmSync( dir, { recursive: true, force: true } ); }
});

test( "pebble compile with a warning only: shows it and compiles", () => {
    const dir = project(`
function check( x: int ): int { assert x > 0; return x; }
contract C {
    spend s() {
        const ok = check( 1 );
    }
}
`);
    try {
        const { out, err, code } = pebble( dir, [ "compile" ] );
        assert.ok( out.includes( "WARNING 6133" ), out );
        assert.equal( code, 0, err );
        assert.ok( existsSync( join( dir, "out", "out.flat" ) ) );
    }
    finally { rmSync( dir, { recursive: true, force: true } ); }
});

test( "npm run build removes dist only once the dependencies are installed", () => {
    // `rm -rf ./dist && npm i && ...` left no dist when `npm i` failed (a compiler not on npm yet)
    const { scripts } = JSON.parse( readFileSync( join( here, "..", "package.json" ), "utf8" ) );
    const steps = scripts.build.split( "&&" ).map( s => s.trim() );
    assert.ok( steps.indexOf( "npm i" ) >= 0 && steps.indexOf( "npm i" ) < steps.indexOf( "rm -rf ./dist" ), scripts.build );
});
