import * as path from "node:path";
import * as fsp from "node:fs/promises";
import { parseUPLC, prettyUPLC, showUPLC } from "@harmoniclabs/uplc";

export interface CliPrettyUplcFlags {
    input: string;
    output?: string;
    /**
     * emit spec-compliant UPLC concrete syntax (`(constr 0 f1 f2)`,
     * `(case scrut alt1 alt2)`, space-separated — what the plutus-core
     * textual parser accepts) instead of pebble's richer pretty format
     * (bracketed, comma-separated). Use this when the output is consumed
     * by external tooling, e.g. UPLC-CAPE submissions.
     */
    canonical?: boolean;
}

export async function prettyPrintUplcFromFile( opts: CliPrettyUplcFlags ): Promise<void> {
	const { input, output } = opts;

	const inputPath = path.resolve( input.trim() );
	const uplcBytes = await fsp.readFile( inputPath );

	const uplcProgram = parseUPLC( uplcBytes, "flat" );
	const result = opts.canonical === true
		? "(program\n  " + uplcProgram.version.toString() + "\n  "
			+ _toPlutusCoreSyntax( showUPLC( uplcProgram.body ) ) + "\n)\n"
		: "(program " + uplcProgram.version.toString() + "\n"
			+ prettyUPLC( uplcProgram.body, 2 ) + "\n)";

	if( !output ) {
		console.log( result );
		return;
	}

	const outputPath = path.resolve( output.trim() );
	await fsp.writeFile( outputPath, result );
}

/**
 * `showUPLC` names the boolean constant type "boolean"; the plutus-core
 * textual parser spells it "bool". Only type positions are rewritten.
 */
function _toPlutusCoreSyntax( s: string ): string {
	return s
		.replace( /\(con boolean /g, "(con bool " )
		.replace( /\(list boolean\)/g, "(list bool)" )
		.replace( /\(pair boolean /g, "(pair bool " )
		.replace( / boolean\)/g, " bool)" );
}
