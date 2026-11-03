import { indexProgram } from "@harmoniclabs/plutus-machine";
import { Lambda, UPLCTerm } from "@harmoniclabs/uplc";
import type { SourceRange } from "../../ast/Source/SourceRange";
import type { UplcMarks } from "../../IR/sourceMap/uplcMarks";
import { unionBindings } from "../../IR/sourceMap/unionBindings";
import type { DebugBinding, DebugFunction, DebugStmt, DebugStructure } from "./DebugInfo";
import type { DebugCollector } from "./DebugCollector";
import { isUserRange } from "./collectDebugStructure";

/**
 * The debug information of a compiled program, per term: terms are numbered as in the source
 * map (pre-order over the unapplied program, see `indexProgram`).
 */
export interface DebugTable {
    readonly structure: DebugStructure;
    readonly termCount: number;
    /** source range of each term, the one in the source map */
    readonly rangeAt: readonly ( SourceRange | undefined )[];
    /** innermost statement containing each term's range */
    readonly stmtAt: readonly ( DebugStmt | undefined )[];
    /** the function a term enters (the root of its body) */
    readonly fnAt: readonly ( DebugFunction | undefined )[];
    /** for function bodies the optimizer copied in place of a call: that call */
    readonly callRangeAt: readonly ( SourceRange | undefined )[];
    /** the loop a term starts an iteration of (the root of the loop's body) */
    readonly loopAt: readonly ( DebugFunction | undefined )[];
    /** for lambdas: the variables the value they bind holds */
    readonly bindsAt: readonly ( readonly DebugBinding[] | undefined )[];
    /** the variables whose value a term computes */
    readonly valueAt: readonly ( readonly DebugBinding[] | undefined )[];
    /** the assert statement whose condition a term is the root of */
    readonly assertAt: readonly ( DebugStmt | undefined )[];
    /** for a case that lost its failing branches: the statement whose failure it stands for */
    readonly failAt: readonly ( DebugStmt | undefined )[];
    /** statements using a variable whose value a term was copied in for (they run as it does) */
    readonly useStmtsAt: readonly ( readonly DebugStmt[] | undefined )[];
    /** innermost statement containing `range`, `undefined` outside every statement */
    stmtContaining( range: SourceRange ): DebugStmt | undefined;
}

export interface BuildDebugTableArgs {
    /** body of the compiled program, as `compileIRToUPLC` returned it */
    program: UPLCTerm;
    marks: UplcMarks;
    debug: DebugCollector;
}

