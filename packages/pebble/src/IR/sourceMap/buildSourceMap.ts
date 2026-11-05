import { indexProgram, ProgramIndex, UPLCSourceMap, UPLCSourceMapAssert, UPLCSourceMapFailure, UPLCSourceMapFunction, UPLCSourceMapInlinedCall, UPLCSourceMapping, UPLCSourceMapTrace, UPLCSourceMapTracePoint } from "@harmoniclabs/plutus-machine";
import { blake2b_256 } from "@harmoniclabs/crypto";
import { toHex } from "@harmoniclabs/uint8array-utils";
import { Lambda, UPLCTerm, UPLCVersion } from "@harmoniclabs/uplc";
import type { Source } from "../../ast/Source/Source";
import type { SourceRange } from "../../ast/Source/SourceRange";
import { isSourceRange } from "./irRanges";
import type { StrippedTrace } from "./irTraces";
import type { UplcMarks } from "./uplcMarks";

export interface BuildSourceMapArgs {
    /** body of the compiled program, as `compileIRToUPLC` returned it */
    program: UPLCTerm;
    /** what `compileIRToUPLC` recorded while producing `program` */
    marks: UplcMarks;
    /** the flat-encoded program: the content of `out.flat` */
    serialized: Uint8Array;
    version: UPLCVersion;
    /** e.g. `pebble 0.6.0` */
    compiler: string;
    /** include the text of every source, for code frames */
    sourcesContent?: boolean;
    /** project root: source paths are written relative to it, so maps hold no local directories */
    root?: string;
    /** the traces the compiler removed (`removeTraces`) */
    traces?: readonly StrippedTrace[];
    /** for each of `traces` with a computed message: its program, flat-encoded */
    tracePrograms?: readonly ( Uint8Array | undefined )[];
    /** the IR variable each lambda of `program` binds (computed messages read them) */
    lambdaSymbols?: ReadonlyMap<object, symbol>;
}

/**
 * The source map (`plutus-machine`'s format, version 1) of a compiled program.
 * Only user sources appear: library code and synthetic nodes have no location.
 */
