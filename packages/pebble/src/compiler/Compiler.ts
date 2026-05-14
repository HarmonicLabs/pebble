import { Application, compileUPLC, Force, parseUPLC, prettyUPLC, UPLCConst, UPLCProgram, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKError, Machine } from "@harmoniclabs/plutus-machine";
import { DiagnosticCategory } from "../diagnostics/DiagnosticCategory";
import { DiagnosticEmitter } from "../diagnostics/DiagnosticEmitter"
import { DiagnosticMessage } from "../diagnostics/DiagnosticMessage";
import { CompilerOptions, defaultOptions } from "../IR/toUPLC/CompilerOptions";
import { AstCompiler } from "./AstCompiler/AstCompiler";
import { CompilerIoApi, createMemoryCompilerIoApi } from "./io/CompilerIoApi";
import { compileTypedProgram } from "./TirCompiler/compileTirProgram";
import { toHex } from "@harmoniclabs/uint8array-utils";
import { __VERY_UNSAFE_FORGET_IRHASH_ONLY_USE_AT_END_OF_UPLC_COMPILATION } from "../IR/IRHash";
import { __VERY_UNSAFE_FORGET_VAR_SYM_HASHES_ONLY_USE_AT_END_OF_UPLC_COMPILATION } from "../IR/IRNodes/utils/hashVarSym";
import { __unsafe_clear_hoisted_hash_to_symbol } from "../IR/IRNodes/IRHoisted";
import { __unsafe_clear_letted_hash_to_symbol } from "../IR/IRNodes/IRLetted";
import { __unsafe_clear_hoisted_cache } from "../IR/toUPLC/subRoutines/replaceHoistedWithLetted";
import { __unsafe_clear_mapToType_cache } from "./TirCompiler/expressify/expressifyVars";
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
        readonly cfg: CompilerOptions = defaultOptions,
        diagnostics?: DiagnosticMessage[]
    )
    {
        super( diagnostics );
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
            // globalThis.console && console.log( this.diagnostics );
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
        if( this.diagnostics.length > 0 ) {
            let msg: DiagnosticMessage;
            globalThis.console && console.log( this.diagnostics );
            const fstErrorMsg = this.diagnostics[0].toString();
            const nDiags = this.diagnostics.length;
            while( msg = this.diagnostics.shift()! ) {
                this.io.stdout.write( msg.toString() + "\n" );
            }
            // throw new Error("compilation failed with " + nDiags + " diagnostic messages; first message: " + fstErrorMsg );
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
            globalThis.console && console.log( this.diagnostics );
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
        // Check that every parameter has an executable fuzzer in v1 (Phase 1).
        const unsupported = desc.fuzzerInfos.find( fi =>
            fi.kind === "unsupported" || fi.kind === "via_not_implemented"
        );
        if( unsupported )
        {
            const reason = unsupported.kind === "via_not_implemented"
                ? "user-defined fuzzers via the 'via' keyword are not yet executable (Phase 2)"
                : (unsupported as { kind: "unsupported"; reason: string }).reason;
            return {
                name: desc.name,
                sourceFile: desc.sourceFile,
                range: desc.range,
                kind: "property",
                passed: false,
                iterations: [],
                totalBudget: zeroBudget(),
                skippedReason: reason,
                seed,
            };
        }

        // Run N iterations with TS-side sampling.
        const prng = new PRNG( seed );
        const iterations: TestIterationResult[] = [];
        let totalBudget = zeroBudget();
        let passedAll = true;

        for( let i = 0; i < propertyIterations; i++ )
        {
            const inputs: TestInput[] = [];
            const args: UPLCTerm[] = [];
            for( let p = 0; p < desc.fuzzerInfos.length; p++ )
            {
                const fi = desc.fuzzerInfos[p];
                if( fi.kind !== "primitive" ) throw new Error("unreachable: non-primitive after unsupported check");
                const paramName = desc.paramNames[p] ?? `param${p}`;
                if( fi.primitive === "int" )
                {
                    const v = prng.nextIntBiased();
                    inputs.push({ name: paramName, value: v });
                    args.push( UPLCConst.int( v ) );
                }
                else // bool
                {
                    const v = prng.nextBool();
                    inputs.push({ name: paramName, value: v });
                    args.push( UPLCConst.bool( v ) );
                }
            }

            let app: UPLCTerm = uplcProgram.body;
            for( const arg of args ) app = new Application( app, arg );

            const evalResult = Machine.eval( app );
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
                inputs,
            };
            iterations.push( iter );
            totalBudget = addBudget( totalBudget, budget );

            if( isErr )
            {
                passedAll = false;
                break; // early exit on first failure (Phase 1; shrinking is Phase 2)
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
            globalThis.console && console.log( this.diagnostics );
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
        // backend starts here
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

        __VERY_UNSAFE_FORGET_IRHASH_ONLY_USE_AT_END_OF_UPLC_COMPILATION();
        __VERY_UNSAFE_FORGET_VAR_SYM_HASHES_ONLY_USE_AT_END_OF_UPLC_COMPILATION();
        __unsafe_clear_hoisted_hash_to_symbol();
        __unsafe_clear_letted_hash_to_symbol();
        __unsafe_clear_hoisted_cache();
        __unsafe_clear_mapToType_cache();
        return serialized;
    }
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