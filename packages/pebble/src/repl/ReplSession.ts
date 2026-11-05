import { Force, parseUPLC, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKError, ExBudget, locateFailure, Machine, SourceLocation, UPLCSourceMap } from "@harmoniclabs/plutus-machine";
import { AstCompiler } from "../compiler/AstCompiler/AstCompiler";
import { Compiler, compileProgramBackend } from "../compiler/Compiler";
import { CompilerIoApi, createMemoryCompilerIoApi } from "../compiler/io/CompilerIoApi";
import { TirFuncExpr } from "../compiler/tir/expressions/TirFuncExpr";
import { TirType } from "../compiler/tir/types/TirType";
import type { TestResult } from "../compiler/test/TestResult";
import { DiagnosticCategory } from "../diagnostics/DiagnosticCategory";
import { DiagnosticMessage } from "../diagnostics/DiagnosticMessage";
import { DiagnosticCode } from "../diagnostics/diagnosticMessages.generated";
import { projectRelativePath } from "../IR/sourceMap/buildSourceMap";
import { COMPILER_VERSION, CompilerOptions, productionOptions } from "../IR/toUPLC/CompilerOptions";
import { decodeValue, formatValue, typeName, ValueNode } from "../debugger/renderValue";
import { ReplStatement, splitStatements } from "./replSyntax";

/** the function each line compiles to; no Pebble source can declare it */
const REPL_FUNCTION = "__pebble_repl__";

/** where the session's source lives when the options do not say */
export const DEFAULT_REPL_BUFFER = "/__repl__.pebble";

/**
 * what one line may spend unless the options say otherwise: the mainnet limit for a whole
 * transaction (protocol parameter `maxTxExecutionUnits`)
 */
export const DEFAULT_REPL_BUDGET: Readonly<{ cpu: bigint, mem: bigint }> = Object.freeze({
    cpu: 10_000_000_000n,
    mem: 16_500_000n,
});

export interface ReplSessionOptions {
    /** where imports are read from; the session never writes. Default: no files */
    io?: CompilerIoApi;
    /** the project's options (`pebble.config.json` over the defaults); traces are always kept */
    config?: Partial<CompilerOptions>;
    /** the project root, as compiler options take it; default `/` */
    root?: string;
    /**
     * the session's own source, a project path with forward slashes (default `/__repl__.pebble`);
     * relative imports resolve from its directory. Nothing is written there
     */
    bufferPath?: string;
    /** what one line may spend; default `DEFAULT_REPL_BUDGET` */
    budget?: { cpu: bigint, mem: bigint };
}

/** a position in what the user typed */
export interface ReplPosition {
    /** `input`: the line just entered; `session`: an earlier line; `file`: another file */
    readonly in: "input" | "session" | "file";
    /** 1-based, in that text */
    readonly line: number;
    /** 1-based */
    readonly column: number;
    /** characters to underline, at least 1 */
    readonly length: number;
    /** the text of that line */
    readonly lineText: string;
    /** `session`: the session line the declaration was entered on */
    readonly sessionLine?: number;
    /** `file`: the path, relative to the project root */
    readonly path?: string;
}

export interface ReplDiagnostic {
    readonly category: "error" | "warning" | "info";
    readonly code: number;
    readonly message: string;
    readonly position?: ReplPosition;
    /** what the REPL adds: why a name is not defined here, what a contract is for */
    readonly note?: string;
}

export interface ReplFailure {
    /** the machine's message */
    readonly message: string;
    /** the line spent the whole budget */
    readonly outOfBudget: boolean;
    readonly position?: ReplPosition;
    /** the calls open at the failure, innermost first */
    readonly stack: readonly { readonly name?: string, readonly position?: ReplPosition }[];
}

