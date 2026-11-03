import { CEKError } from "@harmoniclabs/plutus-machine";
import type { SourceRange } from "../ast/Source/SourceRange";
import { projectRelativePath } from "../IR/sourceMap/buildSourceMap";
import type { DebugFrame, DebugRun, DebugStackFrame, DebugStep, DebugVariable } from "./DebugRun";
import { decodeValue, formatValue, FormatOptions, typeName, valueToJson } from "./renderValue";

/*
 * A recorded run as text (for people) and JSON (for tools and AI agents): `pebble debug` prints
 * these; the VS Code debug adapter shows the same steps and variables.
 */

export interface SourcePosition {
    /** project-relative path */
    file: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
}

export function positionOf( range: SourceRange, root?: string ): SourcePosition
{
    const src = range.source;
    const line = src.lineAt( range.start );
    const column = src.columnAt();
    const endLine = src.lineAt( range.end );
    const endColumn = src.columnAt();
    return { file: projectRelativePath( src.absoluteProjPath, root ), line, column, endLine, endColumn };
}

/**
 * the first line of the statement's text; for a pattern the compiler kept from a larger
 * statement (a contract method's `const { tx, state: { deadline } } = context;`), that line
 */
export function stmtText( range: SourceRange ): string
{
    const text = range.source.text;
    const lineStart = text.lastIndexOf( "\n", range.start - 1 ) + 1;
    const before = text.slice( lineStart, range.start ).trimEnd();
    const from = /[:,]$/.test( before ) ? lineStart : range.start;
    return text.slice( from, range.end ).split( "\n" )[0].trim();
}

export interface DebugVariableJson {
    name: string;
    type: string;
    /** `"value"`, `"not evaluated"` (the run never needed it) or `"optimized out"` */
    status: string;
    /** the value as JSON (see `valueToJson`); missing without one */
    value?: unknown;
    /** the value in Pebble syntax */
    text?: string;
}

export interface DebugStepJson extends SourcePosition {
    /** 1-based */
    step: number;
    /** the statement's first line */
    source: string;
    kind: string;
    /** function (contract method) the statement is in */
    function: string;
    /** calls open, the outermost counting 1 (loop iterations do not count) */
    depth: number;
    /** for a statement in a loop, which iteration (1-based) */
    iteration?: number;
    failed: boolean;
    /** budget spent by the statement itself, not by the calls it makes */
    budget: { cpu: number, mem: number };
    /** the variables the statement declares, with their values */
    declares: DebugVariableJson[];
    /** for the `return` that ends a call: the value returned */
    returns?: { value: unknown, text: string };
    /** the variables in scope before it runs (only for the steps asked for) */
    variables?: DebugVariableJson[];
    /** the open calls, innermost first (only for the steps asked for) */
    stack?: { function: string, file?: string, line?: number, column?: number, source?: string }[];
}

export interface DebugRunJson {
    result: {
        passed: boolean;
        /** the machine's error message */
        error?: string;
        logs: string[];
        budget: { cpu: number, mem: number };
        /** machine states recorded */
        states: number;
        /** `false` when the recording stopped before the evaluation ended */
        complete: boolean;
    };
    /** 1-based step the run failed at; missing when it did not fail there */
    failedStep?: number;
    steps: DebugStepJson[];
}

export interface DebugReportOptions {
    /** project root: paths are made relative to it */
    root?: string;
    /** include variables and stack for every step (default: only the failed step and `step`) */
    allVariables?: boolean;
    /** 1-based step to include variables and stack for */
    step?: number;
    /** value formatting for the text form (default: short values) */
    format?: FormatOptions;
}

const SHORT: FormatOptions = { maxDepth: 2, maxItems: 4, maxBytes: 16 };

export function variableJson( v: DebugVariable, format?: FormatOptions ): DebugVariableJson
{
    const out: DebugVariableJson = { name: v.v.name, type: typeName( v.v.type ), status: v.status };
    if( v.status === "value" && v.value !== undefined )
    {
        const node = decodeValue( v.value, v.v.type );
        out.value = valueToJson( node );
        out.text = formatValue( node, format );
    }
    return out;
}

export function stackJson( run: DebugRun, stack: DebugStackFrame[], root?: string ): NonNullable<DebugStepJson["stack"]>
{
    return stack.map( f => {
        if( f.stmt === undefined ) return { function: f.name };
        const p = positionOf( f.stmt.range, root );
        return { function: f.name, file: p.file, line: p.line, column: p.column, source: stmtText( f.stmt.range ) };
    });
}

export function stepJson( run: DebugRun, step: DebugStep, opts: DebugReportOptions = {} ): DebugStepJson
{
    const p = positionOf( step.stmt.range, opts.root );
    const out: DebugStepJson = {
        step: step.index + 1,
        ...p,
        source: stmtText( step.stmt.range ),
        kind: step.stmt.kind,
        function: run.frameName( step.frame, step.stmt ),
        depth: step.depth,
        failed: step.failed,
        budget: { cpu: step.cpu, mem: step.mem },
        declares: run.declaredAt( step.index ).map( v => variableJson( v ) ),
    };
    if( step.frame.fn.kind === "loop" ) out.iteration = step.frame.iteration;
    if( step.returned !== undefined )
    {
        const node = decodeValue( step.returned, functionFrame( step.frame ).fn.returnType );
        out.returns = { value: valueToJson( node ), text: formatValue( node ) };
    }
    const detailed = opts.allVariables === true || step.failed || opts.step === step.index + 1;
    if( detailed )
    {
        out.variables = run.variablesAt( step.index ).map( v => variableJson( v ) );
        out.stack = stackJson( run, run.stackAt( step.index ), opts.root );
    }
    return out;
}

