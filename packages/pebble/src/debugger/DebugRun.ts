import { CEKConst, CEKError, CEKEnv, CEKValueObj, envDepth, envExtends, EvaluationRecording, MachineContext, ProgramIndex } from "@harmoniclabs/plutus-machine";
import type { SourceRange } from "../ast/Source/SourceRange";
import type { DebugTable } from "../compiler/debug/buildDebugTable";
import type { DebugBinding, DebugFunction, DebugStmt, DebugVar } from "../compiler/debug/DebugInfo";

// `MachineContextTag` is a const enum internal to plutus-machine
const NO_FRAME = 0;
const FRAME_AWAIT_FUN_VALUE = 3;

/** one call of a function, or one iteration of a loop */
export interface DebugFrame {
    readonly id: number;
    readonly fn: DebugFunction;
    /** the frame that called it; for a loop iteration, the frame the loop is in */
    readonly parent: DebugFrame | undefined;
    /** the statement of `parent` that made the call (or runs the loop) */
    readonly callStmt: DebugStmt | undefined;
    readonly entryState: number;
    /** the state returning its value; `-1` when it did not return */
    readonly exitState: number;
    /** env its body starts with */
    readonly baseEnv: CEKEnv;
    /** for loop iterations, counting from 1 */
    readonly iteration: number;
    /** function frames from the outermost to it, itself included (loop iterations do not count) */
    readonly depth: number;
}

/** one statement run in one frame: what a debugger steps through, in source order */
export interface DebugStep {
    readonly index: number;
    readonly stmt: DebugStmt;
    readonly frame: DebugFrame;
    /** first machine state of the statement in the frame */
    readonly state: number;
    /** `frame.depth` */
    readonly depth: number;
    /** the evaluation failed at this statement */
    readonly failed: boolean;
    /** budget the statement's own states spent (its calls count for theirs) */
    readonly cpu: number;
    readonly mem: number;
    /** for the `return` that ends a call: the value the call returned */
    readonly returned?: CEKValueObj;
}

export type DebugValueStatus = "value" | "not evaluated" | "optimized out";

export interface DebugVariable {
    /** the variable as the source names it */
    readonly v: DebugVar;
    readonly status: DebugValueStatus;
    /** set when `status` is `"value"` */
    readonly value: CEKValueObj | undefined;
    /** the state the value was computed at, `-1` when there is no value */
    readonly state: number;
}

export interface DebugStackFrame {
    /** function name; a contract method's name inside a contract */
    readonly name: string;
    /** where the frame stands: the step's statement, or the call of the frame above */
    readonly stmt: DebugStmt | undefined;
    readonly frame: DebugFrame;
}

export type StepMode = "into" | "over" | "out";

interface VarEvent {
    readonly state: number;
    readonly env: CEKEnv;
    /** a lambda's parameter: the value is the head of `env` */
    readonly param: boolean;
}

interface MutableFrame {
    id: number;
    fn: DebugFunction;
    parent: MutableFrame | undefined;
    callStmt: DebugStmt | undefined;
    entryState: number;
    exitState: number;
    baseEnv: CEKEnv;
    iteration: number;
    depth: number;
    entryCtx: MachineContext;
    /** the statement making the call, whatever frame it is in */
    callSite: DebugStmt | undefined;
    /** statements touched, with the first state */
    touched: Map<DebugStmt, number>;
    lastStmt: DebugStmt | undefined;
    children: MutableFrame[];
    cost: Map<DebugStmt, [ number, number ]>;
}

export interface BuildDebugRunArgs {
    recording: EvaluationRecording;
    table: DebugTable;
    /** index of the program the table describes, inside the evaluated term (`findMappedProgram`) */
    index: ProgramIndex;
}

