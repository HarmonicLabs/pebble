import { Application, compileUPLC, Force, parseUPLC, prettyUPLC, showUPLCConstValue, UPLCConst, UPLCProgram, UPLCTerm, UPLCVersion } from "@harmoniclabs/uplc";
import { CEKConst, CEKError, CEKValueObj, evaluateWithSourceMap, ExBudget, findMappedProgram, indexProgram, locateFailure, Machine, recordEvaluation, RecordEvaluationOptions, ScriptFailure, UPLCSourceMap } from "@harmoniclabs/plutus-machine";
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
import { buildSourceMap } from "../IR/sourceMap/buildSourceMap";
import { DebugCollector } from "./debug/DebugCollector";
import { collectDebugStructure } from "./debug/collectDebugStructure";
import { buildDebugTable, DebugTable } from "./debug/buildDebugTable";
import { DebugRun } from "../debugger/DebugRun";
import type { UplcMarks } from "../IR/sourceMap/uplcMarks";
import type { StrippedTrace } from "../IR/sourceMap/irTraces";
import { IRDelayed } from "../IR/IRNodes/IRDelayed";
import { IRNodeKind } from "../IR/IRNodeKind";
import { config } from "process";
import { TypedProgram } from "./tir/program/TypedProgram";
import { TirFuncExpr } from "./tir/expressions/TirFuncExpr";
import { CheckResult } from "./SourceTypeMap";
import { SourceRange } from "../ast/Source/SourceRange";
import {
    TestBudget,
    TestError,
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
    TestError,
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

    /** compiles the project and writes `out.flat` (and `out.flat.map`, see `sourceMap`) */
    async compile( config?: Partial<CompilerOptions> ): Promise<Uint8Array>
    {
        const cfg = {
            ...this.cfg,
            ...config
        };
        const compiled = await this._compileProgram( cfg );
        await this._writeOutputs( cfg, compiled );
        return compiled.bytes;
    }

    /** like `compile`, but writes nothing: the program and its source map */
    async compileWithSourceMap( config?: Partial<CompilerOptions> ): Promise<CompiledWithSourceMap>
    {
        const cfg = {
            ...this.cfg,
            ...config
        };
        const compiled = await this._compileProgram( cfg );
        return { bytes: compiled.bytes, sourceMap: compiled.sourceMap() };
    }

    /**
     * like `compileWithSourceMap`, plus the debug information a debugger shows variables and
     * statements with (see `compiler/debug`); the program is the one `compile` writes
     */
    async compileWithDebugInfo( config?: Partial<CompilerOptions> ): Promise<CompiledWithDebugInfo>
    {
        const cfg = {
            ...this.cfg,
            ...config
        };
        const compiled = await this._compileProgram( cfg, true );
        return { bytes: compiled.bytes, sourceMap: compiled.sourceMap(), debugTable: compiled.debugTable!() };
    }

    private async _compileProgram( cfg: CompilerOptions, collectDebugInfo: boolean = false ): Promise<CompiledProgram>
    {
        const astCompiler = new AstCompiler( cfg, this.io, this.diagnostics );
        const program = await astCompiler.compile();
        const errors = this.diagnostics.filter( d => d.category === DiagnosticCategory.Error );
        for( const msg of this.diagnostics ) this.io.stdout.write( msg.toString() + "\n" );
        if( errors.length > 0 ) {
            throw new Error("compilation failed with " + errors.length + " error diagnostic messages; first message: " + errors[0].toString() );
        }
        return this._compileBackend( cfg, program, collectDebugInfo );
    }

    /** compiles a single function and writes it to `out.flat` (and `out.flat.map`) */
    async export( config: Partial<ExportOptions> & HasFuncitonName ): Promise<Uint8Array>
    {
        const cfg = this._exportOptions( config );
        const compiled = await this._exportProgram( cfg );
        await this._writeOutputs( cfg, compiled );
        return compiled.bytes;
    }

    /** like `export`, but writes nothing: the program and its source map */
    async exportWithSourceMap( config: Partial<ExportOptions> & HasFuncitonName ): Promise<CompiledWithSourceMap>
    {
        const compiled = await this._exportProgram( this._exportOptions( config ) );
        return { bytes: compiled.bytes, sourceMap: compiled.sourceMap() };
    }

    private _exportOptions( config: Partial<ExportOptions> & HasFuncitonName ): ExportOptions
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
        return cfg;
    }

    private async _exportProgram( cfg: ExportOptions ): Promise<CompiledProgram>
    {
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
        // warnings are shown too, and do not fail the export
        for( const msg of this.diagnostics ) this.io.stdout.write( msg.toString() + "\n" );
        if( errs.length > 0 ) {
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
        this._throwOnErrors();
        const compiled = this._compileBackend( cfg, program );
        await this._writeOutputs( cfg, compiled );
        const uplcProgram = parseUPLC( compiled.bytes );
        // the run-wrapper is always a 0-arg function, which now
        // compiles to `Delay(body)`; force it so the body executes.
        const { result, budgetSpent, logs } = evaluateCompiled( new Force( uplcProgram.body ), uplcProgram.body, compiled );
        return { result, budgetSpent, logs };
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

        const descriptors = ( await this._discoverTests( cfg ) ).filter( t => matches( t.name ) );

        const results: TestResult[] = new Array( descriptors.length );
        for( let i = 0; i < descriptors.length; i++ )
        {
            results[i] = await this._runOneTest( cfg, descriptors[i], propertyIterations, seed );
        }
        return results;
    }

    /**
     * discovery pass: parse + check, populate program.tests.
     * diagnostics from this pass are surfaced once; subsequent per-test
     * passes use their own diagnostic arrays so we don't double-report.
     */
    private async _discoverTests( cfg: CompilerOptions ): Promise<TestDescriptor[]>
    {
        const discovery = new AstCompiler( cfg, this.io, this.diagnostics );
        const discoveryResult = await discovery.check();

        return discoveryResult.program.tests
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
    }

    /**
     * Runs one test the way `test` does, and records the evaluation a debugger shows: the one
     * that failed (for a property test, with the smallest failing inputs), or else the first.
     * Debug information is collected for it (see `compiler/debug`): the program is the same.
     *
     * `name` is the test's name, or a part of it no other test's name contains.
     */
    async debugTest( config: Partial<CompilerOptions> & {
        name: string;
        propertyIterations?: number;
        seed?: number;
        /** states recorded at most (see `recordEvaluation`) */
        maxStates?: number;
    } ): Promise<DebugTestResult>
    {
        const cfg: CompilerOptions = {
            ...this.cfg,
            ...config,
            silent: true,
            addMarker: false,
        };
        const all = await this._discoverTests( cfg );
        const exact = all.filter( t => t.name === config.name );
        const candidates = exact.length > 0 ? exact : all.filter( t => t.name.includes( config.name ) );
        if( candidates.length === 0 ) throw new Error( `no test named "${config.name}"` + ( all.length > 0 ? `; the tests are: ${all.map( t => t.name ).join( ", " )}` : "" ) );
        if( candidates.length > 1 ) throw new Error( `"${config.name}" names more than one test: ${candidates.map( t => t.name ).join( ", " )}` );

        const capture: TestCapture = {};
        const test = await this._runOneTest(
            cfg,
            candidates[0],
            Math.max( 1, config.propertyIterations ?? 100 ),
            config.seed ?? 0,
            capture
        );
        if( capture.term === undefined || capture.body === undefined || capture.compiled?.debugTable === undefined )
        return { test, run: undefined, bytes: capture.compiled?.bytes, sourceMap: capture.compiled?.sourceMap(), debugTable: undefined };

        const debugTable = capture.compiled.debugTable();
        // with the traces the compiler removed put back in its logs
        const recording = recordEvaluation( capture.term, {
            maxStates: config.maxStates,
            ...( capture.compiled.strippedTraces > 0 ? { map: capture.compiled.sourceMap(), program: capture.body } : {} ),
        });
        return {
            test,
            run: new DebugRun( recording, debugTable, indexProgram( capture.body ) ),
            bytes: capture.compiled.bytes,
            sourceMap: capture.compiled.sourceMap(),
            debugTable,
        };
    }

    /**
     * Records an evaluation of this project's program (`term`: the script as a transaction
     * holds it, applied to its arguments, see `savedEvaluationTerm`) and shows it in source
     * terms. The project is compiled with debug information; `term` must contain the program
     * it compiles to (its hash is checked), otherwise this throws.
     */
    async debugScript( config: Partial<CompilerOptions> & {
        term: UPLCTerm;
        /** version of the program `term` comes from; default: the compiled program's */
        version?: UPLCVersion | string;
        /** cost model and budget of the evaluation to reproduce */
        costModel?: RecordEvaluationOptions["costModel"];
        budget?: ExBudget;
        maxStates?: number;
    } ): Promise<DebugScriptResult>
    {
        const { term, version, costModel, budget, maxStates, ...compileConfig } = config;
        const compiled = await this.compileWithDebugInfo( compileConfig );
        const program = findMappedProgram( term, compiled.sourceMap, version );
        if( program === undefined ) throw new Error(
            "the script is not the program this project compiles to (no part of it has the source map's programHash " +
            compiled.sourceMap.programHash + "); compile the version of the project the script comes from"
        );
        const recording = recordEvaluation( term, { costModel, budget, maxStates, map: compiled.sourceMap, program } );
        return {
            ...compiled,
            run: new DebugRun( recording, compiled.debugTable, indexProgram( program ) ),
        };
    }

    private async _runOneTest(
        cfg: CompilerOptions,
        desc: TestDescriptor,
        propertyIterations: number,
        seed: number,
        /** set: compile with debug information and keep the evaluation to show (see `debugTest`) */
        capture?: TestCapture,
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

        let compiled: CompiledProgram;
        try {
            compiled = this._compileBackend( cfg, astCompiler.program, capture !== undefined );
        } catch ( err ) {
            return _failedTestResult(
                desc,
                "backend error: " + ( err instanceof Error ? err.message : String( err ) ),
                isProperty ? "property" : "unit"
            );
        }

        const uplcProgram = parseUPLC( compiled.bytes );
        if( capture !== undefined )
        {
            capture.compiled = compiled;
            capture.body = uplcProgram.body;
        }

        if( !isProperty )
        {
            const term = new Force( uplcProgram.body );
            if( capture !== undefined ) capture.term = term;
            const evalResult = evaluateCompiled( term, uplcProgram.body, compiled );
            const isErr = evalResult.result instanceof CEKError;
            const budget: TestBudget = {
                cpu: BigInt( evalResult.budgetSpent.cpu ),
                mem: BigInt( evalResult.budgetSpent.mem ),
            };
            const iter: TestIterationResult = {
                passed: !isErr,
                budgetSpent: budget,
                logs: evalResult.logs,
                error: isErr ? {
                    msg: ( evalResult.result as CEKError ).msg,
                    ...( evalResult.failure !== undefined
                        ? failureLocation( evalResult.failure )
                        : locateTestFailure( term, uplcProgram.body, compiled )
                    )
                } : undefined,
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
                const viaCompiled = this._compileBackend( cfg, viaCompiler.program );
                viaBodies.set( fi.tirFuncName, parseUPLC( viaCompiled.bytes ).body );
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

        const evalWithArgs = ( args: UPLCTerm[] ): { iter: TestIterationResult, term: UPLCTerm } =>
        {
            let app: UPLCTerm = uplcProgram.body;
            for( const arg of args ) app = new Application( app, arg );
            if( capture !== undefined && capture.term === undefined ) capture.term = app;
            const evalResult = evaluateCompiled( app, uplcProgram.body, compiled );
            const isErr = evalResult.result instanceof CEKError;
            const budget: TestBudget = {
                cpu: BigInt( evalResult.budgetSpent.cpu ),
                mem: BigInt( evalResult.budgetSpent.mem ),
            };
            return {
                iter: {
                    passed: !isErr,
                    budgetSpent: budget,
                    logs: evalResult.logs,
                    error: isErr ? { msg: ( evalResult.result as CEKError ).msg } : undefined,
                },
                term: app
            };
        };
        // only reported failures are located: shrink candidates are not
        const locate = ( iter: TestIterationResult, term: UPLCTerm ): void => {
            if( iter.error ) Object.assign( iter.error, locateTestFailure( term, uplcProgram.body, compiled ) );
            // the reported failure is the one to debug (the shrunk one comes last)
            if( capture !== undefined ) capture.term = term;
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

            const { iter, term } = evalWithArgs( args );
            iter.inputs = inputs;
            iterations.push( iter );
            totalBudget = addBudget( totalBudget, iter.budgetSpent );

            if( !iter.passed )
            {
                passedAll = false;
                locate( iter, term );

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
                    let bestTerm = term;
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
                                const { iter: candIter, term: candTerm } = evalWithArgs( candArgs );
                                if( !candIter.passed )
                                {
                                    best = candSamples;
                                    bestIter = candIter;
                                    bestTerm = candTerm;
                                    steps++;
                                    improved = true;
                                    break outer;
                                }
                            }
                        }
                    }
                    if( steps > 0 )
                    {
                        locate( bestIter, bestTerm );
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

    /**
     * runs the entry file as one REPL line: its statements wrapped in a function, the last
     * expression returned. `ReplSession` keeps a session across lines (what `pebble repl` uses)
     */
    async runRepl( config?: Partial<CompilerOptions> )
    {
        const cfg = {
            ...this.cfg,
            ...config,
            addMarker: false,
        };
        const astCompiler = new AstCompiler( cfg, this.io, this.diagnostics );
        const program = await astCompiler.runRepl();
        this._throwOnErrors();
        // a REPL line writes nothing: with real filesystem access it would overwrite the
        // project's `out.flat` at every line
        const uplcProgram = parseUPLC( this._compileBackend( cfg, program ).bytes );
        // the repl-wrapper is always a 0-arg function, which now
        // compiles to `Delay(body)`; force it so the body executes.
        return Machine.eval( new Force( uplcProgram.body ) );
    }

    /**
     * for `run` and `runRepl`: with an error, prints the diagnostics, removes them and throws;
     * warnings alone are printed and kept
     */
    private _throwOnErrors(): void
    {
        const firstError = this.diagnostics.find( d => d.category === DiagnosticCategory.Error );
        if( firstError === undefined )
        {
            for( const msg of this.diagnostics ) this.io.stdout.write( msg.toString() + "\n" );
            return;
        }
        let msg: DiagnosticMessage;
        const nDiags = this.diagnostics.length;
        while( msg = this.diagnostics.shift()! ) {
            this.io.stdout.write( msg.toString() + "\n" );
        }
        throw new Error("compilation failed with " + nDiags + " diagnostic messages; first error: " + firstError.toString() );
    }

    /** compiles to UPLC; writes nothing (see `_writeOutputs`) */
    private _compileBackend(
        cfg: CompilerOptions,
        program: TypedProgram,
        collectDebugInfo: boolean = false
    ): CompiledProgram
    {
        return compileProgramBackend( cfg, program, collectDebugInfo );
    }

    /**
     * writes `out.flat` and, unless `sourceMap` is `false`, its source map `out.flat.map`;
     * resolves once both are written
     */
    private async _writeOutputs( cfg: CompilerOptions, compiled: CompiledProgram ): Promise<void>
    {
        const outDir = cfg.outDir;
        const outPath = outDir + ( outDir.endsWith("/") ? "" : "/" ) + "out.flat";
        await this.io.writeFile( outPath, compiled.bytes, cfg.root );
        this.io.stdout.write( `compiled program written to ${outPath}\n` );
        if( cfg.sourceMap === false )
        {
            if( compiled.strippedTraces > 0 ) this.io.stdout.write( `${compiled.strippedTraces} traces removed (removeTraces); without a source map they are gone\n` );
            return;
        }
        const map = compiled.sourceMap();
        await this.io.writeFile( outPath + ".map", JSON.stringify( map ), cfg.root );
        this.io.stdout.write( `source map written to ${outPath}.map\n` );
        if( compiled.strippedTraces > 0 ) this.io.stdout.write( removedTracesNote( map ) );
    }
}

/**
 * The backend: a checked program (its `contractTirFuncName` set) to UPLC. Writes nothing.
 *
 * @param collectDebugInfo also collect debug information (see `compiler/debug`);
 * the program is the same either way
 */
export function compileProgramBackend(
    cfg: CompilerOptions,
    program: TypedProgram,
    collectDebugInfo: boolean = false
): CompiledProgram
{
    // Run the whole backend under a fresh per-compilation context. All
    // node-level caches (hoisted/letted naming, hoisted->letted lowering,
    // the mapToType helper cache) live on this context, so they cannot
    // leak into or be perturbed by any other compilation — and they are
    // dropped automatically when this scope exits, even on throw. The
    // content-addressed `IRHash` has no global state at all, so there is
    // nothing else to reset.
    const compilationCtx = new CompilationCtx();
    const debug = collectDebugInfo ? new DebugCollector() : undefined;
    compilationCtx.debug = debug;
    // traces are removed before anything is optimized: the program is the one without them,
    // and its map keeps them
    if( cfg.removeTraces === true ) compilationCtx.strippedTraces = [];
    return withCompilationCtx( compilationCtx, () => {
        // the statements as written: `compileTypedProgram` rewrites them into expressions
        if( debug !== undefined ) collectDebugStructure( program, debug );
        const ir = compileTypedProgram(
            cfg,
            program
        );
        const marks: UplcMarks = new Map();
        const uplc = compileIRToUPLC( ir, cfg, marks );
        const uplcProgram = new UPLCProgram(
            cfg.targetUplcVersion,
            uplc
        );
        const bytes = compileUPLC( uplcProgram );
        const strippedTraces = compilationCtx.strippedTraces ?? [];
        const lambdaSymbols = compilationCtx.lambdaSymbols;

        // the map costs a walk of the program; most callers never ask for it
        let sourceMap: UPLCSourceMap | undefined = undefined;
        let debugTable: DebugTable | undefined = undefined;
        return {
            bytes,
            strippedTraces: strippedTraces.length,
            sourceMap: () => sourceMap ??= buildSourceMap({
                program: uplc,
                marks,
                serialized: bytes,
                version: uplcProgram.version,
                compiler: "pebble " + COMPILER_VERSION,
                sourcesContent: cfg.sourceMapContent === true,
                root: cfg.root,
                traces: strippedTraces,
                tracePrograms: compileTracePrograms( strippedTraces, cfg ),
                lambdaSymbols,
            }),
            debugTable: debug === undefined ? undefined : () => debugTable ??= buildDebugTable({
                program: uplc,
                marks,
                debug
            }),
        };
    });
}

/**
 * the programs computing the messages of removed traces (see `StrippedTrace.recipe`), each
 * compiled on its own; `undefined` for a constant message, or one that could not be compiled
 */
function compileTracePrograms( traces: readonly StrippedTrace[], cfg: CompilerOptions ): ( Uint8Array | undefined )[]
{
    return traces.map( t => {
        const recipe = t.recipe;
        if( recipe === undefined ) return undefined;
        const message = recipe.ir.clone();
        // the backend expects a program rooted at a function, or a `delay` (a function without
        // parameters): a message that takes nothing is delayed (`TraceReplay` forces it)
        const ir = message.kind === IRNodeKind.Func ? message : new IRDelayed( message );
        try {
            return withCompilationCtx( new CompilationCtx(), () => compileUPLC( new UPLCProgram(
                cfg.targetUplcVersion,
                compileIRToUPLC( ir, cfg, new Map() )
            )));
        }
        catch( e ) {
            // a message the map cannot compute is shown as its source text
            if( process.env.PEBBLE_DBG_SOURCEMAP ) console.error( "[sourcemap] could not compile a removed trace:", e );
            return undefined;
        }
    });
}

export interface CompiledProgram {
    /** the flat-encoded program */
    bytes: Uint8Array;
    /** how many traces the compiler removed (`removeTraces`); the source map keeps them */
    strippedTraces: number;
    /** built on the first call */
    sourceMap: () => UPLCSourceMap;
    /** built on the first call; only when debug information was collected */
    debugTable: ( () => DebugTable ) | undefined;
}

export interface CompiledWithSourceMap {
    /** the flat-encoded program */
    bytes: Uint8Array;
    sourceMap: UPLCSourceMap;
}

export interface CompiledWithDebugInfo extends CompiledWithSourceMap {
    /** what a debugger needs beyond the source map; never written to a file */
    debugTable: DebugTable;
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

/**
 * Evaluates `term`, the compiled program `body` applied, as the machine does; when the compiler
 * removed traces (`removeTraces`), with the source map, so the logs have them back (and a failure
 * comes located). The evaluation itself is the program's either way.
 */
function evaluateCompiled(
    term: UPLCTerm,
    body: UPLCTerm,
    compiled: CompiledProgram
): { result: CEKValueObj, budgetSpent: ExBudget, logs: string[], failure?: ScriptFailure }
{
    if( compiled.strippedTraces > 0 )
    {
        try {
            const r = evaluateWithSourceMap({ term, program: body, map: compiled.sourceMap() });
            if( r.mapped ) return r;
        }
        catch( e ) {
            if( process.env.PEBBLE_DBG_SOURCEMAP ) console.error( "[sourcemap] could not put the removed traces back:", e );
        }
    }
    const r = Machine.eval( term );
    return { result: r.result, budgetSpent: r.budgetSpent, logs: r.logs.slice() };
}

/**
 * what the compiler says about the traces it removed: kept in the map, except those whose code
 * the optimizer removed with them (it never runs)
 */
function removedTracesNote( map: UPLCSourceMap ): string
{
    const traces = map.traces ?? [];
    const placed = new Set( ( map.tracePoints ?? [] ).map( p => p[1] ) );
    const unplaced = traces.filter( ( _, k ) => !placed.has( k ) );
    let note = `${traces.length} traces removed (removeTraces); the source map keeps them\n`;
    if( unplaced.length > 0 )
    {
        const where = unplaced.map( t => t.at === undefined ? "library code" : `${map.sources[ t.at[0] ]}:${t.at[1]}:${t.at[2]}` );
        note += `  ${unplaced.length} of them have no place left in the program, the code around them was optimized away: ${where.join( ", " )}\n`;
    }
    return note;
}

function failureLocation( failure: ScriptFailure ): Pick<TestError, "location" | "stack">
{
    return failure.location === undefined
        ? { stack: failure.stack }
        : { location: failure.location, stack: failure.stack };
}

/**
 * Where a failing test evaluation failed in the source, from the program's source map;
 * empty when unknown. Locating must never break a test run, so its errors are dropped
 * (set `PEBBLE_DBG_SOURCEMAP` to see them).
 */
function locateTestFailure(
    term: UPLCTerm,
    program: UPLCTerm,
    compiled: CompiledProgram
): Pick<TestError, "location" | "stack">
{
    try {
        const failure = locateFailure({ term, program, map: compiled.sourceMap() });
        if( failure === undefined ) return {};
        return failure.location === undefined
            ? { stack: failure.stack }
            : { location: failure.location, stack: failure.stack };
    }
    catch( e ) {
        if( process.env.PEBBLE_DBG_SOURCEMAP ) console.error( "[sourcemap] could not locate the failure:", e );
        return {};
    }
}

interface HasFuncitonName {
    functionName: string;
}

interface TestDescriptor {
    name: string;
    tirFuncName: string;
    sourceFile: string;
    range: SourceRange;
    paramNames: string[];
    fuzzerInfos: FuzzerInfo[];
}

/** what `_runOneTest` keeps for `debugTest` */
interface TestCapture {
    compiled?: CompiledProgram;
    /** the compiled program's body: what the source map and debug table describe */
    body?: UPLCTerm;
    /** the evaluation to show */
    term?: UPLCTerm;
}

export interface DebugTestResult {
    /** the test's result, as `test` reports it */
    test: TestResult;
    /** the evaluation shown in source terms; `undefined` when the test could not run */
    run: DebugRun | undefined;
    bytes: Uint8Array | undefined;
    sourceMap: UPLCSourceMap | undefined;
    debugTable: DebugTable | undefined;
}

export interface DebugScriptResult extends CompiledWithDebugInfo {
    run: DebugRun;
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