export function debugRunToJson( run: DebugRun, opts: DebugReportOptions = {} ): DebugRunJson
{
    const rec = run.recording;
    const result: DebugRunJson["result"] = {
        passed: !rec.failed,
        logs: rec.logs.slice(),
        budget: { cpu: Number( rec.budgetSpent.cpu ), mem: Number( rec.budgetSpent.mem ) },
        states: rec.length,
        complete: rec.complete,
    };
    if( rec.result instanceof CEKError ) result.error = rec.result.msg ?? "error";
    const json: DebugRunJson = {
        result,
        steps: run.steps.map( s => stepJson( run, s, opts ) ),
    };
    if( run.failedStep >= 0 ) json.failedStep = run.failedStep + 1;
    return json;
}

/**
 * The run as text: one line per step, indented by call depth, with the values the statement
 * declares; a call shows its function's name where it starts; the failed step (and `step`,
 * when asked) also lists the variables in scope.
 */
export function formatDebugRun( run: DebugRun, opts: DebugReportOptions = {} ): string
{
    const format = opts.format ?? SHORT;
    const lines: string[] = [];
    const width = String( run.steps.length ).length + 1;
    const started = new Set<DebugFrame>();
    let topName = "";
    for( const step of run.steps )
    {
        const p = positionOf( step.stmt.range, opts.root );
        const indent = "  ".repeat( Math.max( 0, step.depth - 1 ) );
        const fnFrame = functionFrame( step.frame );
        const name = run.frameName( step.frame, step.stmt );
        if( step.depth === 1 )
        {
            if( name !== topName ) lines.push( `${name}  ${p.file}` );
            topName = name;
        }
        else if( !started.has( fnFrame ) ) lines.push( `${" ".repeat( 3 + width + 6 )}${"  ".repeat( step.depth - 2 )}→ ${name}  ${p.file}` );
        started.add( fnFrame );

        const statement = indent + stmtText( step.stmt.range );
        const notes: string[] = [];
        const declared = run.declaredAt( step.index ).map( v => `${v.v.name} = ${valueText( v, format )}` ).join( ", " );
        if( declared.length > 0 ) notes.push( declared );
        if( step.returned !== undefined ) notes.push( "returns " + formatValue( decodeValue( step.returned, fnFrame.fn.returnType ), format ) );
        if( step.frame.fn.kind === "loop" ) notes.push( `(iteration ${step.frame.iteration})` );
        if( step.failed ) notes.push( "<- failed" );
        lines.push(
            `  #${String( step.index + 1 ).padEnd( width )}${String( p.line ).padStart( 4 )}  ` +
            ( notes.length > 0 ? statement.padEnd( 48 ) + "  " + notes.join( "  " ) : statement )
        );
        if( step.failed || opts.allVariables === true || opts.step === step.index + 1 )
        {
            const pad = " ".repeat( 3 + width + 6 ) + indent + "  ";
            for( const v of run.variablesAt( step.index ) ) lines.push( `${pad}${v.v.name} = ${valueText( v, format )}` );
        }
    }
    const rec = run.recording;
    const budget = `cpu ${rec.budgetSpent.cpu}, mem ${rec.budgetSpent.mem}`;
    if( rec.result instanceof CEKError ) lines.push( `failed: ${rec.result.msg ?? "error"} (${budget})` );
    else lines.push( `passed (${budget})` );
    for( const log of rec.logs ) lines.push( `trace: ${log}` );
    if( !rec.complete ) lines.push( `(the recording stopped after ${rec.length} states; later steps are missing)` );
    return lines.join( "\n" );
}

/** the function call a frame is part of: a loop iteration belongs to its function's */
function functionFrame( frame: DebugFrame ): DebugFrame
{
    let f = frame;
    while( f.fn.kind === "loop" && f.parent !== undefined ) f = f.parent;
    return f;
}

/**
 * One step in full: where it is, the open calls, and every variable in scope with its whole
 * value (`pebble debug --step N`).
 */
export function formatDebugStep( run: DebugRun, stepNumber: number, opts: DebugReportOptions = {} ): string
{
    const step = run.steps[ stepNumber - 1 ];
    if( step === undefined ) return `no step ${stepNumber} (the run has ${run.steps.length})`;
    const format = opts.format ?? {};
    const p = positionOf( step.stmt.range, opts.root );
    const lines: string[] = [];
    lines.push( `step ${stepNumber} of ${run.steps.length}${step.failed ? " (failed here)" : ""}` );
    lines.push( `  ${p.file}:${p.line}:${p.column}  ${stmtText( step.stmt.range )}` );
    lines.push( "stack:" );
    for( const f of run.stackAt( step.index ) )
    {
        const at = f.stmt === undefined ? "" : ( () => { const q = positionOf( f.stmt!.range, opts.root ); return `  ${q.file}:${q.line}:${q.column}  ${stmtText( f.stmt!.range )}`; })();
        lines.push( `  ${f.name}${at}` );
    }
    const declared = run.declaredAt( step.index );
    if( declared.length > 0 )
    {
        lines.push( "declares:" );
        for( const v of declared ) lines.push( `  ${v.v.name}: ${typeName( v.v.type )} = ${valueText( v, format )}` );
    }
    lines.push( "variables:" );
    const vars = run.variablesAt( step.index );
    if( vars.length === 0 ) lines.push( "  (none)" );
    for( const v of vars ) lines.push( `  ${v.v.name}: ${typeName( v.v.type )} = ${valueText( v, format )}` );
    lines.push( `budget of the statement: cpu ${step.cpu}, mem ${step.mem}` );
    return lines.join( "\n" );
}

export function valueText( v: DebugVariable, format?: FormatOptions ): string
{
    if( v.status !== "value" || v.value === undefined ) return `<${v.status}>`;
    return formatValue( decodeValue( v.value, v.v.type ), format );
}
