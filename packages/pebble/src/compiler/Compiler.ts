import { compileUPLC, Force, parseUPLC, prettyUPLC, UPLCProgram } from "@harmoniclabs/uplc";
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
    TestIterationResult,
    TestResult,
    addBudget,
    zeroBudget,
} from "./test/TestResult";

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

    async test( config?: Partial<CompilerOptions> & { nameFilter?: string | RegExp } ): Promise<TestResult[]>
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

        // 1) discovery pass: parse + check, populate program.tests.
        //    diagnostics from this pass are surfaced once; subsequent per-test
        //    passes use their own diagnostic arrays so we don't double-report.
        const discovery = new AstCompiler( cfg, this.io, this.diagnostics );
        const discoveryResult = await discovery.check();

        const descriptors = discoveryResult.program.tests
        .filter( t => matches( t.name ) )
        .map( t => {
            const fn = discoveryResult.program.functions.get( t.tirFuncName );
            const paramsLen = (fn instanceof TirFuncExpr) ? fn.params.length : 0;
            return {
                name: t.name,
                tirFuncName: t.tirFuncName,
                sourceFile: t.sourceFile,
                range: t.range,
                paramsLen,
            };
        });

        const results: TestResult[] = new Array( descriptors.length );
        for( let i = 0; i < descriptors.length; i++ )
        {
            results[i] = await this._runOneTest( cfg, descriptors[i] );
        }
        return results;
    }

    private async _runOneTest(
        cfg: CompilerOptions,
        desc: { name: string; tirFuncName: string; sourceFile: string; range: SourceRange; paramsLen: number }
    ): Promise<TestResult>
    {
        if( desc.paramsLen > 0 )
        {
            return {
                name: desc.name,
                sourceFile: desc.sourceFile,
                range: desc.range,
                kind: "property",
                passed: false,
                iterations: [],
                totalBudget: zeroBudget(),
                skippedReason: "property-based tests are not yet supported",
            };
        }

        // fresh AstCompiler so the expressify pass starts from a clean program
        const localDiagnostics: DiagnosticMessage[] = [];
        const astCompiler = new AstCompiler( cfg, this.io, localDiagnostics );
        await astCompiler.compileFile( cfg.entry, true );

        if( localDiagnostics.some( d => d.category === DiagnosticCategory.Error ) )
        {
            return _failedTestResult(
                desc,
                "compile error: " + localDiagnostics.find( d => d.category === DiagnosticCategory.Error )!.toString()
            );
        }

        const fn = astCompiler.program.functions.get( desc.tirFuncName );
        if(!( fn instanceof TirFuncExpr ))
        {
            return _failedTestResult( desc, `test function "${desc.name}" not found after re-parse` );
        }
        astCompiler.program.contractTirFuncName = desc.tirFuncName;

        let serialized: Uint8Array;
        try {
            serialized = this._compileBackend( cfg, astCompiler.program, true );
        } catch ( err ) {
            return _failedTestResult( desc, "backend error: " + ( err instanceof Error ? err.message : String( err ) ) );
        }

        const uplcProgram = parseUPLC( serialized );
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
    msg: string
): TestResult
{
    const budget = zeroBudget();
    return {
        name: desc.name,
        sourceFile: desc.sourceFile,
        range: desc.range,
        kind: "unit",
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