/**
 * A recorded evaluation shown in source terms: the statements each call ran, in source
 * order, with the variables in scope and their values.
 *
 * The compiled program does not run statements in source order: it computes a `const`'s
 * value where the variable is used, merges asserts into one condition, hoists what does not
 * depend on the call. Since evaluation is pure, the order the source states is a faithful view
 * of the same run: each call lists the statements whose terms were evaluated, sorted as
 * written, with the calls they made after them; a failing run ends at the statement that
 * failed. Values are looked up anywhere in the recording, within the same call.
 */
export class DebugRun
{
    readonly steps: readonly DebugStep[];
    readonly frames: readonly DebugFrame[];
    /** index in `steps` of the statement the evaluation failed at; `-1` if none */
    readonly failedStep: number;

    private readonly events = new Map<DebugBinding, VarEvent[]>();
    private readonly bindingsOfVar = new Map<DebugVar, DebugBinding[]>();
    private readonly framesByFn = new Map<DebugFunction, MutableFrame[]>();

    constructor(
        readonly recording: EvaluationRecording,
        readonly table: DebugTable,
        readonly index: ProgramIndex
    )
    {
        for( let i = 0; i < table.termCount; i++ )
        {
            for( const b of table.bindsAt[i] ?? [] ) this.noteBinding( b );
            for( const b of table.valueAt[i] ?? [] ) this.noteBinding( b );
        }
        const { frames, failStmt, failFrame } = this.walkRecording();
        this.frames = frames;
        const steps: DebugStep[] = [];
        for( const f of frames ) if( f.parent === undefined ) this.emitFrame( f, steps, failFrame, failStmt );
        this.steps = steps;
        this.failedStep = steps.findIndex( s => s.failed );
    }

    private noteBinding( b: DebugBinding ): void
    {
        const list = this.bindingsOfVar.get( b.v );
        if( list === undefined ) this.bindingsOfVar.set( b.v, [ b ] );
        else if( !list.includes( b ) ) list.push( b );
    }

    // ------------------------------------------------------------------------------------
    // first pass: frames, the statements each touched, values of variables
    // ------------------------------------------------------------------------------------

