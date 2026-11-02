import * as path from "node:path";
import * as fsp from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * Copies the compiled `<outDir>/out.flat` to `output`, and its source map
 * `out.flat.map` (when the compiler wrote one) to `<output>.map`.
 */
export async function copyOutput( root: string, outDir: string, output: string ): Promise<void>
{
	const generated = path.resolve( root, outDir, "out.flat" );
	const target = path.isAbsolute( output ) ? output : path.resolve( root, output );
	await fsp.mkdir( path.dirname( target ), { recursive: true } );
	await fsp.copyFile( generated, target );
	if( existsSync( generated + ".map" ) ) await fsp.copyFile( generated + ".map", target + ".map" );
}
