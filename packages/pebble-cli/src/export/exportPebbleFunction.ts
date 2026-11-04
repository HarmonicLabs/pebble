import { Compiler } from "@harmoniclabs/pebble";
import { createFsIo } from "../utils/crateFsIo";
import { copyOutput } from "../utils/copyOutput";
import { reportCompileFailure } from "../utils/reportCompileFailure";
import { CliExportOptions } from "./completeExportOptions";

export async function exportPebbleFunction(opts: CliExportOptions): Promise<void> {
	const { root, entry, functionName, outDir, output, config } = opts;
	const io = createFsIo(root);

	const compiler = new Compiler(io, config);
	try {
		// Mirror test behavior: pass overrides via compile()
		await compiler.export({
			functionName,
			root,
			entry,
			outDir
		});
	} catch (e) {
		return reportCompileFailure(compiler, e);
	}

	// `export` resolves once the outputs are written, so they can be copied
	if (output && output !== "./out.flat") await copyOutput(root, outDir, output);
}