    private walkRecording(): { frames: MutableFrame[], failStmt: DebugStmt | undefined, failFrame: MutableFrame | undefined }
    {
        const rec = this.recording;
        const { table, index } = this;
        const frames: MutableFrame[] = [];
        const open: MutableFrame[] = [];
        // failure location, as `FailureTracker` finds it
        const owners = new Map<MachineContext, number>();
        const conditions: { stmt: DebugStmt, ctx: MachineContext, negated: boolean }[] = [];
        let lastFalseAssert: DebugStmt | undefined = undefined;
        let costTo: { frame: MutableFrame, stmt: DebugStmt } | undefined = undefined;
        /** declarations whose value was computed: they ran, if the block they are in ran */
        const declTouches: { frame: MutableFrame, stmt: DebugStmt, state: number }[] = [];
        let prevReturnCtx: MachineContext | undefined = undefined;

        const ownerOf = ( fn: DebugFunction ): MutableFrame | undefined => {
            for( let k = open.length - 1; k >= 0; k-- ) if( open[k].fn === fn ) return open[k];
            return undefined;
        };
        const touch = ( frame: MutableFrame, stmt: DebugStmt, state: number ): void => {
            for( let s: DebugStmt | undefined = stmt; s !== undefined; s = s.parent )
            {
                if( frame.touched.has( s ) ) break;
                frame.touched.set( s, state );
            }
            frame.lastStmt = stmt;
        };
        const pushFrame = ( fn: DebugFunction, state: number, ctx: MachineContext, env: CEKEnv, callRange: SourceRange | undefined ): void => {
            let parent: MutableFrame | undefined;
            let callStmt: DebugStmt | undefined;
            let callSite: DebugStmt | undefined;
            let iteration = 1;
            if( fn.kind === "loop" )
            {
                // iterations call each other: they all belong to the frame the loop is in
                for( let k = open.length - 1; k >= 0; k-- ) if( open[k].fn !== fn ) { parent = open[k]; break; }
                callStmt = fn.loopStmt;
                if( parent !== undefined ) iteration = 1 + parent.children.filter( c => c.fn === fn ).length;
            }
            else
            {
                parent = open[ open.length - 1 ];
                callSite = this.callSiteOf( fn, callRange, prevReturnCtx, owners );
                callStmt = callSite !== undefined && parent !== undefined && callSite.fn === parent.fn ? callSite : parent?.lastStmt;
            }
            const frame: MutableFrame = {
                id: frames.length,
                fn,
                parent,
                callStmt,
                entryState: state,
                exitState: -1,
                baseEnv: env,
                iteration,
                depth: ( parent?.depth ?? 0 ) + ( fn.kind === "function" ? 1 : 0 ),
                entryCtx: ctx,
                callSite,
                touched: new Map(),
                lastStmt: undefined,
                children: [],
                cost: new Map(),
            };
            frames.push( frame );
            parent?.children.push( frame );
            open.push( frame );
            let list = this.framesByFn.get( fn );
            if( list === undefined ) this.framesByFn.set( fn, list = [] );
            list.push( frame );
        };
        const addEvent = ( b: DebugBinding, e: VarEvent ): void => {
            const list = this.events.get( b );
            if( list === undefined ) this.events.set( b, [ e ] );
            else list.push( e );
        };

        const n = rec.length;
        for( let j = 0; j < n; j++ )
        {
            const s = rec.states[j];
            if( j > 0 && costTo !== undefined )
            {
                const c = costTo.frame.cost.get( costTo.stmt );
                const dCpu = rec.cpu[j] - rec.cpu[ j - 1 ];
                const dMem = rec.mem[j] - rec.mem[ j - 1 ];
                if( c === undefined ) costTo.frame.cost.set( costTo.stmt, [ dCpu, dMem ] );
                else { c[0] += dCpu; c[1] += dMem; }
            }

            if( rec.isCompute( j ) )
            {
                const i = index.indexOf( s.term );
                if( i === undefined ) continue;

                // the first term computed under a new frame is a child of the term that pushed it
                const ctx = s.ctx as MachineContext;
                if( ctx.tag !== NO_FRAME && !owners.has( ctx ) )
                {
                    const parent = index.parents[i];
                    if( parent >= 0 )
                    {
                        owners.set( ctx, parent );
                        if( ctx.tag === FRAME_AWAIT_FUN_VALUE )
                        {
                            for(
                                let c: MachineContext | undefined = ctx.ctx;
                                c !== undefined && c.tag === FRAME_AWAIT_FUN_VALUE && !owners.has( c );
                                c = c.ctx
                            ) owners.set( c, parent );
                        }
                    }
                }

                const fn = table.fnAt[i];
                if( fn !== undefined ) pushFrame( fn, j, ctx, s.env as CEKEnv, table.callRangeAt[i] );
                const loop = table.loopAt[i];
                if( loop !== undefined ) pushFrame( loop, j, ctx, s.env as CEKEnv, undefined );

                const assertStmt = table.assertAt[i];
                if( assertStmt !== undefined ) conditions.push({ stmt: assertStmt, ctx, negated: table.assertNegatedAt[i] });

                const stmt = table.stmtAt[i];
                if( stmt !== undefined )
                {
                    const owner = ownerOf( stmt.fn );
                    if( owner !== undefined )
                    {
                        touch( owner, stmt, j );
                        costTo = { frame: owner, stmt };
                    }
                }
                // a value copied in where a variable is used: the use runs too
                for( const use of table.useStmtsAt[i] ?? [] )
                {
                    const owner = ownerOf( use.fn );
                    if( owner !== undefined && !owner.touched.has( use ) ) touch( owner, use, j );
                }

                const values = table.valueAt[i];
                if( values !== undefined ) for( const b of values )
                {
                    addEvent( b, { state: j, env: s.env as CEKEnv, param: false } );
                    // a declaration runs where its value is computed (often where it is used)
                    const at = b.kind === "decl" ? b.v.declStmt : b.stmt;
                    if( at !== undefined && b.kind !== "loop" )
                    {
                        const owner = ownerOf( at.fn );
                        if( owner !== undefined ) declTouches.push({ frame: owner, stmt: at, state: j });
                    }
                }

                // the body of a lambda starts: its parameter is the head of the env
                const parentIdx = index.parents[i];
                const binds = parentIdx >= 0 ? table.bindsAt[ parentIdx ] : undefined;
                if( binds !== undefined ) for( const b of binds ) addEvent( b, { state: j, env: s.env as CEKEnv, param: true } );
            }
            else if( rec.isReturn( j ) && !( s.term instanceof CEKError ) )
            {
                const ctx = s.ctx as MachineContext;
                prevReturnCtx = ctx;
                while( conditions.length > 0 && conditions[ conditions.length - 1 ].ctx === ctx )
                {
                    const c = conditions.pop()!;
                    if( isBool( s.term as CEKValueObj, c.negated ) ) lastFalseAssert = c.stmt;
                }
                while( open.length > 0 && open[ open.length - 1 ].entryCtx === ctx ) open.pop()!.exitState = j;
            }
        }

        // a call the optimizer computed ahead of its caller (it does not depend on it) runs
        // before any frame of the caller: it belongs where it is written
        for( const frame of frames )
        {
            const site = frame.callSite;
            if( frame.parent !== undefined || site === undefined || site.fn === frame.fn ) continue;
            const caller = this.framesByFn.get( site.fn )?.[0];
            if( caller === undefined ) continue;
            frame.parent = caller;
            frame.callStmt = site;
            caller.children.push( frame );
            caller.children.sort( ( a, b ) => a.entryState - b.entryState );
            setDepth( frame, caller.depth );
        }

        // equal values are shared: the value of a declaration in a branch that did not run may
        // be computed for another one; a declaration ran only if its block did
        for( const { frame, stmt, state } of declTouches )
        {
            if( frame.touched.has( stmt ) ) continue;
            if( stmt.parent !== undefined && !frame.touched.has( stmt.parent ) ) continue;
            touch( frame, stmt, state );
        }

        if( !rec.failed || n < 2 ) return { frames, failStmt: undefined, failFrame: undefined };

        // the failing term: the one being computed (`error`), or the one owning the frame
        // that received the last value (a builtin's application, a case, a force)
        const prev = rec.states[ n - 2 ];
        const failedAt = (
            rec.isCompute( n - 2 ) ? index.indexOf( prev.term ) :
            rec.isReturn( n - 2 ) ? owners.get( prev.ctx as MachineContext ) :
            undefined
        );
        // an assert whose condition was false fails right after: it is the failure, wherever
        // the failing term stands (a shared `error` of merged asserts, a condition the
        // optimizer built from a variable's initializer)
        let failStmt = lastFalseAssert ?? (
            failedAt !== undefined
                // a case that lost its failing branches stands for their failure
                ? table.failAt[ failedAt ] ?? table.stmtAt[ failedAt ]
                : undefined
        );
        let failFrame = failStmt !== undefined ? ownerOf( failStmt.fn ) : undefined;
        if( failFrame === undefined )
        {
            failFrame = open[ open.length - 1 ];
            failStmt = failFrame?.lastStmt;
        }
        return { frames, failStmt, failFrame };
    }

