import { Compiler } from "@harmoniclabs/pebble";

/**
 * For `pebble compile` and `pebble export`, when the compiler throws. A compilation that failed
 * on its diagnostics has printed them: says how many errors there were, without the exception's
 * stack, and exits with 1. Anything else is a compiler crash, printed with its stack.
 */
export function reportCompileFailure( compiler: Compiler, error: unknown ): void
{
	// errors render as `ERROR ...`
	const nErrors = compiler.diagnostics.filter( d => String( d ).startsWith( "ERROR" ) ).length;
	if( nErrors > 0 ) process.stderr.write( `compilation failed: ${nErrors} error${nErrors === 1 ? "" : "s"}\n` );
	else process.stderr.write( ( error instanceof Error ? error.stack ?? error.message : String( error ) ) + "\n" );
	process.exitCode = 1;
}
