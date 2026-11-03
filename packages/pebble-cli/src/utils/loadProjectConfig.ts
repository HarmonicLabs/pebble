import * as path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { CompilerOptions, COMPILER_VERSION, productionOptions } from "@harmoniclabs/pebble";
import { isRecord } from "./miscellaneous";

/**
 * The project's `pebble.config.json` over the production defaults; without a config (or a
 * malformed one) the defaults. Without a `compilerVersion` range the project builds with THIS
 * compiler, as `pebble compile` does (an explicit range still wins and is checked).
 */
export function loadProjectConfig( root: string, configFile: string = "./pebble.config.json" ): CompilerOptions
{
    const configPath = path.resolve( root, configFile );
    let baseConfig: CompilerOptions = productionOptions as CompilerOptions;
    if( existsSync( configPath ) )
    {
        try {
            const txt = readFileSync( configPath, "utf8" );
            const parsed = JSON.parse( txt );
            if( isRecord( parsed ) ) baseConfig = {
                ...productionOptions,
                ...parsed,
                uplcOptimizations: {
                    ...productionOptions.uplcOptimizations,
                    ...(parsed.uplcOptimizations as any)
                }
            } as CompilerOptions;
        } catch {
            // ignore malformed config
        }
    }
    if( typeof baseConfig?.compilerVersion !== "string" || baseConfig.compilerVersion.length === 0 )
    {
        baseConfig = { ...baseConfig, compilerVersion: COMPILER_VERSION } as CompilerOptions;
    }
    return baseConfig;
}