    /**
     * the statement that called `fn`: for a body copied in place of a call, that call; for a
     * closure, the statement it is written in (library code such as `find` makes the calls);
     * else the application that passed the last argument
     */
    private callSiteOf(
        fn: DebugFunction,
        callRange: SourceRange | undefined,
        prevReturnCtx: MachineContext | undefined,
        owners: Map<MachineContext, number>
    ): DebugStmt | undefined
    {
        const { table } = this;
        const outside = ( s: DebugStmt | undefined ): DebugStmt | undefined => s !== undefined && s.fn !== fn ? s : undefined;
        if( callRange !== undefined )
        {
            const s = outside( table.stmtContaining( callRange ) );
            if( s !== undefined ) return s;
        }
        if( fn.parent !== undefined )
        {
            const s = outside( table.stmtContaining( fn.range ) );
            if( s !== undefined ) return s;
        }
        if( prevReturnCtx !== undefined )
        {
            const owner = owners.get( prevReturnCtx );
            const s = owner !== undefined ? outside( table.stmtAt[ owner ] ) : undefined;
            if( s !== undefined ) return s;
        }
        return undefined;
    }

    // ------------------------------------------------------------------------------------
    // second pass: steps in source order
    // ------------------------------------------------------------------------------------

    /** returns `true` when the run stops inside `frame` (it failed there) */
    private emitFrame(
        frame: MutableFrame,
        steps: DebugStep[],
        failFrame: MutableFrame | undefined,
        failStmt: DebugStmt | undefined
    ): boolean
    {
        const stops = [ ...frame.touched.keys() ]
            .filter( s => s.isStop )
            .sort( ( a, b ) => a.order - b.order );

        // the frame on the way to the failure, if this frame is on it
        let failChild: MutableFrame | undefined = undefined;
        for( let f = failFrame; f !== undefined; f = f.parent ) if( f.parent === frame ) { failChild = f; break; }
        const failsHere = failFrame === frame;

        // each call goes after the statement that made it
        const attached = new Map<DebugStmt | undefined, MutableFrame[]>();
        for( const child of frame.children )
        {
            const at = this.attachStmt( child, frame, stops );
            let list = attached.get( at );
            if( list === undefined ) attached.set( at, list = [] );
            list.push( child );
        }

        const emitChildren = ( at: DebugStmt | undefined ): boolean => {
            for( const child of attached.get( at ) ?? [] )
            {
                if( failChild !== undefined && child.entryState > failChild.entryState ) return true;
                if( this.emitFrame( child, steps, failFrame, failStmt ) ) return true;
            }
            return false;
        };

        if( emitChildren( undefined ) ) return true;
        const push = ( stmt: DebugStmt, state: number, failed: boolean, cost: [ number, number ] | undefined ): void => {
            steps.push({
                index: steps.length,
                stmt,
                frame,
                state,
                depth: frame.depth,
                failed,
                cpu: cost?.[0] ?? 0,
                mem: cost?.[1] ?? 0,
            });
        };
        const first = steps.length;
        for( const stmt of stops )
        {
            const fails = failsHere && stmt === failStmt;
            const calls = ( attached.get( stmt ) ?? [] ).length > 0;
            // a failing statement that makes calls fails after them: it shows again, failed, last
            push( stmt, frame.touched.get( stmt )!, fails && !calls, frame.cost.get( stmt ) );
            if( emitChildren( stmt ) ) return true;
            if( fails )
            {
                if( calls ) push( stmt, this.recording.length - 1, true, undefined );
                return true;
            }
        }
        if( failsHere ) return true;
        this.endCall( frame, steps, first );
        return false;
    }

