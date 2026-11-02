import { CliCompileOptions } from "./completeCompileOptions";
import { Compiler, CompilerIoApi } from "@harmoniclabs/pebble";
import { createFsIo } from "../utils/crateFsIo";
import { copyOutput } from "../utils/copyOutput";

export async function compilePebbleProject(opts: CliCompileOptions): Promise<void> {
	const { root, entry, outDir, output, config } = opts;
	const io = createFsIo(root);

	const compiler = new Compiler(io, config);
	// Mirror test behavior: pass overrides via compile()
	await compiler.compile({
		root,
		entry,
		outDir
	} as any);

	// `compile` resolves once the outputs are written, so they can be copied
	if (output && output !== "./out.flat") await copyOutput(root, outDir, output);
}