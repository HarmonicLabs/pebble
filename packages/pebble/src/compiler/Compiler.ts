import { compileUPLC, parseUPLC, prettyUPLC, UPLCProgram } from "@harmoniclabs/uplc";
import { Machine } from "@harmoniclabs/plutus-machine";
import { DiagnosticEmitter } from "../diagnostics/DiagnosticEmitter"
import { DiagnosticMessage } from "../diagnostics/DiagnosticMessage";
import { CompilerOptions, defaultOptions } from "../IR/toUPLC/CompilerOptions";
import { AstCompiler } from "./AstCompiler/AstCompiler";
import { CompilerIoApi, createMemoryCompilerIoApi } from "./io/CompilerIoApi";
import { compileTypedProgram } from "./TirCompiler/compileTirProgram";
import { toHex } from "@harmoniclabs/uint8array-utils";
import { __VERY_UNSAFE_FORGET_IRHASH_ONLY_USE_AT_END_OF_UPLC_COMPILATION } from "../IR/IRHash";
import { compileIRToUPLC } from "../IR/toUPLC/compileIRToUPLC";
import { config } from "process";
import { TypedProgram } from "./tir/program/TypedProgram";
import { CheckResult } from "./SourceTypeMap";

export { CheckResult, SourceTypeMap, TypeEntry, MemberInfo } from "./SourceTypeMap";

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
            globalThis.console && console.log( this.diagnostics );
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
            throw new Error("compilation failed with " + nDiags + " diagnostic messages; first message: " + fstErrorMsg );
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
        return Machine.eval( uplcProgram.body );
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
        return Machine.eval( uplcProgram.body );
    }

    private _compileBackend(
        cfg: CompilerOptions,
        program: TypedProgram
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

        const outDir = cfg.outDir;
        const outPath = outDir + ( outDir.endsWith("/") ? "" : "/" ) + "out.flat";
        this.io.writeFile( outPath, serialized, cfg.root );
        this.io.stdout.write( `compiled program written to ${outPath}\n` );

        __VERY_UNSAFE_FORGET_IRHASH_ONLY_USE_AT_END_OF_UPLC_COMPILATION();
        return serialized;
    }
}

interface HasFuncitonName {
    functionName: string;
}

export interface ExportOptions extends CompilerOptions, HasFuncitonName {
    // functionName: string;
}