    /** the `return` that ends a call carries the value it returned */
    private endCall(
        frame: MutableFrame,
        steps: DebugStep[],
        first: number
    ): void
    {
        if( frame.fn.kind !== "function" || frame.exitState < 0 ) return;
        // the call and its loop iterations (a `return` in a loop returns from the function)
        const ownFrames = new Set<MutableFrame>();
        const collect = ( f: MutableFrame ): void => {
            ownFrames.add( f );
            for( const c of f.children ) if( c.fn.kind === "loop" ) collect( c );
        };
        collect( frame );
        // the call's last step, if it is a `return`
        let k = steps.length - 1;
        while( k >= first && !ownFrames.has( steps[k].frame as MutableFrame ) ) k--;
        if( k < first || steps[k].stmt.kind !== "return" ) return;
        const value = this.recording.states[ frame.exitState ]?.term as CEKValueObj | undefined;
        if( value !== undefined && !( value instanceof CEKError ) ) steps[k] = { ...steps[k], returned: value };
    }

    /** the statement of `frame` a call (or iteration) `child` is shown after */
    private attachStmt( child: MutableFrame, frame: MutableFrame, stops: readonly DebugStmt[] ): DebugStmt | undefined
    {
        for( let s = child.callStmt; s !== undefined; s = s.parent )
        {
            if( s.isStop && frame.touched.has( s ) ) return s;
        }
        // the last statement that started before the call
        let at: DebugStmt | undefined = undefined;
        let atState = -1;
        for( const s of stops )
        {
            const st = frame.touched.get( s )!;
            if( st < child.entryState && st > atState ) { at = s; atState = st; }
        }
        return at;
    }

