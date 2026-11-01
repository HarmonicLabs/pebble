import { Application, compileUPLC, Force, parseUPLC, prettyUPLC, showUPLCConstValue, UPLCConst, UPLCProgram, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DiagnosticCategory } from "../diagnostics/DiagnosticCategory";
import { DiagnosticEmitter } from "../diagnostics/DiagnosticEmitter"
import { DiagnosticMessage } from "../diagnostics/DiagnosticMessage";
import { CompilerOptions } from "../IR/toUPLC/CompilerOptions";
import { COMPILER_VERSION } from "../version.generated";
import { semverSatisfies } from "../utils/semverSatisfies";
import { AstCompiler } from "./AstCompiler/AstCompiler";
import { CompilerIoApi, createMemoryCompilerIoApi } from "./io/CompilerIoApi";
import { compileTypedProgram } from "./TirCompiler/compileTirProgram";
import { toHex } from "@harmoniclabs/uint8array-utils";
import { CompilationCtx, withCompilationCtx } from "../IR/CompilationCtx";
import { compileIRToUPLC } from "../IR/toUPLC/compileIRToUPLC";
import { config } from "process";
import { TypedProgram } from "./tir/program/TypedProgram";
import { TirFuncExpr } from "./tir/expressions/TirFuncExpr";
import { CheckResult } from "./SourceTypeMap";
import { SourceRange } from "../ast/Source/SourceRange";
import {
    TestBudget,
    TestInput,
    TestIterationResult,
    TestResult,
    addBudget,
    zeroBudget,
} from "./test/TestResult";
import { FuzzerInfo } from "./tir/statements/TirTestStmt";
import { PRNG } from "./test/fuzz/PRNG";
import { sampleForType, TypedSample } from "./test/fuzz/typedFuzzers";
import { TirType } from "./tir/types/TirType";

export { CheckResult, SourceTypeMap, TypeEntry, MemberInfo } from "./SourceTypeMap";
export {
    TestBudget,
    TestIterationResult,
    TestResult,
    TestKind,
} from "./test/TestResult";