export interface ReplTestResult {
    readonly name: string;
    readonly kind: "unit" | "property";
    readonly passed: boolean;
    /** all runs of the test together */
    readonly budget: { readonly cpu: bigint, readonly mem: bigint };
    readonly runs: number;
    /** of the run reported: the failing one, or else the last */
    readonly logs: readonly string[];
    readonly message?: string;
    readonly position?: ReplPosition;
    /** a property test's failing inputs, as `name = value` */
    readonly inputs?: readonly string[];
    readonly skippedReason?: string;
}

export interface ReplResult {
    /** the line compiled and ran without errors: the session keeps its declarations */
    readonly ok: boolean;
    /** why the line did not compile (then nothing ran) */
    readonly diagnostics: readonly ReplDiagnostic[];
    /** the value the line ended with; none for declarations, statements and `void` */
    readonly value?: { readonly text: string, readonly type: string, readonly node: ValueNode };
    readonly failure?: ReplFailure;
    readonly logs: readonly string[];
    /** what the line's program spent; `undefined` when nothing ran */
    readonly budget?: { readonly cpu: bigint, readonly mem: bigint };
    /** the names the line declared */
    readonly declared: readonly string[];
    /** contracts the line declared */
    readonly contracts: readonly string[];
    /** the tests the line declared, run */
    readonly tests: readonly ReplTestResult[];
}

/** a declaration (or a statement changing a variable) the session keeps */
interface Entry {
    /** a later declaration with the same key replaces this one, in place */
    readonly key: string | undefined;
    /** `file`: at the top of the program; `body`: in the function each line runs */
    readonly place: "file" | "body";
    readonly stmt: ReplStatement;
    /** the session line it was entered on */
    readonly line: number;
    /** a `body` declaration of a name the body already has: the rest of the body goes in a block it opens */
    readonly opensBlock: boolean;
}

/** what a line adds and runs */
interface LinePlan {
    /** the session if the line succeeds */
    readonly entries: Entry[];
    /** the line's statements that go in the function, in order */
    readonly body: { readonly stmt: ReplStatement, readonly opensBlock: boolean }[];
    /** what the function returns */
    readonly result:
        | { readonly kind: "expression", readonly stmt: ReplStatement }
        | { readonly kind: "name", readonly name: string, readonly print: boolean }
        | undefined;
    readonly tests: ReplStatement[];
    readonly declared: string[];
    readonly contracts: string[];
}

type Origin =
    | { readonly kind: "input", readonly offset: number, readonly stmt: ReplStatement }
    | { readonly kind: "session", readonly entry: Entry };

interface Segment {
    readonly start: number;
    readonly end: number;
    readonly origin: Origin;
}

/** a generated source and where each piece of it was typed */
class SourceBuilder
{
    text = "";
    readonly segments: Segment[] = [];

    add( s: string, origin?: Origin ): void
    {
        const start = this.text.length;
        this.text += s;
        if( origin !== undefined ) this.segments.push({ start, end: this.text.length, origin });
    }
}

const NOT_DEFINED = /^'(.+)' is not defined/;

/** a line's program, compiled */
interface CompiledLine {
    readonly body: UPLCTerm;
    readonly sourceMap: () => UPLCSourceMap;
    /** the function's return type: the type of the value the line ends with */
    readonly returnType: TirType | undefined;
}

/**
 * A REPL session: each line runs as one program, made of the session's declarations and the
 * line. Functions, types, contracts, imports and constants that use no `let` are file-level
 * declarations; `let`s, the constants that use them and the statements that change them go in
 * the function each line runs, in order. A line that fails changes nothing.
 *
 * A redeclared file-level name replaces the old declaration; a redeclared `let` (or a constant
 * among them) shadows the old one from there on, as in a block.
 */
export class ReplSession
{
    private entries: Entry[] = [];
    private lineNumber = 0;
    private readonly io: CompilerIoApi;
    private readonly cfg: CompilerOptions;
    private readonly bufferPath: string;
    private readonly root: string;
    private readonly budget: { cpu: bigint, mem: bigint };