    // ------------------------------------------------------------------------------------
    // variables
    // ------------------------------------------------------------------------------------

    /** the variables in scope at `step` (before it runs) */
    variablesAt( step: number ): DebugVariable[]
    {
        const s = this.steps[ step ];
        if( s === undefined ) return [];
        return this.variables( s.frame, s.stmt, s.state );
    }

    /** the variables `step` declares, with the values it gives them */
    declaredAt( step: number ): DebugVariable[]
    {
        const s = this.steps[ step ];
        if( s === undefined ) return [];
        return s.stmt.declares
            .filter( v => !v.hidden )
            .map( v => {
                const value = this.valueOf( v, s.frame, s.stmt, s.state, true );
                if( value.status === "value" ) return value;
                // a loop's variables are the first iteration's arguments
                const loop = s.stmt.loop;
                const first = loop !== undefined ? this.frames.find( f => f.parent === s.frame && f.fn === loop ) : undefined;
                if( first === undefined || loop!.stmts.length === 0 ) return value;
                const start = this.valueOf( v, first, loop!.stmts[0], first.entryState );
                return start.status === "value" ? { ...start, v } : value;
            });
    }

    /** the variables in scope at `stmt` in `frame`, around `state` */
    variables( frame: DebugFrame, stmt: DebugStmt, state: number ): DebugVariable[]
    {
        const out: DebugVariable[] = [];
        // a name declared again shadows the outer one
        const seen = new Set<string>();
        for( let i = stmt.scope.length - 1; i >= 0; i-- )
        {
            const v = stmt.scope[i];
            if( v.hidden || seen.has( v.name ) ) continue;
            seen.add( v.name );
            out.push( this.valueOf( v, frame, stmt, state, false ) );
        }
        return out.reverse();
    }

    /**
     * the value `v` has at `stmt` in `frame`: the binding in effect there (its declaration, the
     * last assignment before `stmt`, an iteration's start value), as computed in that call
     */
    valueOf( v: DebugVar, frame: DebugFrame, stmt: DebugStmt, state: number, afterStmt: boolean = false ): DebugVariable
    {
        const target = v.aliasOf ?? v;
        const bindings = this.bindingsOfVar.get( target );
        if( bindings === undefined || bindings.length === 0 ) return { v, status: "optimized out", value: undefined, state: -1 };

        let best: DebugBinding | undefined = undefined;
        let bestKey = -Infinity;
        for( const b of bindings )
        {
            const key = this.bindingKey( b, stmt, afterStmt );
            if( key !== undefined && key > bestKey ) { best = b; bestKey = key; }
        }
        if( best === undefined ) return { v, status: "not evaluated", value: undefined, state: -1 };

        const home = this.homeFrame( frame, this.homeFnOf( best ) );
        const event = this.pickEvent( best, home, state );
        if( event === undefined ) return { v, status: "not evaluated", value: undefined, state: -1 };
        const value = event.param ? event.env?.value : this.recording.valueOf( event.state );
        if( value === undefined ) return { v, status: "not evaluated", value: undefined, state: -1 };
        return { v, status: "value", value, state: event.state };
    }

