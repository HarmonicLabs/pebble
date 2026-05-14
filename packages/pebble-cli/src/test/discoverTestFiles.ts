import * as path from "node:path";
import * as fsp from "node:fs/promises";
import { existsSync, statSync } from "node:fs";

/**
 * Discover `.pebble` files to feed into `Compiler.test()`.
 *
 * @param target  Either a directory to walk recursively, or a single `.pebble`
 *                file path. If omitted, walks `cwd`.
 * @param testPathPattern  Optional regex filter over workspace-relative paths.
 * @returns absolute paths of matching `.pebble` files.
 */
export async function discoverTestFiles(
    target: string | undefined,
    testPathPattern: RegExp | undefined,
    cwd: string = process.cwd()
): Promise<string[]>
{
    const resolved = path.resolve( cwd, target ?? "." );

    if( !existsSync( resolved ) ) return [];

    const stat = statSync( resolved );
    const files: string[] = [];

    if( stat.isFile() )
    {
        if( resolved.endsWith( ".pebble" ) ) files.push( resolved );
    }
    else if( stat.isDirectory() )
    {
        await _walk( resolved, files );
    }

    if( testPathPattern )
    {
        return files.filter( f => testPathPattern.test( path.relative( cwd, f ) ) );
    }
    return files;
}

async function _walk( dir: string, out: string[] ): Promise<void>
{
    let entries: import("node:fs").Dirent[];
    try {
        entries = await fsp.readdir( dir, { withFileTypes: true } );
    } catch {
        return;
    }
    for( const e of entries )
    {
        if( e.name === "node_modules" || e.name.startsWith(".") ) continue;
        const full = path.join( dir, e.name );
        if( e.isDirectory() ) await _walk( full, out );
        else if( e.isFile() && e.name.endsWith( ".pebble" ) ) out.push( full );
    }
}