    constructor( opts: ReplSessionOptions = {} )
    {
        this.io = opts.io ?? createMemoryCompilerIoApi();
        this.root = opts.root ?? "/";
        this.bufferPath = opts.bufferPath ?? DEFAULT_REPL_BUFFER;
        this.budget = opts.budget ?? DEFAULT_REPL_BUDGET;
        this.cfg = {
            ...productionOptions,
            ...opts.config,
            compilerVersion: COMPILER_VERSION,
            entry: this.bufferPath,
            root: this.root,
            removeTraces: false,
            addMarker: false,
            silent: true,
            sourceMap: true,
        } as CompilerOptions;
    }

    /** forgets every declaration */
    reset(): void
    {
        this.entries = [];
    }

    /** the declarations the session keeps (and the statements changing its `let`s), in the order entered */
    get declarations(): { readonly line: number, readonly text: string }[]
    {
        return this.entries
            .map( ( e, i ) => ({ e, i }) )
            .sort( ( a, b ) => a.e.line - b.e.line || a.i - b.i )
            .map( ({ e }) => ({ line: e.line, text: e.stmt.text }) );
    }

    /** the session's program as the next line would extend it */
    get source(): string
    {
        return this.generateProgram( this.plan( "", this.lineNumber + 1 ), this.lineNumber + 1 ).text;
    }

    async eval( input: string ): Promise<ReplResult>
    {
        const empty: ReplResult = { ok: true, diagnostics: [], logs: [], declared: [], contracts: [], tests: [] };
        if( splitStatements( input ).length === 0 ) return empty;

        const line = ++this.lineNumber;
        const plan = this.plan( input, line );
        const program = this.generateProgram( plan, line );

        const compiled = await this.compile( program, input, plan );
        if( !compiled.ok ) return { ...empty, ok: false, diagnostics: compiled.diagnostics };

        let result: ReplResult = { ...empty, declared: plan.declared, contracts: plan.contracts };
        const runs = plan.body.length > 0 || plan.result !== undefined;
        if( runs )
        {
            result = { ...result, ...this.run( compiled, plan, program, input ) };
            if( !result.ok ) return result;
        }

        if( plan.tests.length > 0 )
        {
            const tested = await this.runTests( plan, line, input );
            if( tested.diagnostics.length > 0 ) return { ...result, ok: false, diagnostics: tested.diagnostics };
            result = { ...result, tests: tested.results };
        }

        this.entries = plan.entries;
        return result;
    }

