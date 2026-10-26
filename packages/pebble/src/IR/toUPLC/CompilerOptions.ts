import { isObject } from "@harmoniclabs/obj-utils";
import { UPLCVersion } from "@harmoniclabs/uplc";
import { COMPILER_VERSION } from "../../version.generated";

const defaultTargetUplcVersion = new UPLCVersion( 1, 1, 0 );

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
    /**
     * Controls the Data encoding of single-constructor SHORTCUT struct
     * declarations (`struct Foo { x: int }`).
     *
     * - `"minimal"` (the default since 0.5.0): shortcut structs are
     *   list-encoded, `listData(fields)` — the same encoding Plutus V4
     *   uses for the product types of the ledger API.
     * - `"legacy"`: shortcut structs are encoded as `constrData(0, fields)`,
     *   as every compiler up to 0.4.x did. Set this to recompile an
     *   already-deployed contract to the same bytes.
     *
     * Either way the encoding can be picked per struct, in the source:
     * the explicit single-constructor form
     * (`struct Foo { Foo { x: int } }`) is ALWAYS `constrData(0, fields)`,
     * and the `untagged` keyword ALWAYS forces `listData(fields)`.
     *
     * `"default"` is the pre-0.5.0 spelling of `"legacy"` and is still
     * accepted, so a config that pinned it keeps its encoding.
     */
    encodingStrategy: EncodingStrategy;
    /**
     * Which Plutus ledger-API family the UNSUFFIXED prelude type names
     * (`ScriptContext`, `Tx`, `TxIn`, `TxOut`, `Address`, `ScriptInfo`,
     * `ScriptPurpose`) resolve to.
     *
     * - `"v3"` (default): the stable Conway-era types — today's on-chain
     *   reality (protocol version 11 runs PlutusV3 scripts).
     * - `"experimental-v4"`: the Dijkstra-era types (mirroring
     *   plutus-ledger-api 1.69.0.0). EXPERIMENTAL until Plutus V4 is live
     *   on mainnet — the shapes track a still-Proposed CIP and may change;
     *   the plain `"v4"` spelling is reserved for when the fork lands and
     *   is rejected with guidance until then. Exactly one family exists
     *   per compilation (no suffixed names, no mixing); `contract`
     *   declarations derive against whichever family is selected.
     */
    targetPlutusVersion: TargetPlutusVersion;
}

export type TargetPlutusVersion = "v3" | "experimental-v4";

export type EncodingStrategy = "minimal" | "legacy" | /** @deprecated use `"legacy"` */ "default";

/** `true` if shortcut single-constructor structs keep the `constrData(0, fields)` encoding */
export function isLegacyEncodingStrategy( strategy: unknown ): boolean
{
    return strategy === "legacy" || strategy === "default";
}

/**
 * Case-insensitive normalization for `targetPlutusVersion` (config files
 * may carry `"V4"`, `"PlutusV4"`, ...). Unknown values throw.
 */
export function normalizeTargetPlutusVersion( v: unknown ): TargetPlutusVersion
{
    if( v === undefined || v === null ) return "v3";
    const s = String( v ).toLowerCase().replace( /^plutus[\s_-]*/, "" );
    if( s === "v3" || s === "3" ) return "v3";
    if( s === "experimental-v4" || s === "experimentalv4" || s === "experimental_v4" )
    return "experimental-v4";
    // reserve the plain "v4" spelling for when Plutus V4 is live on mainnet
    // (the Dijkstra hard fork); until then the target is explicitly
    // experimental — shapes track a still-Proposed CIP and may change
    if( s === "v4" || s === "4" )
    throw new Error(
        `"targetPlutusVersion": "v4" is reserved until Plutus V4 is active on ` +
        `mainnet; use "experimental-v4" to opt into the pre-release Dijkstra types`
    );
    throw new Error(
        `invalid "targetPlutusVersion": ${JSON.stringify( v )}; expected "v3" or "experimental-v4"`
    );
}

/**
 * Option templates intentionally omit `compilerVersion` — every caller must
 * set it explicitly so a missing `compilerVersion` always surfaces as an
 * error from the `Compiler` constructor.
 */
export type CompilerDefaults = Omit<CompilerOptions, "compilerVersion">;

export const extremeOptions: CompilerDefaults = Object.freeze({
    targetPlutusVersion: "v3",
    entry: "./src/index.pebble",
    root: ".",
    outDir: "./out",
    silent: false,
    targetUplcVersion: defaultTargetUplcVersion,
    removeTraces: true,
    delayHoists: true,
    uplcOptimizations: productionUplcOptimizations,
    addMarker: true,
    encodingStrategy: "minimal"
});

export const productionOptions: CompilerDefaults = Object.freeze({
    targetPlutusVersion: "v3",
    entry: "./src/index.pebble",
    root: ".",
    outDir: "./out",
    silent: false,
    targetUplcVersion: defaultTargetUplcVersion,
    removeTraces: true,
    delayHoists: true,
    uplcOptimizations: productionUplcOptimizations,
    addMarker: true,
    encodingStrategy: "minimal"
});

export const debugOptions: CompilerDefaults = Object.freeze({
    targetPlutusVersion: "v3",
    entry: "./src/index.pebble",
    root: ".",
    outDir: "./out",
    silent: false,
    targetUplcVersion: defaultTargetUplcVersion,
    removeTraces: false,
    delayHoists: false,
    uplcOptimizations: debugUplcOptimizations,
    addMarker: false,
    encodingStrategy: "minimal"
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
    let targetUplcVersion = options.targetUplcVersion instanceof UPLCVersion ? complete.targetUplcVersion : defaultTargetUplcVersion;
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
        addMarker: options.addMarker ?? complete.addMarker!,
        encodingStrategy: options.encodingStrategy ?? complete.encodingStrategy ?? "minimal",
        targetPlutusVersion: normalizeTargetPlutusVersion(
            options.targetPlutusVersion ?? complete.targetPlutusVersion
        )
    };
}