    /**
     * how late `b` takes effect, for the statement `stmt`: a binding in a function nested
     * deeper wins (a loop's iteration value over the value before the loop), then the one
     * that runs last; `undefined` when `b` does not hold at `stmt`
     */
    private bindingKey( b: DebugBinding, stmt: DebugStmt, afterStmt: boolean ): number | undefined
    {
        const key = ( fn: DebugFunction, order: number ) => fnDepth( fn ) * 1e7 + order + 1;
        switch( b.kind )
        {
            case "decl": {
                const d = b.v.declStmt;
                if( d === undefined ) return key( b.v.fn, -1 );
                // a declaration takes effect after its statement: before it, an outer one shows
                if( d === stmt && !afterStmt ) return undefined;
                return key( d.fn, d.order );
            }
            case "assign": {
                const t = b.stmt;
                if( t === undefined ) return undefined;
                if( t === stmt ) return afterStmt ? key( t.fn, t.order ) : undefined;
                // where `stmt` stands in the assignment's function
                const at = positionIn( stmt, t.fn );
                if( at === undefined || isWithin( at, t ) || t.order > at.order ) return undefined;
                // the assignment's block must enclose it: one branch's assignment is not seen in the other
                if( t.parent !== undefined && !isWithin( at, t.parent ) ) return undefined;
                return key( t.fn, t.order );
            }
            case "loop": {
                const loop = b.stmt?.loop;
                if( loop === undefined || !fnWithin( stmt.fn, loop ) ) return undefined;
                return key( loop, -1 );
            }
        }
    }

    private homeFnOf( b: DebugBinding ): DebugFunction
    {
        if( b.kind === "decl" ) return b.v.fn;
        if( b.kind === "loop" ) return b.stmt?.loop ?? b.v.fn;
        return b.stmt?.fn ?? b.v.fn;
    }

    /** the frame of `fn` whose scope `frame` runs in: itself, or the call its closure was made in */
    private homeFrame( frame: DebugFrame, fn: DebugFunction ): DebugFrame | undefined
    {
        if( frame.fn === fn ) return frame;
        let best: DebugFrame | undefined = undefined;
        for( const f of this.framesByFn.get( fn ) ?? [] )
        {
            if( f.entryState > frame.entryState ) break;
            if( !envExtends( frame.baseEnv, f.baseEnv ) ) continue;
            if( best === undefined || envDepth( f.baseEnv ) >= envDepth( best.baseEnv ) ) best = f;
        }
        return best;
    }