    private plan( input: string, line: number ): LinePlan
    {
        const stmts = splitStatements( input );
        let entries = this.entries.slice();
        const body: { stmt: ReplStatement, opensBlock: boolean }[] = [];
        const tests: ReplStatement[] = [];
        const declared: string[] = [];
        const contracts: string[] = [];
        let result: LinePlan["result"] = undefined;

        const bodyVariables = () => new Set( entries.filter( e => e.place === "body" ).flatMap( e => e.stmt.names ) );
        const upsert = ( entry: Entry ) => {
            const at = entry.key === undefined ? -1 : entries.findIndex( e => e.key === entry.key );
            if( at >= 0 ) entries[at] = entry;
            else entries.push( entry );
        };

        stmts.forEach( ( stmt, i ) => {
            const last = i === stmts.length - 1;
            switch( stmt.kind )
            {
                case "import":
                case "using":
                    upsert({ key: stmt.kind + ":" + stmt.text.replace( /\s+/g, " " ), place: "file", stmt, line, opensBlock: false });
                    return;
                case "type":
                case "function":
                case "contract":
                    upsert({ key: stmt.names.length > 0 ? stmt.kind + ":" + stmt.names[0] : undefined, place: "file", stmt, line, opensBlock: false });
                    declared.push( ...stmt.names );
                    if( stmt.kind === "contract" ) contracts.push( ...stmt.names );
                    return;
                case "test":
                    tests.push( stmt );
                    return;
                case "const":
                case "let": {
                    const vars = bodyVariables();
                    const redeclares = stmt.names.some( n => vars.has( n ) );
                    // functions, contracts and tests can use a constant only at file level
                    const fileLevel = (
                        stmt.kind === "const" && stmt.names.length === 1 && !redeclares
                        && !stmt.uses.some( n => vars.has( n ) )
                    );
                    if( fileLevel ) upsert({ key: "const:" + stmt.names[0], place: "file", stmt, line, opensBlock: false });
                    else {
                        // the names now belong to the body
                        entries = entries.filter( e => !( e.place === "file" && stmt.names.some( n => e.key === "const:" + n ) ) );
                        entries.push({ key: undefined, place: "body", stmt, line, opensBlock: redeclares });
                        body.push({ stmt, opensBlock: redeclares });
                    }
                    declared.push( ...stmt.names );
                    // computed on its line, so its errors show there
                    if( last && stmt.names.length > 0 ) result = { kind: "name", name: stmt.names[ stmt.names.length - 1 ], print: false };
                    return;
                }
                default: {
                    if( last && stmt.kind === "expression" ) { result = { kind: "expression", stmt }; return; }
                    const vars = bodyVariables();
                    // a statement that changes a variable is kept, so later lines see the change
                    if( stmt.assigns.some( n => vars.has( n ) ) ) entries.push({ key: undefined, place: "body", stmt, line, opensBlock: false });
                    body.push({ stmt, opensBlock: false });
                    if( last && stmt.kind === "assignment" && vars.has( stmt.assigns[0] ) )
                    result = { kind: "name", name: stmt.assigns[0], print: true };
                    return;
                }
            }
        });

        return { entries, body, result, tests, declared, contracts };
    }

    /** the file-level entries, imports first */
    private fileEntries( entries: readonly Entry[] ): Entry[]
    {
        const file = entries.filter( e => e.place === "file" );
        return [ ...file.filter( e => e.stmt.kind === "import" ), ...file.filter( e => e.stmt.kind !== "import" ) ];
    }

    private origin( e: Entry, line: number ): Origin
    {
        return e.line === line ? { kind: "input", offset: e.stmt.start, stmt: e.stmt } : { kind: "session", entry: e };
    }

    private generateProgram( plan: LinePlan, line: number ): SourceBuilder
    {
        const b = new SourceBuilder();
        for( const e of this.fileEntries( plan.entries ) ) emitStatement( b, e.stmt, this.origin( e, line ) );

        b.add( `function ${REPL_FUNCTION}() {\n` );
        let blocks = 0;
        const statement = ( stmt: ReplStatement, opensBlock: boolean, origin: Origin ) => {
            if( opensBlock ) { b.add( "{\n" ); blocks++; }
            emitStatement( b, stmt, origin );
        };
        for( const e of plan.entries )
            if( e.place === "body" && e.line !== line ) statement( e.stmt, e.opensBlock, this.origin( e, line ) );
        for( const s of plan.body ) statement( s.stmt, s.opensBlock, { kind: "input", offset: s.stmt.start, stmt: s.stmt } );

        if( plan.result?.kind === "expression" )
        {
            const stmt = plan.result.stmt;
            b.add( "return " );
            b.add( withoutSemicolon( stmt.text ), { kind: "input", offset: stmt.start, stmt } );
            b.add( ";\n" );
        }
        else if( plan.result?.kind === "name" ) b.add( `return ${plan.result.name};\n` );

        b.add( "}\n".repeat( blocks ) + "}\n" );
        return b;
    }

    private generateTests( plan: LinePlan, line: number ): SourceBuilder
    {
        const b = new SourceBuilder();
        for( const e of this.fileEntries( plan.entries ) ) emitStatement( b, e.stmt, this.origin( e, line ) );
        for( const t of plan.tests ) emitStatement( b, t, { kind: "input", offset: t.start, stmt: t } );
        return b;
    }