export function buildDebugTable( args: BuildDebugTableArgs ): DebugTable
{
    const { marks, debug } = args;
    const index = indexProgram( args.program );
    const n = index.terms.length;
    const locate = new StatementLocator( debug.stmts );

    const rangeAt: ( SourceRange | undefined )[] = new Array( n ).fill( undefined );
    const stmtAt: ( DebugStmt | undefined )[] = new Array( n ).fill( undefined );
    const fnAt: ( DebugFunction | undefined )[] = new Array( n ).fill( undefined );
    const callRangeAt: ( SourceRange | undefined )[] = new Array( n ).fill( undefined );
    const loopAt: ( DebugFunction | undefined )[] = new Array( n ).fill( undefined );
    const bindsAt: ( readonly DebugBinding[] | undefined )[] = new Array( n ).fill( undefined );
    const valueAt: ( readonly DebugBinding[] | undefined )[] = new Array( n ).fill( undefined );
    const assertAt: ( DebugStmt | undefined )[] = new Array( n ).fill( undefined );
    const failAt: ( DebugStmt | undefined )[] = new Array( n ).fill( undefined );
    const useStmtsAt: ( readonly DebugStmt[] | undefined )[] = new Array( n ).fill( undefined );

    for( let i = 0; i < n; i++ )
    {
        const term = index.terms[i];
        const mark = marks.get( term );
        if( mark !== undefined )
        {
            if( isUserRange( mark.range ) )
            {
                rangeAt[i] = mark.range;
                stmtAt[i] = locate.innermost( mark.range );
            }
            const fnEntry = mark.fnEntry;
            if( fnEntry && fnEntry.debugFn !== undefined )
            {
                fnAt[i] = fnEntry.debugFn;
                if( isUserRange( fnEntry.callRange ) ) callRangeAt[i] = fnEntry.callRange;
            }
            if( mark.loopEntry ) loopAt[i] = mark.loopEntry;
            if( mark.varValue !== undefined && mark.varValue.length > 0 ) valueAt[i] = mark.varValue;
            if( isUserRange( mark.assertCond ) ) assertAt[i] = locate.innermost( mark.assertCond );
            if( isUserRange( mark.failRange ) ) failAt[i] = locate.innermost( mark.failRange );
            if( mark.useRanges !== undefined )
            {
                const uses = mark.useRanges
                    .map( r => isUserRange( r ) ? locate.innermost( r ) : undefined )
                    .filter( ( s ): s is DebugStmt => s !== undefined && s !== stmtAt[i] );
                if( uses.length > 0 ) useStmtsAt[i] = uses;
            }
        }
        if( term instanceof Lambda )
        {
            const sym = debug.lambdaBinds.get( term );
            const bindings = sym !== undefined ? debug.bindingsOfSymbol( sym ) : undefined;
            if( bindings !== undefined && bindings.length > 0 ) bindsAt[i] = unionBindings( undefined, bindings );
        }
    }

    return {
        structure: debug.structure(),
        termCount: n,
        rangeAt,
        stmtAt,
        fnAt,
        callRangeAt,
        loopAt,
        bindsAt,
        valueAt,
        assertAt,
        failAt,
        useStmtsAt,
        stmtContaining: range => isUserRange( range ) ? locate.innermost( range ) : undefined,
    };
}

/**
 * Finds the innermost statement containing a range. Statements nest (closures' statements
 * inside the statement that creates them), so per source they form a forest; sorted by start,
 * the innermost container of a range is the first one up the chain of the last statement
 * starting at or before it.
 */
class StatementLocator
{
    private readonly bySource = new Map<object, { stmts: DebugStmt[], container: Int32Array }>();

    constructor( stmts: readonly DebugStmt[] )
    {
        const groups = new Map<object, DebugStmt[]>();
        for( const s of stmts )
        {
            if( !isUserRange( s.range ) ) continue;
            let g = groups.get( s.range.source );
            if( g === undefined ) groups.set( s.range.source, g = [] );
            g.push( s );
        }
        for( const [ source, g ] of groups )
        {
            // outer before inner: by start, then larger first, then declaration order
            g.sort( ( a, b ) =>
                a.range.start - b.range.start ||
                ( b.range.end - b.range.start ) - ( a.range.end - a.range.start ) ||
                a.id - b.id
            );
            const container = new Int32Array( g.length ).fill( -1 );
            const open: number[] = [];
            for( let i = 0; i < g.length; i++ )
            {
                while( open.length > 0 && !contains( g[ open[ open.length - 1 ] ].range, g[i].range ) ) open.pop();
                container[i] = open.length > 0 ? open[ open.length - 1 ] : -1;
                open.push( i );
            }
            this.bySource.set( source, { stmts: g, container } );
        }
    }

    innermost( range: SourceRange ): DebugStmt | undefined
    {
        const entry = this.bySource.get( range.source );
        if( entry === undefined ) return undefined;
        const { stmts, container } = entry;
        // last statement starting at or before the range
        let lo = 0, hi = stmts.length - 1, at = -1;
        while( lo <= hi )
        {
            const mid = ( lo + hi ) >> 1;
            if( stmts[mid].range.start <= range.start ) { at = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        for( let k = at; k >= 0; k = container[k] )
        {
            if( contains( stmts[k].range, range ) ) return stmts[k];
        }
        return undefined;
    }
}

function contains( outer: SourceRange, inner: SourceRange ): boolean
{
    return outer.start <= inner.start && inner.end <= outer.end;
}
