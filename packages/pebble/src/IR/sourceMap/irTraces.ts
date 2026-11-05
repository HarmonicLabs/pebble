import type { SourceRange } from "../../ast/Source/SourceRange";
import type { IRTerm } from "../IRTerm";
import type { IRTracePoint } from "../IRNodes/BaseIRMetadata";
import { currentCompilationCtx } from "../CompilationCtx";
import { IRNodeKind } from "../IRNodeKind";
import { irMeta } from "./irRanges";
import { _ir_apps } from "../IRNodes/IRApp";
import { IRFunc } from "../IRNodes/IRFunc";
import { IRVar } from "../IRNodes/IRVar";

/*
 * Traces removed from the program (`removeTraces`) but kept in its source map: the program is
 * compiled as if they were not there, so the optimizer works on the program that gets deployed,
 * and the map says where each would have run, so tools evaluating it print them anyway.
 */

/** a trace the compiler removed */
export interface StrippedTrace {
    /** `trace`: a trace statement; `assert`: an assert's message; `fail`: a failure's message */
    readonly kind: "trace" | "assert" | "fail";
    /** the statement; undefined when unknown */
    readonly range: SourceRange | undefined;
    /** the message, when it is always the same */
    readonly message?: string;
    /** a message computed from values: its source text */
    readonly expression?: string;
    /**
     * a message computed from values: a closed IR term that computes it, a function of the
     * variables it reads (`params`; the message itself when there are none)
     */
    readonly recipe?: { readonly ir: IRTerm, readonly params: readonly symbol[] };
    /**
     * the trace this one is a copy of (its index), for one place of it: the optimizer replaced
     * a variable the message reads there with an expression, which the copy's recipe computes
     * (see `substituteInTracePoints`)
     */
    readonly of?: number;
}

/** whether this compilation removes traces */
export function strippingTraces(): boolean
{
    return currentCompilationCtx().strippedTraces !== undefined;
}

/**
 * Records `trace`, which would have run at `node` (`when`, see `IRTracePoint`), and returns
 * `node`. A trace recorded later belongs to an enclosing statement, so it ran first.
 */
export function markStrippedTrace( node: IRTerm, trace: StrippedTrace, when: IRTracePoint["when"] ): IRTerm
{
    const traces = currentCompilationCtx().strippedTraces;
    if( traces === undefined ) return node;
    const point: IRTracePoint = { trace: traces.push( trace ) - 1, when };
    const meta = irMeta( node );
    meta.tracePoints = [ point, ...( meta.tracePoints ?? [] ) ];
    return node;
}

/**
 * The trace points in failing branches a case lost (`branch`: the branch's index): they would
 * have run on the way to that failure, so they now run when the case fails for that branch.
 */
export function tracePointsOfDropped( dropped: readonly { readonly term: IRTerm, readonly branch: number }[] ): IRTracePoint[] | undefined
{
    const points: IRTracePoint[] = [];
    for( const { term, branch } of dropped )
    {
        const stack: IRTerm[] = [ term ];
        while( stack.length > 0 )
        {
            const node = stack.pop()!;
            for( const p of irMeta( node ).tracePoints ?? [] ) points.push({ trace: p.trace, when: 2, branch });
            const children = node.children();
            for( let i = children.length - 1; i >= 0; i-- ) stack.push( children[i] );
        }
    }
    return points.length > 0 ? points : undefined;
}

/** adds `points` (they ran first) to the ones of `node` */
export function prependTracePoints( node: IRTerm, points: readonly IRTracePoint[] | undefined ): void
{
    if( points === undefined || points.length === 0 ) return;
    const meta = irMeta( node );
    meta.tracePoints = [ ...points, ...( meta.tracePoints ?? [] ) ];
}

/**
 * `param`, bound by a lambda the optimizer removes, stands for `value` in `scope` (the lambda's
 * body): the removed traces there whose message reads it compute it from `value` instead. Each
 * such point gets a copy of its trace (`StrippedTrace.of`) whose recipe takes `value`'s
 * variables, which the place has where the parameter no longer is.
 */