    /** an IO that reads `text` as the session's source and the project's files as they are */
    private overlayIo( text: string ): CompilerIoApi
    {
        const base = this.io;
        const isBuffer = ( f: string ) => samePath( f, this.bufferPath );
        return {
            stdout: { write() {} },
            stderr: { write() {} },
            readFile: ( f, baseDir ) => isBuffer( f ) ? text : base.readFile( f, baseDir ),
            // a line writes nothing: with filesystem access it would overwrite the project's outputs
            writeFile: () => {},
            exsistSync: f => isBuffer( f ) || base.exsistSync( f ),
            listFiles: ( d, baseDir ) => base.listFiles( d, baseDir ),
            reportDiagnostic: () => {},
        };
    }

    private async compile( program: SourceBuilder, input: string, plan: LinePlan ): Promise<
        | ( { ok: true } & CompiledLine )
        | { ok: false, diagnostics: ReplDiagnostic[] }
    >
    {
        const cfg = { ...this.cfg };
        const diagnostics: DiagnosticMessage[] = [];
        try {
            const astCompiler = new AstCompiler( cfg, this.overlayIo( program.text ), diagnostics );
            const typed = await astCompiler.export( REPL_FUNCTION );
            if( diagnostics.some( d => d.category === DiagnosticCategory.Error ) )
            return { ok: false, diagnostics: this.mapDiagnostics( diagnostics, program, input, plan ) };

            const fn = typed.functions.get( typed.contractTirFuncName );
            const returnType = fn instanceof TirFuncExpr ? fn.returnType : undefined;
            const compiled = compileProgramBackend( cfg, typed );
            return { ok: true, body: parseUPLC( compiled.bytes ).body, sourceMap: compiled.sourceMap, returnType };
        }
        catch( e ) {
            const errors = diagnostics.filter( d => d.category === DiagnosticCategory.Error );
            if( errors.length > 0 ) return { ok: false, diagnostics: this.mapDiagnostics( diagnostics, program, input, plan ) };
            return { ok: false, diagnostics: [{
                category: "error",
                code: 0,
                message: "the compiler failed: " + ( e instanceof Error ? e.message : String( e ) ),
            }] };
        }
    }

    private run(
        compiled: CompiledLine,
        plan: LinePlan,
        program: SourceBuilder,
        input: string
    ): Pick<ReplResult, "ok" | "value" | "failure" | "logs" | "budget">
    {
        // the function has no parameters: its program is a `delay`
        const term = new Force( compiled.body );
        const machine = new Machine( undefined, new ExBudget( this.budget ) );
        const { result, budgetSpent, logs } = machine.eval( term );
        const budget = { cpu: budgetSpent.cpu, mem: budgetSpent.mem };

        if( result instanceof CEKError )
        {
            const message = result.msg ?? "explicit error from uplc";
            let position: ReplPosition | undefined = undefined;
            let stack: ReplFailure["stack"] = [];
            try {
                const failure = locateFailure({ term, program: compiled.body, map: compiled.sourceMap(), budget: new ExBudget( this.budget ) });
                if( failure !== undefined )
                {
                    position = this.locationPosition( failure.location, program, input );
                    stack = failure.stack
                        // the line's own function is the session's, not the user's
                        .filter( f => f.functionName !== REPL_FUNCTION )
                        .map( f => ({ name: f.functionName, position: this.locationPosition( f.location, program, input ) }) );
                }
            }
            catch {
                // locating must never hide the failure itself
            }
            return {
                ok: false,
                logs: logs.slice(),
                budget,
                failure: { message, outOfBudget: message === "out of budget", position, stack },
            };
        }

        const shows = plan.result === undefined || plan.result.kind === "expression" || plan.result.print;
        const node = decodeValue( result, compiled.returnType );
        const value = shows && node.kind !== "unit"
            ? { text: formatValue( node ), type: typeName( compiled.returnType ), node }
            : undefined;
        return { ok: true, logs: logs.slice(), budget, value };
    }

