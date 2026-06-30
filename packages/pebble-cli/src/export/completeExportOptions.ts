import { CompilerOptions, defaultOptions, productionOptions, COMPILER_VERSION } from "@harmoniclabs/pebble";
import * as path from "node:path";
import { normalizeRoot, isRecord } from "../utils/miscellaneous";
import { existsSync, readFileSync } from "node:fs";

export interface CliExportFlags {
    config?: string;
    entry?: string;
    output?: string;
    functionName?: string;
}

export interface CliExportOptions {
    root: string;
    entry: string;
    functionName: string;
    outDir: string;
    output?: string;
    config: CompilerOptions;
    configPath?: string;
}

export function completeExportOptions(flags: CliExportFlags): CliExportOptions {
    const root = normalizeRoot();

    if( typeof flags.functionName !== "string" )
    throw new Error("exported function name must be provided via '--function-name <name>' flag");

    const functionName = flags.functionName.trim();

    const configPath = path.resolve(root, flags.config ?? "./pebble.config.json");
    // compilerVersion is intentionally not set here — it must come from the
    // user's pebble.config.json. If missing/invalid, the Compiler throws.
    let config: CompilerOptions = productionOptions as CompilerOptions;
    if (existsSync(configPath)) {
        try {
            const txt = readFileSync(configPath, "utf8");
            const parsed = JSON.parse(txt);
            if (isRecord(parsed)) config = {
                ...productionOptions,
                ...parsed,
                uplcOptimizations: {
                    ...productionOptions.uplcOptimizations,
                    ...(parsed.uplcOptimizations as any)
                }
            } as CompilerOptions;
        } catch {
            // ignore malformed config; proceed with flags/defaults
        }
    }

    // A one-off `pebble export --function-name <fn> --entry <file>` should work
    // without a `pebble.config.json`. The Compiler requires a `compilerVersion`
    // semver range; when no config supplies one, default it to THIS compiler's
    // version (which trivially satisfies the range). An explicit config range
    // still takes precedence and is still checked.
    if( typeof config?.compilerVersion !== "string" || config.compilerVersion.length === 0 ) {
        config = { ...config, compilerVersion: COMPILER_VERSION } as CompilerOptions;
    }

    const cfgEntry = typeof config?.entry === "string" ? String(config!.entry) : undefined;
    const entry = (flags.entry ?? (cfgEntry ?? "./src/index.pebble")).trim();

    const desiredOutput = flags.output;
    const cfgOutDir = typeof config?.outDir === "string" ? String(config!.outDir) : undefined;
    let outDir = cfgOutDir ?? (desiredOutput ? path.dirname(desiredOutput) : "./out");
    if (desiredOutput === "./out.flat") {
        // keep sane default when user didn't set anything explicitly
        outDir = cfgOutDir ?? "./out";
    }

    return {
        root,
        entry,
        functionName,
        outDir,
        output: desiredOutput,
        config,
        configPath: existsSync(configPath) ? configPath : undefined,
    };
}