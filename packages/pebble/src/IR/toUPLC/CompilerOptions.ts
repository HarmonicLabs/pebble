import { isObject } from "@harmoniclabs/obj-utils";
import { defaultUplcVersion, UPLCVersion } from "@harmoniclabs/uplc";
import { COMPILER_VERSION } from "../../version.generated";

export { COMPILER_VERSION };

export interface CompilerUplcOptimizations {
    /**
     * 
     **/
    groupApplications: boolean;
    /**
     **/
    inlineSingleUse: boolean;
    /**
     **/
    simplifyWrappedPartialFuncApps: boolean;
    /**
     * 
     **/
    removeForceDelay: boolean;
}

export const productionUplcOptimizations: CompilerUplcOptimizations = Object.freeze({
    groupApplications: true,
    inlineSingleUse: true,
    simplifyWrappedPartialFuncApps: true,
    removeForceDelay: true
});

export const debugUplcOptimizations: CompilerUplcOptimizations = Object.freeze({
    groupApplications: false,
    inlineSingleUse: false,
    simplifyWrappedPartialFuncApps: false,
    removeForceDelay: true
});

export const defaultUplcOptimizations: CompilerUplcOptimizations = productionUplcOptimizations;

export function isDebugUplcOptimizations(
    options: Partial<CompilerUplcOptimizations> = {}
): boolean
{
    return Object.keys( debugUplcOptimizations )
    .every((key: keyof CompilerUplcOptimizations) => {

        // keys to ignore
        if( key === "removeForceDelay" ) return true;

        return options[ key ] === debugUplcOptimizations[ key ]
    });
}

export function completeUplcOptimizations(
    options: Partial<CompilerUplcOptimizations>,
    complete: CompilerUplcOptimizations = defaultUplcOptimizations
): CompilerUplcOptimizations
{
    if( !isObject( options ) ) return { ...defaultUplcOptimizations };
    return {
        groupApplications: options.groupApplications ?? complete.groupApplications,
        inlineSingleUse: options.inlineSingleUse ?? complete.inlineSingleUse,
        simplifyWrappedPartialFuncApps: options.simplifyWrappedPartialFuncApps ?? complete.simplifyWrappedPartialFuncApps,
        removeForceDelay: options.removeForceDelay ?? complete.removeForceDelay
    };
}

export interface CompilerOptions {
    /**
     * npm-style semver range that the running compiler version must satisfy.
     * Required since `@harmoniclabs/pebble@0.2.0` — the `Compiler` throws
     * when this field is missing or when the running compiler version does
     * not satisfy the range.
     */
    compilerVersion: string;
    /**
     * path to the entry file
     */
    entry: string;
    /**
     * path of the root of the project
     */
    readonly root: string;
    /**
     * path to the output directory
     */
    readonly outDir: string;
    /**
     * if `true` silences all compiler output
     */
    readonly silent: boolean;
    /**
     * uplc version (encoded in the script)
     */
    targetUplcVersion: UPLCVersion;
    /**
     * @todo TODO
     * 
     * @default true
     * 
     * set to `false` only for debugging purposes
     **/
    removeTraces: boolean;
    /**
     * @todo TODO
     * 
     * if `true` replaces all `IRHoisted` with `IRLetted`
     * 
     * handling letted terms is more expansive than hoisted terms
     * because hoisted (since closed terms) are blindly added as roots of the script
     * 
     * however this approach impacts the "script startup cost" considerably
     * esxpecially for scripts with different branches (eg. multi purpose scripts)
     * where some hoisted may never be used in some branches,
     * but still are added to the "initialization cost"
     * 
     * on the other hand, handling letted instead of hoisted may impact compliation time
     * 
     * for this reason it is best to set this option to `true` only for production
     **/
    delayHoists: boolean;
    /**
     * 
     **/
    uplcOptimizations: /* boolean |*/ Partial<CompilerUplcOptimizations>;
    /**
     * 
     **/
    addMarker: boolean;
}

/**
 * Option templates intentionally omit `compilerVersion` — every caller must
 * set it explicitly so a missing `compilerVersion` always surfaces as an
 * error from the `Compiler` constructor.
 */
export type CompilerDefaults = Omit<CompilerOptions, "compilerVersion">;

export const extremeOptions: CompilerDefaults = Object.freeze({
    entry: "./src/index.pebble",
    root: ".",
    outDir: "./out",
    silent: false,
    targetUplcVersion: defaultUplcVersion,
    removeTraces: true,
    delayHoists: true,
    uplcOptimizations: productionUplcOptimizations,
    addMarker: true
});

export const productionOptions: CompilerDefaults = Object.freeze({
    entry: "./src/index.pebble",
    root: ".",
    outDir: "./out",
    silent: false,
    targetUplcVersion: defaultUplcVersion,
    removeTraces: true,
    delayHoists: true,
    uplcOptimizations: productionUplcOptimizations,
    addMarker: true
});

export const debugOptions: CompilerDefaults = Object.freeze({
    entry: "./src/index.pebble",
    root: ".",
    outDir: "./out",
    silent: false,
    targetUplcVersion: defaultUplcVersion,
    removeTraces: false,
    delayHoists: false,
    uplcOptimizations: debugUplcOptimizations,
    addMarker: false
});

export const defaultOptions: CompilerDefaults = Object.freeze({
    ...productionOptions,
});
export const testOptions: CompilerDefaults = Object.freeze({
    // ...debugOptions,
    ...productionOptions,
    silent: true
});

export const defulatCompilerOptions = defaultOptions;

export function completeCompilerOptions(
    options: Partial<CompilerOptions>,
    complete: Partial<CompilerOptions> = defaultOptions as Partial<CompilerOptions>
): CompilerOptions
{
    let targetUplcVersion = options.targetUplcVersion instanceof UPLCVersion ? complete.targetUplcVersion : defaultUplcVersion;
    complete = {
        ...(defaultOptions as Partial<CompilerOptions>),
        ...complete
    };
    let uplcOptimizations = options.uplcOptimizations as CompilerUplcOptimizations;
    if( typeof options.uplcOptimizations === "boolean" )
    {
        if( options.uplcOptimizations )
        {
            uplcOptimizations = {
                ...productionUplcOptimizations,
                ...uplcOptimizations
            }
        }
        else
        {
            uplcOptimizations = {
                ...debugUplcOptimizations,
                ...uplcOptimizations,
            }
        }
    }
    // console.log( "uplcOptimizations", uplcOptimizations );
    // console.log( "completeUplcOptimizations( uplcOptimizations )",completeUplcOptimizations( uplcOptimizations ))
    return {
        ...(complete as CompilerOptions),
        // forward compilerVersion verbatim — no fallback; Compiler throws if missing/invalid
        compilerVersion: options.compilerVersion ?? (complete as Partial<CompilerOptions>).compilerVersion!,
        targetUplcVersion: targetUplcVersion as UPLCVersion,
        removeTraces: options.removeTraces ?? complete.removeTraces!,
        delayHoists: options.delayHoists ?? complete.delayHoists!,
        uplcOptimizations: completeUplcOptimizations( uplcOptimizations ),
        addMarker: options.addMarker ?? complete.addMarker!
    };
}