    private async runTests( plan: LinePlan, line: number, input: string ): Promise<{ results: ReplTestResult[], diagnostics: ReplDiagnostic[] }>
    {
        const source = this.generateTests( plan, line );
        const compiler = new Compiler( this.overlayIo( source.text ), { ...this.cfg } );
        let results: TestResult[];
        try {
            results = await compiler.test({});
        }
        catch( e ) {
            return { results: [], diagnostics: [{ category: "error", code: 0, message: "the tests failed to run: " + ( e instanceof Error ? e.message : String( e ) ) }] };
        }
        if( compiler.diagnostics.some( d => d.category === DiagnosticCategory.Error ) )
        return { results: [], diagnostics: this.mapDiagnostics( compiler.diagnostics, source, input, plan ) };

        return {
            diagnostics: [],
            results: results.map( r => {
                // a failed property test's last run has its (smallest) failing inputs
                const last = r.iterations[ r.iterations.length - 1 ];
                const failing = r.passed ? undefined : last;
                return {
                    name: r.name,
                    kind: r.kind,
                    passed: r.passed,
                    budget: { cpu: r.totalBudget.cpu, mem: r.totalBudget.mem },
                    runs: r.iterations.length,
                    logs: last?.logs ?? [],
                    ...( failing?.error?.msg === undefined ? {} : { message: failing.error.msg } ),
                    ...( failing?.error?.location === undefined ? {} : { position: this.locationPosition( failing.error.location, source, input ) } ),
                    ...( failing?.inputs === undefined ? {} : { inputs: failing.inputs.map( x => `${x.name} = ${showInput( x.value )}` ) } ),
                    ...( r.skippedReason === undefined ? {} : { skippedReason: r.skippedReason } ),
                };
            }),
        };
    }

    private mapDiagnostics( diagnostics: readonly DiagnosticMessage[], source: SourceBuilder, input: string, plan: LinePlan ): ReplDiagnostic[]
    {
        return diagnostics.map( d => this.mapDiagnostic( d, source, input, plan ) );
    }

    private mapDiagnostic( d: DiagnosticMessage, source: SourceBuilder, input: string, plan: LinePlan ): ReplDiagnostic
    {
        const category = (
            d.category === DiagnosticCategory.Error ? "error" :
            d.category === DiagnosticCategory.Warning ? "warning" :
            "info"
        );
        const r = d.range;
        let position: ReplPosition | undefined = undefined;
        let origin: Origin | undefined = undefined;
        if( r !== undefined && r.source !== undefined )
        {
            const length = Math.max( 1, r.end - r.start );
            if( samePath( r.source.absoluteProjPath, this.bufferPath ) )
            {
                origin = segmentAt( source, r.start )?.origin;
                position = this.position( source, r.start, length, input );
            }
            else position = filePosition(
                projectRelativePath( r.source.absoluteProjPath, this.root ),
                r.source.text,
                r.start,
                length
            );
        }
        const note = noteFor( d, origin, plan.entries );
        return {
            category,
            code: d.code,
            message: d.message,
            ...( position === undefined ? {} : { position } ),
            ...( note === undefined ? {} : { note } ),
        };
    }

    /** a generated offset in what the user typed */
    private position( source: SourceBuilder, offset: number, length: number, input: string ): ReplPosition | undefined
    {
        const segment = segmentAt( source, offset );
        if( segment === undefined ) return undefined;
        const delta = offset - segment.start;
        const len = Math.max( 1, Math.min( length, segment.end - offset ) );
        if( segment.origin.kind === "input" ) return textPosition( "input", input, segment.origin.offset + delta, len );
        const entry = segment.origin.entry;
        return { ...textPosition( "session", entry.stmt.text, delta, len ), sessionLine: entry.line };
    }