export function buildSourceMap( args: BuildSourceMapArgs ): UPLCSourceMap
{
    const index = indexProgram( args.program );

    const sources: Source[] = [];
    const sourceIndices = new Map<Source, number>();
    const sourceIndexOf = ( range: SourceRange ): number => {
        let idx = sourceIndices.get( range.source );
        if( idx === undefined )
        {
            idx = sources.length;
            sources.push( range.source );
            sourceIndices.set( range.source, idx );
        }
        return idx;
    };

    const names: string[] = [];
    const nameIndices = new Map<string, number>();
    const nameIndexOf = ( name: string ): number => {
        let idx = nameIndices.get( name );
        if( idx === undefined )
        {
            idx = names.length;
            names.push( name );
            nameIndices.set( name, idx );
        }
        return idx;
    };

    const mappings: UPLCSourceMapping[] = [];
    const functions: UPLCSourceMapFunction[] = [];
    const asserts: UPLCSourceMapAssert[] = [];
    const inlinedCalls: UPLCSourceMapInlinedCall[] = [];
    const failures: UPLCSourceMapFailure[] = [];
    const tracePoints: UPLCSourceMapTracePoint[] = [];
    const removedTraces = args.traces ?? [];

    for( let i = 0; i < index.terms.length; i++ )
    {
        const mark = args.marks.get( index.terms[i] );
        if( mark === undefined ) continue;

        for( const p of mark.tracePoints ?? [] )
        {
            const params = removedTraces[ p.trace ]?.recipe?.params ?? [];
            tracePoints.push([
                i,
                p.trace,
                p.when,
                p.branch ?? -1,
                // a reduced function's parameter is the value its value is applied to
                ...params.map( s => ( p.when === 5 || p.when === 6 ) && s === p.applied ? -2 : boundAt( index, i, s, args.lambdaSymbols ) ),
            ]);
        }

        if( isUserRange( mark.range ) )
        mappings.push([ i, sourceIndexOf( mark.range ), ...positionOf( mark.range ) ]);

        const fn = mark.fnEntry;
        if( fn && isUserRange( fn.range ) )
        {
            const [ line, column ] = positionOf( fn.range );
            functions.push([
                i,
                fn.name === null ? -1 : nameIndexOf( fn.name ),
                sourceIndexOf( fn.range ),
                line,
                column
            ]);
            if( isUserRange( fn.callRange ) )
            inlinedCalls.push([ i, sourceIndexOf( fn.callRange ), ...positionOf( fn.callRange ) ]);
        }

        if( isUserRange( mark.assertCond ) )
        asserts.push( mark.assertNegated
            ? [ i, sourceIndexOf( mark.assertCond ), ...positionOf( mark.assertCond ), 1 as const ]
            : [ i, sourceIndexOf( mark.assertCond ), ...positionOf( mark.assertCond ) ]
        );

        if( isUserRange( mark.failRange ) )
        failures.push([ i, sourceIndexOf( mark.failRange ), ...positionOf( mark.failRange ) ]);
    }

    const map: UPLCSourceMap = {
        version: 1,
        compiler: args.compiler,
        programHash: toHex( blake2b_256( args.serialized ) ),
        programVersion: args.version.toString(),
        termCount: index.terms.length,
        sources: sources.map( s => projectRelativePath( s.absoluteProjPath, args.root ) ),
        names,
        mappings,
        functions,
        asserts,
    };
    if( inlinedCalls.length > 0 ) map.inlinedCalls = inlinedCalls;
    if( failures.length > 0 ) map.failures = failures;
    if( removedTraces.length > 0 )
    {
        map.traces = removedTraces.map( ( t, k ): UPLCSourceMapTrace => {
            const entry: UPLCSourceMapTrace = { kind: t.kind };
            if( isUserRange( t.range ) ) entry.at = [ sourceIndexOf( t.range ), ...positionOf( t.range ) ];
            if( t.message !== undefined ) entry.message = t.message;
            else
            {
                if( t.expression !== undefined ) entry.expression = t.expression;
                const program = args.tracePrograms?.[k];
                if( program !== undefined ) entry.program = toHex( program );
            }
            return entry;
        });
        map.tracePoints = tracePoints;
    }
    // computed after the traces: a trace in a source no mapping uses still names it
    map.sources = sources.map( s => projectRelativePath( s.absoluteProjPath, args.root ) );
    if( args.sourcesContent === true ) map.sourcesContent = sources.map( s => s.text );
    return map;
}

/**
 * the de Bruijn index, in the environment of term `i`, of the lambda binding `sym`;
 * `-1` when no lambda around the term binds it (the optimizer inlined or removed it)
 */
function boundAt( index: ProgramIndex, i: number, sym: symbol, lambdaSymbols: ReadonlyMap<object, symbol> | undefined ): number
{
    if( lambdaSymbols === undefined ) return -1;
    let depth = 0;
    for( let p = index.parents[i]; p >= 0; p = index.parents[p] )
    {
        const t = index.terms[p];
        if( !( t instanceof Lambda ) ) continue;
        if( lambdaSymbols.get( t ) === sym ) return depth;
        depth++;
    }
    return -1;
}

function isUserRange( range: SourceRange | null | undefined ): range is SourceRange
{
    return isSourceRange( range ) && !range.source.isLibrary();
}

/** `[ startLine, startColumn, endLine, endColumn ]`, 1-based, end exclusive */
function positionOf( range: SourceRange ): [ number, number, number, number ]
{
    const src = range.source;
    const startLine = src.lineAt( range.start );
    const startColumn = src.columnAt();
    const endLine = src.lineAt( range.end );
    const endColumn = src.columnAt();
    return [ startLine, startColumn, endLine, endColumn ];
}

/**
 * paths in maps are relative to the project root, with forward slashes;
 * with a filesystem IO the compiler sees absolute paths
 */
export function projectRelativePath( path: string, root?: string ): string
{
    path = path.replace( /\\/g, "/" );
    if( typeof root === "string" )
    {
        const r = root.replace( /\\/g, "/" ).replace( /\/+$/, "" );
        if( r.length > 0 && r !== "." && path.startsWith( r + "/" ) ) path = path.slice( r.length + 1 );
    }
    return path.replace( /^(\.\/|\/)+/, "" );
}