export class Compiler
    extends DiagnosticEmitter
{
    constructor(
        readonly io: CompilerIoApi = createMemoryCompilerIoApi({ useConsoleAsOutput: true }),
        readonly cfg: CompilerOptions,
        diagnostics?: DiagnosticMessage[]
    )
    {
        super( diagnostics );
        const range = (cfg as Partial<CompilerOptions> | undefined)?.compilerVersion;
        if( typeof range !== "string" || range.length === 0 ) {
            throw new Error(
                `Pebble compiler config is missing "compilerVersion". ` +
                `Starting from @harmoniclabs/pebble@0.2.0 this field is required ` +
                `and must be an npm-style semver range (e.g. "^0.2.0").`
            );
        }
        if( !semverSatisfies( COMPILER_VERSION, range ) ) {
            throw new Error(
                `Pebble compiler version ${COMPILER_VERSION} does not satisfy ` +
                `the configured "compilerVersion" range "${range}".`
            );
        }
        if( cfg.silent === true ) {
            this.io.stdout = { write() {} };
        }
    }
    
    async check( config?: Partial<CompilerOptions> ): Promise<CheckResult>
    {
        const cfg = {
            ...this.cfg,
            ...config,
            silent: true,
        };
        const astCompiler = new AstCompiler( cfg, this.io, this.diagnostics );
        return await astCompiler.check();
    }

    async compile( config?: Partial<CompilerOptions> ): Promise<Uint8Array>
    {
        const cfg = {
            ...this.cfg,
            ...config
        };
        const astCompiler = new AstCompiler( cfg, this.io, this.diagnostics );
        const program = await astCompiler.compile();
        if( this.diagnostics.length > 0 ) {
            let msg: DiagnosticMessage;
            const fstErrorMsg = this.diagnostics[0].toString();
            const nDiags = this.diagnostics.length;
            for( msg of this.diagnostics ) {
                this.io.stdout.write( msg.toString() + "\n" );
            }
            // return new Uint8Array();
            throw new Error("compilation failed with " + nDiags + " diagnostic messages; first message: " + fstErrorMsg );
        }
        return this._compileBackend( cfg, program );
    }

    async export( config: Partial<ExportOptions> & HasFuncitonName ): Promise<Uint8Array>
    {
        const cfg: ExportOptions = {
            ...this.cfg,
            ...config,
            // NEVER generate markers when exporting a function
            addMarker: false,
        };
        if( typeof cfg.functionName !== "string" || cfg.functionName.length === 0 ) {
            throw new Error("Compiler::export - invalid function name in export options");
        }

        const astCompiler = new AstCompiler( cfg, this.io, this.diagnostics );
        const program = await astCompiler.export( cfg.functionName, cfg.entry );
        // Surface diagnostics instead of silently swallowing them (audit
        // BUG 30). Previously this DRAINED `this.diagnostics` with `.shift()`
        // and had the throw commented out, so `export()` always succeeded and
        // left an empty diagnostics array — making every
        // `export(); expect(diagnostics).toEqual([])` assertion vacuous.
        // Now: preserve the diagnostics, and throw when any is an ERROR
        // (warnings are kept but do not fail the export).
        const errs = this.diagnostics.filter( d => d.category === DiagnosticCategory.Error );
        if( errs.length > 0 ) {
            for( const msg of this.diagnostics ) {
                this.io.stdout.write( msg.toString() + "\n" );
            }
            throw new Error(
                "compilation failed with " + errs.length +
                " error diagnostic messages; first message: " + errs[0].toString()
            );
        }
        return this._compileBackend( cfg, program );
    }

    async run( config?: Partial<CompilerOptions> )
    {
        const cfg = {
            ...this.cfg,
            ...config,
            // NEVER generate markers when running
            addMarker: false,
        };
        const astCompiler = new AstCompiler( cfg, this.io, this.diagnostics );
        const program = await astCompiler.run();
        if( this.diagnostics.length > 0 ) {
            let msg: DiagnosticMessage;
            const fstErrorMsg = this.diagnostics[0].toString();
            const nDiags = this.diagnostics.length;
            while( msg = this.diagnostics.shift()! ) {
                this.io.stdout.write( msg.toString() + "\n" );
            }
            throw new Error("compilation failed with " + nDiags + " diagnostic messages; first message: " + fstErrorMsg );
        }
        const serialized = this._compileBackend( cfg, program );
        const uplcProgram = parseUPLC( serialized );
        // the run-wrapper is always a 0-arg function, which now
        // compiles to `Delay(body)`; force it so the body executes.
        return Machine.eval( new Force( uplcProgram.body ) );
    }

    async test( config?: Partial<CompilerOptions> & {
        nameFilter?: string | RegExp;
        propertyIterations?: number;
        seed?: number;
    } ): Promise<TestResult[]>
    {
        const cfg: CompilerOptions = {
            ...this.cfg,
            ...config,
            silent: true,
            addMarker: false,
        };
        const nameFilter = config?.nameFilter;
        const matches = (
            !nameFilter ? () => true :
            typeof nameFilter === "string" ? (n: string) => n.includes( nameFilter ) :
            (n: string) => (nameFilter as RegExp).test( n )
        );
        const propertyIterations = Math.max( 1, config?.propertyIterations ?? 100 );
        const seed = config?.seed ?? 0;

        // 1) discovery pass: parse + check, populate program.tests.
        //    diagnostics from this pass are surfaced once; subsequent per-test
        //    passes use their own diagnostic arrays so we don't double-report.
        const discovery = new AstCompiler( cfg, this.io, this.diagnostics );
        const discoveryResult = await discovery.check();

        const descriptors = discoveryResult.program.tests
        .filter( t => matches( t.name ) )
        .map( t => {
            const fn = discoveryResult.program.functions.get( t.tirFuncName );
            const paramNames = (fn instanceof TirFuncExpr) ? fn.params.map( p => p.sourceName ?? p.name ) : [];
            return {
                name: t.name,
                tirFuncName: t.tirFuncName,
                sourceFile: t.sourceFile,
                range: t.range,
                paramNames,
                fuzzerInfos: t.fuzzerInfos,
            };
        });

        const results: TestResult[] = new Array( descriptors.length );
        for( let i = 0; i < descriptors.length; i++ )
        {
            results[i] = await this._runOneTest( cfg, descriptors[i], propertyIterations, seed );
        }
        return results;
    }

    private async _runOneTest(
        cfg: CompilerOptions,
        desc: {
            name: string;
            tirFuncName: string;
            sourceFile: string;
            range: SourceRange;
            paramNames: string[];
            fuzzerInfos: FuzzerInfo[];
        },
        propertyIterations: number,
        seed: number,
    ): Promise<TestResult>
    {
        const isProperty = desc.fuzzerInfos.length > 0;

        // fresh AstCompiler so the expressify pass starts from a clean program
        const localDiagnostics: DiagnosticMessage[] = [];
        const astCompiler = new AstCompiler( cfg, this.io, localDiagnostics );
        await astCompiler.compileFile( cfg.entry, true );

        if( localDiagnostics.some( d => d.category === DiagnosticCategory.Error ) )
        {
            return _failedTestResult(
                desc,
                "compile error: " + localDiagnostics.find( d => d.category === DiagnosticCategory.Error )!.toString(),
                isProperty ? "property" : "unit"
            );
        }

        const fn = astCompiler.program.functions.get( desc.tirFuncName );
        if(!( fn instanceof TirFuncExpr ))
        {
            return _failedTestResult(
                desc,
                `test function "${desc.name}" not found after re-parse`,
                isProperty ? "property" : "unit"
            );
        }
        astCompiler.program.contractTirFuncName = desc.tirFuncName;

        let serialized: Uint8Array;
        try {
            serialized = this._compileBackend( cfg, astCompiler.program, true );
        } catch ( err ) {
            return _failedTestResult(
                desc,
                "backend error: " + ( err instanceof Error ? err.message : String( err ) ),
                isProperty ? "property" : "unit"
            );
        }

        const uplcProgram = parseUPLC( serialized );

        if( !isProperty )
        {
            const evalResult = Machine.eval( new Force( uplcProgram.body ) );
            const isErr = evalResult.result instanceof CEKError;
            const budget: TestBudget = {
                cpu: BigInt( evalResult.budgetSpent.cpu ),
                mem: BigInt( evalResult.budgetSpent.mem ),
            };
            const iter: TestIterationResult = {
                passed: !isErr,
                budgetSpent: budget,
                logs: evalResult.logs.slice(),
                error: isErr ? { msg: ( evalResult.result as CEKError ).msg } : undefined,
            };
            return {
                name: desc.name,
                sourceFile: desc.sourceFile,
                range: desc.range,
                kind: "unit",
                passed: !isErr,
                iterations: [ iter ],
                totalBudget: addBudget( zeroBudget(), budget ),
            };
        }

        // ── Property test ──────────────────────────────────────────────
        const unsupported = desc.fuzzerInfos.find( fi => fi.kind === "unsupported" );
        if( unsupported )
        {
            return {
                name: desc.name,
                sourceFile: desc.sourceFile,
                range: desc.range,
                kind: "property",
                passed: false,
                iterations: [],
                totalBudget: zeroBudget(),
                skippedReason: ( unsupported as { kind: "unsupported"; reason: string } ).reason,
                seed,
            };
        }

        // Compile each `via` fuzzer entry point once per test (fresh
        // front-end pass per entry: the expressify/backend passes mutate
        // TIR in place, so a program object cannot compile twice).
        const viaBodies = new Map<string, UPLCTerm>();
        for( const fi of desc.fuzzerInfos )
        {
            if( fi.kind !== "via" || viaBodies.has( fi.tirFuncName ) ) continue;
            try {
                const viaDiagnostics: DiagnosticMessage[] = [];
                const viaCompiler = new AstCompiler( cfg, this.io, viaDiagnostics );
                await viaCompiler.compileFile( cfg.entry, true );
                const err = viaDiagnostics.find( d => d.category === DiagnosticCategory.Error );
                if( err ) return _failedTestResult(
                    desc, "fuzzer compile error: " + err.toString(), "property"
                );
                if(!( viaCompiler.program.functions.get( fi.tirFuncName ) instanceof TirFuncExpr ))
                return _failedTestResult(
                    desc, `fuzzer entry '${fi.tirFuncName}' not found after re-parse`, "property"
                );
                viaCompiler.program.contractTirFuncName = fi.tirFuncName;
                const viaSerialized = this._compileBackend( cfg, viaCompiler.program, true );
                viaBodies.set( fi.tirFuncName, parseUPLC( viaSerialized ).body );
            } catch ( err ) {
                return _failedTestResult(
                    desc,
                    "fuzzer backend error: " + ( err instanceof Error ? err.message : String( err ) ),
                    "property"
                );
            }
        }

        // Run N iterations with TS-side sampling (+ CEK-side `via` fuzzers).
        const prng = new PRNG( seed );
        const iterations: TestIterationResult[] = [];
        let totalBudget = zeroBudget();
        let passedAll = true;
        let shrinkSteps: number | undefined = undefined;

        const evalWithArgs = ( args: UPLCTerm[] ): { iter: TestIterationResult } =>
        {
            let app: UPLCTerm = uplcProgram.body;
            for( const arg of args ) app = new Application( app, arg );
            const evalResult = Machine.eval( app );
            const isErr = evalResult.result instanceof CEKError;
            const budget: TestBudget = {
                cpu: BigInt( evalResult.budgetSpent.cpu ),
                mem: BigInt( evalResult.budgetSpent.mem ),
            };
            return {
                iter: {
                    passed: !isErr,
                    budgetSpent: budget,
                    logs: evalResult.logs.slice(),
                    error: isErr ? { msg: ( evalResult.result as CEKError ).msg } : undefined,
                }
            };
        };

        for( let i = 0; i < propertyIterations; i++ )
        {
            const inputs: TestInput[] = [];
            const args: UPLCTerm[] = [];
            // parallel to fuzzerInfos; only "typed" entries participate in shrinking
            const samples: ( TypedSample | undefined )[] = new Array( desc.fuzzerInfos.length );
            let fuzzerFailure: TestIterationResult | undefined = undefined;

            for( let p = 0; p < desc.fuzzerInfos.length; p++ )
            {
                const fi = desc.fuzzerInfos[p];
                const paramName = desc.paramNames[p] ?? `param${p}`;
                if( fi.kind === "typed" )
                {
                    const sample = sampleForType( fi.type, prng );
                    samples[p] = sample;
                    inputs.push({ name: paramName, value: _sampleInputValue( sample ) });
                    args.push( sample.term() );
                }
                else if( fi.kind === "via" )
                {
                    const fuzzSeed = BigInt( prng.next32() );
                    const fuzzResult = Machine.eval(
                        new Application( viaBodies.get( fi.tirFuncName )!, UPLCConst.int( fuzzSeed ) )
                    );
                    if( fuzzResult.result instanceof CEKError )
                    {
                        fuzzerFailure = {
                            passed: false,
                            budgetSpent: zeroBudget(),
                            logs: fuzzResult.logs.slice(),
                            error: { msg: `'via' fuzzer for parameter '${paramName}' errored (fuzzer seed=${fuzzSeed}): ` + ( fuzzResult.result.msg ?? "" ) },
                            inputs,
                        };
                        break;
                    }
                    if(!( fuzzResult.result instanceof CEKConst ))
                    {
                        fuzzerFailure = {
                            passed: false,
                            budgetSpent: zeroBudget(),
                            logs: [],
                            error: { msg: `'via' fuzzer for parameter '${paramName}' returned a non-constant value; fuzzers must produce plain (constant-representable) values` },
                            inputs,
                        };
                        break;
                    }
                    const fuzzedConst = new UPLCConst( fuzzResult.result.type, fuzzResult.result.value as any );
                    inputs.push({ name: paramName, value: showUPLCConstValue( fuzzResult.result.value ) });
                    args.push( fuzzedConst );
                }
                else throw new Error("unreachable: unsupported fuzzer after skip check");
            }

            if( fuzzerFailure )
            {
                iterations.push( fuzzerFailure );
                passedAll = false;
                break;
            }

            const { iter } = evalWithArgs( args );
            iter.inputs = inputs;
            iterations.push( iter );
            totalBudget = addBudget( totalBudget, iter.budgetSpent );

            if( !iter.passed )
            {
                passedAll = false;

                // ── Shrinking ──────────────────────────────────────────
                // Greedy minimization, only when every parameter is a
                // TS-side "typed" sample (a `via` value cannot be shrunk;
                // its seed is reported instead). Shrink evaluations do NOT
                // count toward `totalBudget`.
                if( desc.fuzzerInfos.every( fi => fi.kind === "typed" ) )
                {
                    const MAX_SHRINK_EVALS = 200;
                    let evals = 0;
                    let best = samples as TypedSample[];
                    let bestIter = iter;
                    let steps = 0;
                    let improved = true;
                    while( improved && evals < MAX_SHRINK_EVALS )
                    {
                        improved = false;
                        outer:
                        for( let p = 0; p < best.length; p++ )
                        {
                            for( const cand of best[p].shrinks() )
                            {
                                if( evals >= MAX_SHRINK_EVALS ) break outer;
                                evals++;
                                const candSamples = best.slice();
                                candSamples[p] = cand;
                                const candArgs = candSamples.map( s => s.term() );
                                const { iter: candIter } = evalWithArgs( candArgs );
                                if( !candIter.passed )
                                {
                                    best = candSamples;
                                    bestIter = candIter;
                                    steps++;
                                    improved = true;
                                    break outer;
                                }
                            }
                        }
                    }
                    if( steps > 0 )
                    {
                        bestIter.inputs = best.map( ( s, k ) => ({
                            name: desc.paramNames[k] ?? `param${k}`,
                            value: _sampleInputValue( s )
                        }));
                        iterations.push( bestIter );
                        shrinkSteps = steps;
                    }
                }
                break;
            }
        }

        return {
            name: desc.name,
            sourceFile: desc.sourceFile,
            range: desc.range,
            kind: "property",
            passed: passedAll,
            iterations,
            totalBudget,
            seed,
            shrinkSteps,
        };
    }

    async runRepl( config?: Partial<CompilerOptions> )
    {
        const cfg = {
            ...this.cfg,
            ...config,
            addMarker: false,
        };
        const astCompiler = new AstCompiler( cfg, this.io, this.diagnostics );
        const program = await astCompiler.runRepl();
        if( this.diagnostics.length > 0 ) {
            let msg: DiagnosticMessage;
            const fstErrorMsg = this.diagnostics[0].toString();
            const nDiags = this.diagnostics.length;
            while( msg = this.diagnostics.shift()! ) {
                this.io.stdout.write( msg.toString() + "\n" );
            }
            throw new Error("compilation failed with " + nDiags + " diagnostic messages; first message: " + fstErrorMsg );
        }
        const serialized = this._compileBackend( cfg, program );
        const uplcProgram = parseUPLC( serialized );
        // the repl-wrapper is always a 0-arg function, which now
        // compiles to `Delay(body)`; force it so the body executes.
        return Machine.eval( new Force( uplcProgram.body ) );
    }

    private _compileBackend(
        cfg: CompilerOptions,
        program: TypedProgram,
        skipFileOutput: boolean = false
    ): Uint8Array
    {
        // Run the whole backend under a fresh per-compilation context. All
        // node-level caches (hoisted/letted naming, hoisted->letted lowering,
        // the mapToType helper cache) live on this context, so they cannot
        // leak into or be perturbed by any other compilation — and they are
        // dropped automatically when this scope exits, even on throw. The
        // content-addressed `IRHash` has no global state at all, so there is
        // nothing else to reset.
        return withCompilationCtx( new CompilationCtx(), () => {
            const ir = compileTypedProgram(
                cfg,
                program
            );
            const uplc = compileIRToUPLC( ir, cfg );
            const serialized = compileUPLC(
                new UPLCProgram(
                    cfg.targetUplcVersion,
                    uplc
                )
            );

            if( !skipFileOutput )
            {
                const outDir = cfg.outDir;
                const outPath = outDir + ( outDir.endsWith("/") ? "" : "/" ) + "out.flat";
                this.io.writeFile( outPath, serialized, cfg.root );
                this.io.stdout.write( `compiled program written to ${outPath}\n` );
            }

            return serialized;
        });
    }
}

/**
 * Raw scalar values render natively in reports (bigint, boolean, bytes);
 * aggregates use the sample's own pebble-ish `show` string. SoP-encoded
 * samples have no constant view at all, so `show` is the only option.
 */
function _sampleInputValue( sample: TypedSample ): unknown
{
    try {
        const rt = sample.runtime();
        if( typeof rt === "bigint" || typeof rt === "boolean" || rt instanceof Uint8Array )
        return rt;
    } catch {}
    return sample.show;
}

interface HasFuncitonName {
    functionName: string;
}

export interface ExportOptions extends CompilerOptions, HasFuncitonName {
    // functionName: string;
}

function _failedTestResult(
    desc: { name: string; sourceFile: string; range: SourceRange },
    msg: string,
    kind: "unit" | "property" = "unit"
): TestResult
{
    const budget = zeroBudget();
    return {
        name: desc.name,
        sourceFile: desc.sourceFile,
        range: desc.range,
        kind,
        passed: false,
        iterations: [{
            passed: false,
            budgetSpent: budget,
            logs: [],
            error: { msg },
        }],
        totalBudget: budget,
    };
}