export function substituteInTracePoints( scope: IRTerm, param: symbol, value: IRTerm ): void
{
    const traces = currentCompilationCtx().strippedTraces;
    if( traces === undefined || traces.length === 0 ) return;
    const derived = new Map<number, number>();
    const stack: IRTerm[] = [ scope ];
    while( stack.length > 0 )
    {
        const node = stack.pop()!;
        // a lambda binding the same symbol again: another variable
        if( node.kind === IRNodeKind.Func && ( node as any ).params.includes( param ) ) continue;
        const meta = irMeta( node );
        const points = meta.tracePoints;
        if( points )
        {
            let changed = false;
            const next = points.map( p => {
                if( !( traces[ p.trace ]?.recipe?.params.includes( param ) ) ) return p;
                changed = true;
                let k = derived.get( p.trace );
                if( k === undefined ) derived.set( p.trace, k = deriveTrace( traces, p.trace, param, value ) );
                return { ...p, trace: k };
            });
            if( changed ) meta.tracePoints = next;
        }
        // letted and hoisted values are definitions shared by every use: no place of their own
        if( node.kind === IRNodeKind.Letted || node.kind === IRNodeKind.Hoisted ) continue;
        for( const c of node.children() ) stack.push( c );
    }
}

/** a copy of trace `k` reading `value` where it read `param` (see `substituteInTracePoints`) */
function deriveTrace( traces: StrippedTrace[], k: number, param: symbol, value: IRTerm ): number
{
    const trace = traces[k];
    const recipe = trace.recipe!;
    const body = _ir_apps(
        recipe.ir.clone() as any,
        ...recipe.params.map( s => s === param ? value.clone() : new IRVar( s ) ) as [ IRTerm, ...IRTerm[] ]
    );
    const params = freeSymbols( body );
    const ir = params.length > 0 ? new IRFunc( params, body ) : body;
    return traces.push({ ...trace, recipe: { ir, params }, of: trace.of ?? k }) - 1;
}

/** the variables `term` uses and does not bind, in order of first use */
export function freeSymbols( term: IRTerm ): symbol[]
{
    const free: symbol[] = [];
    const seen = new Set<symbol>();
    const use = ( s: symbol, bound: ReadonlySet<symbol> ) => {
        if( bound.has( s ) || seen.has( s ) ) return;
        seen.add( s );
        free.push( s );
    };
    const walk = ( t: IRTerm, bound: ReadonlySet<symbol> ): void => {
        switch( t.kind )
        {
            case IRNodeKind.Var: return use( ( t as any ).name, bound );
            case IRNodeKind.SelfCall: return use( ( t as any ).name, bound );
            // hoisted terms are closed
            case IRNodeKind.Hoisted: return;
            case IRNodeKind.Func: {
                const inner = new Set( bound );
                for( const p of ( t as any ).params as symbol[] ) inner.add( p );
                for( const c of t.children() ) walk( c, inner );
                return;
            }
            case IRNodeKind.Recursive: {
                const inner = new Set( bound );
                inner.add( ( t as any ).name );
                for( const c of t.children() ) walk( c, inner );
                return;
            }
            default:
                for( const c of t.children() ) walk( c, bound );
        }
    };
    walk( term, new Set() );
    return free;
}

/**
 * The first use of the letted value `sym` that `root` computes as soon as it is computed: in
 * evaluation order, not inside functions, delayed terms or case branches (those may run
 * later, or never).
 */
export function firstStrictUse( root: IRTerm, sym: symbol ): IRTerm | undefined
{
    const visit = ( t: IRTerm ): IRTerm | undefined => {
        if( t.kind === IRNodeKind.Letted && ( t as any ).name === sym ) return t;
        switch( t.kind )
        {
            case IRNodeKind.Func:
            case IRNodeKind.Delayed:
            case IRNodeKind.Hoisted:
            case IRNodeKind.Recursive:
                return undefined;
            case IRNodeKind.Case:
                return visit( ( t as any ).constrTerm );
            default:
                for( const c of t.children() )
                {
                    const use = visit( c );
                    if( use !== undefined ) return use;
                }
                return undefined;
        }
    };
    return visit( root );
}

/** the source text of `range`, when it has a source */
export function sourceTextOf( range: SourceRange | undefined ): string | undefined
{
    const text = range?.source?.text;
    if( typeof text !== "string" || range === undefined || range.start < 0 || range.end > text.length ) return undefined;
    return text.slice( range.start, range.end );
}