    /** the value event of `b` computed in `home`'s scope (or an enclosing one) nearest to `state` */
    private pickEvent( b: DebugBinding, home: DebugFrame | undefined, state: number ): VarEvent | undefined
    {
        const events = this.events.get( b );
        if( events === undefined || events.length === 0 ) return undefined;
        const ok = ( e: VarEvent ): boolean => {
            if( !e.param && this.recording.returnOf( e.state ) < 0 ) return false;
            if( home === undefined ) return true;
            return envExtends( e.env, home.baseEnv ) || envExtends( home.baseEnv, e.env );
        };
        // the last event at or before `state`, then backwards; else the first after
        let lo = 0, hi = events.length - 1, at = -1;
        while( lo <= hi )
        {
            const mid = ( lo + hi ) >> 1;
            if( events[mid].state <= state ) { at = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        for( let k = at; k >= 0; k-- ) if( ok( events[k] ) ) return events[k];
        for( let k = at + 1; k < events.length; k++ ) if( ok( events[k] ) ) return events[k];
        return undefined;
    }

    // ------------------------------------------------------------------------------------
    // stack, navigation
    // ------------------------------------------------------------------------------------

    /** the calls open at `step`, innermost first; loop iterations are part of their function's frame */
    stackAt( step: number ): DebugStackFrame[]
    {
        const s = this.steps[ step ];
        if( s === undefined ) return [];
        const out: DebugStackFrame[] = [];
        let frame: DebugFrame | undefined = s.frame;
        let stmt: DebugStmt | undefined = s.stmt;
        while( frame !== undefined )
        {
            out.push({ name: this.frameName( frame, stmt ), stmt, frame });
            let fnFrame: DebugFrame = frame;
            while( fnFrame.fn.kind === "loop" && fnFrame.parent !== undefined ) fnFrame = fnFrame.parent;
            stmt = fnFrame.callStmt;
            frame = fnFrame.parent;
        }
        return out;
    }

    /** a frame's function name; in a contract, the method's */
    frameName( frame: DebugFrame, stmt: DebugStmt | undefined ): string
    {
        // a loop iteration is part of its function
        let fn = frame.fn;
        while( fn.kind === "loop" && fn.parent !== undefined ) fn = fn.parent;
        if( stmt !== undefined && fn.parent === undefined )
        {
            const region = this.table.structure.regions.find( r => rangeContains( r.range, stmt.range ) );
            if( region !== undefined ) return region.name;
        }
        return fn.name;
    }

    /** the next step from `from`: the next statement (`into`), skipping calls (`over`), leaving the call (`out`) */
    next( from: number, mode: StepMode ): number
    {
        const depth = this.steps[ from ]?.depth ?? 0;
        for( let i = from + 1; i < this.steps.length; i++ )
        {
            const d = this.steps[i].depth;
            if( mode === "into" || ( mode === "over" && d <= depth ) || ( mode === "out" && d < depth ) ) return i;
        }
        return -1;
    }

    /** the step before `from`, the way `next` goes forward */
    prev( from: number, mode: StepMode ): number
    {
        const depth = this.steps[ from ]?.depth ?? 0;
        for( let i = from - 1; i >= 0; i-- )
        {
            const d = this.steps[i].depth;
            if( mode === "into" || ( mode === "over" && d <= depth ) || ( mode === "out" && d < depth ) ) return i;
        }
        return -1;
    }

    /** the steps whose statement starts on `line` (1-based) of `source` (a project path, as in the source map) */
    stepsAtLine( matches: ( range: SourceRange ) => boolean, line: number ): number[]
    {
        const out: number[] = [];
        for( const s of this.steps )
        {
            if( !matches( s.stmt.range ) ) continue;
            if( s.stmt.range.source.lineAt( s.stmt.range.start ) === line ) out.push( s.index );
        }
        return out;
    }
}

/** `frame` (and what it called) now sits under a frame of depth `parentDepth` */
function setDepth( frame: MutableFrame, parentDepth: number ): void
{
    frame.depth = parentDepth + ( frame.fn.kind === "function" ? 1 : 0 );
    for( const c of frame.children ) setDepth( c, frame.depth );
}

/** `value` is the boolean `b` */
function isBool( value: CEKValueObj, b: boolean ): boolean
{
    return value instanceof CEKConst && ( value as any ).value === b;
}

function rangeContains( outer: SourceRange, inner: SourceRange ): boolean
{
    return outer.source === inner.source && outer.start <= inner.start && inner.end <= outer.end;
}

function fnDepth( fn: DebugFunction ): number
{
    let d = 0;
    for( let f = fn.parent; f !== undefined; f = f.parent ) d++;
    return d;
}

/** the statement of `fn` that `stmt` is in: itself, or where the closure (loop) holding it is */
function positionIn( stmt: DebugStmt, fn: DebugFunction ): DebugStmt | undefined
{
    if( stmt.fn === fn ) return stmt;
    for( let f: DebugFunction | undefined = stmt.fn; f !== undefined; f = f.parent )
    {
        if( f.parent === fn ) return f.definedAt;
    }
    return undefined;
}

/** whether `stmt` is `outer` or nested in it */
function isWithin( stmt: DebugStmt, outer: DebugStmt ): boolean
{
    for( let s: DebugStmt | undefined = stmt; s !== undefined; s = s.parent ) if( s === outer ) return true;
    return false;
}

/** whether `fn` is `outer` or written inside it */
function fnWithin( fn: DebugFunction, outer: DebugFunction ): boolean
{
    for( let f: DebugFunction | undefined = fn; f !== undefined; f = f.parent ) if( f === outer ) return true;
    return false;
}