    /** a source map location: in the session's source, or in another file */
    private locationPosition( location: SourceLocation | undefined, source: SourceBuilder, input: string ): ReplPosition | undefined
    {
        if( location === undefined ) return undefined;
        if( location.source !== projectRelativePath( this.bufferPath ) )
        return { in: "file", path: location.source, line: location.line, column: location.column, length: 1, lineText: "" };
        const lineStarts = [ 0 ];
        for( let i = 0; i < source.text.length; i++ ) if( source.text[i] === "\n" ) lineStarts.push( i + 1 );
        const offset = ( lineStarts[ location.line - 1 ] ?? 0 ) + location.column - 1;
        const length = location.endLine === location.line ? Math.max( 1, location.endColumn - location.column ) : 1;
        return this.position( source, offset, length, input );
    }
}

/** what the REPL can add to a diagnostic: why a name is not defined where it is used */
function noteFor( d: DiagnosticMessage, origin: Origin | undefined, entries: readonly Entry[] ): string | undefined
{
    if( d.code !== DiagnosticCode._0_is_not_defined ) return undefined;
    const name = NOT_DEFINED.exec( d.message )?.[1];
    if( name === undefined ) return undefined;
    if( entries.some( e => e.stmt.kind === "contract" && e.stmt.names.includes( name ) ) )
    return `${name} is a contract: its methods need a script context, so they run under \`pebble test\`, not here`;
    const where = origin === undefined ? undefined : origin.kind === "input" ? origin.stmt : origin.entry.stmt;
    const inFileLevelCode = where !== undefined && FILE_LEVEL_KINDS.has( where.kind );
    if( inFileLevelCode && entries.some( e => e.place === "body" && e.stmt.names.includes( name ) ) )
    return `${name} is a \`let\` of this session, or a constant that uses one: functions, contracts and tests can only use constants made of other constants`;
    return undefined;
}

const FILE_LEVEL_KINDS = new Set<ReplStatement["kind"]>([ "function", "contract", "test", "const", "type" ]);

/** a statement on its own line(s), with the `;` it needs */
function emitStatement( b: SourceBuilder, stmt: ReplStatement, origin: Origin ): void
{
    b.add( stmt.text, origin );
    if( needsSemicolon( stmt ) ) b.add( ";" );
    b.add( "\n" );
}

function needsSemicolon( stmt: ReplStatement ): boolean
{
    const text = stmt.text.trimEnd();
    if( text.endsWith( ";" ) ) return false;
    switch( stmt.kind )
    {
        case "function": case "type": case "contract": case "test": return false;
        case "statement": return !text.endsWith( "}" );
        default: return true;
    }
}

function withoutSemicolon( text: string ): string
{
    return text.replace( /\s*;\s*$/, "" );
}

function segmentAt( source: SourceBuilder, offset: number ): Segment | undefined
{
    return source.segments.find( s => offset >= s.start && offset < s.end )
        ?? source.segments.find( s => offset === s.end );
}

function samePath( a: string, b: string ): boolean
{
    const norm = ( p: string ) => p.replace( /\\/g, "/" ).replace( /^\/+/, "" );
    return norm( a ) === norm( b );
}

function textPosition( where: "input" | "session", text: string, offset: number, length: number ): ReplPosition
{
    const before = text.slice( 0, offset );
    const line = before.split( "\n" ).length;
    const lineStart = before.lastIndexOf( "\n" ) + 1;
    const lineEnd = text.indexOf( "\n", lineStart );
    const lineText = text.slice( lineStart, lineEnd < 0 ? text.length : lineEnd );
    const column = offset - lineStart + 1;
    return { in: where, line, column, length: Math.max( 1, Math.min( length, lineText.length - column + 1 ) ), lineText };
}

function filePosition( path: string, text: string, offset: number, length: number ): ReplPosition
{
    return { ...textPosition( "input", text, offset, length ), in: "file", path };
}

function showInput( value: unknown ): string
{
    if( value instanceof Uint8Array ) return "#" + Array.from( value, b => b.toString( 16 ).padStart( 2, "0" ) ).join( "" );
    if( typeof value === "string" ) return value;
    return String( value );
}
