import { SourceRange } from "../../../ast/Source/SourceRange";
import { _ir_apps, IRApp } from "../../../IR/IRNodes/IRApp";
import { irMeta, isSourceRange } from "../../../IR/sourceMap/irRanges";
import { IRDelayed } from "../../../IR/IRNodes/IRDelayed";
import { IRError } from "../../../IR/IRNodes/IRError";
import { IRForced } from "../../../IR/IRNodes/IRForced";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import type { IRTerm } from "../../../IR/IRTerm";
import { mergeSortedStrArrInplace } from "../../../utils/array/mergeSortedStrArrInplace";
import { TirAssertStmt } from "../statements/TirAssertStmt";
import { TirType } from "../types/TirType";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";

export class TirAssertAndContinueExpr
    implements ITirExpr
{
    get type(): TirType
    {
        return this.continuation.type;
    }
    constructor(
        public conditions: TirExpr[],
        public continuation: TirExpr,
        readonly range: SourceRange,
        /** range of the assert statement of each condition */
        public assertRanges: SourceRange[] = []
    ) {}

    toString(): string
    {
        return `assert ${this.conditions.map( c => c.toString() ).join(" && " )} then ${this.continuation.toString()}`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        const indent_0 = "\n" + indent_base;
        const indent_1 = indent_0 + singleIndent;

        const conditionsPart = this.conditions.map(
            c => c.pretty(indent)
        ).join(` &&${indent_1}`);

        return (
            `assert ${conditionsPart}` +
            `${indent_0}then ${this.continuation.pretty(indent)}`
        );
    }

    /// @ts-ignore Return type annotation circularly references itself.
    clone(): TirExpr
    {
        return new TirAssertAndContinueExpr(
            this.conditions.map( c => c.clone() ),
            this.continuation.clone(),
            this.range.clone(),
            this.assertRanges.slice()
        );
    }

    static fromStmtsAndContinuation(
        assertions: TirAssertStmt[],
        continuation: TirExpr,
    ): TirExpr
    {
        if( assertions.length <= 0 ) return continuation;

        const correctAssertions = assertions.map( a => a.toSafeCondition() );
        const assertRanges = assertions.map( a => a.range );
        assertions.length = 0;
        return new TirAssertAndContinueExpr(
            correctAssertions,
            continuation,
            continuation.range,
            assertRanges
        );
    }

    deps(): string[]
    {
        return (
            this.conditions
            .reduce(( accum, cond ) => 
                mergeSortedStrArrInplace( accum, cond.deps() ),
                this.continuation.deps()
            )
        );
    }

    get isConstant(): boolean { return this.continuation.isConstant; }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const irContinuation = this.continuation.toIR( ctx );

        // the asserts one after the other, in source order: each condition is computed only
        // when the ones before it held, and a false one fails on its own `error`, with its own
        // message and location (merged into one condition, they were checked last first and
        // all of them computed)
        const conditions = this.conditions.map( ( cond, i ) => markAssertCondition( cond.toIR( ctx ), this.assertRanges[i] ) );
        let ir = irContinuation;
        for( let i = conditions.length - 1; i >= 0; i-- ) ir = assertThen( conditions[i], this.assertRanges[i], ir );
        return ir;
    }

}

/** `continuation` when `condition` holds, else the assert's failure */
function assertThen( condition: IRTerm, assertRange: SourceRange | undefined, continuation: IRTerm ): IRTerm
{
    // sourcemaps: the `error` stands for the assert; the glue around it belongs to no assert
    const error = new IRError();
    error.meta.range = isSourceRange( assertRange ) ? assertRange : null;
    // `removeTraces`: the message prints when the condition is false; the optimizer may rewrite
    // the condition (`x < 20` checked as `20 <= x`), so the `error`, which fails for this
    // assert alone, prints it too (the replay prints it once)
    const messages = ( irMeta( condition ).tracePoints ?? [] ).filter( p => p.when === 1 );
    if( messages.length > 0 ) irMeta( error ).tracePoints = messages.map( p => ({ trace: p.trace, when: 2 }) );

    const delayedContinuation = new IRDelayed( continuation );
    const delayedError = new IRDelayed( error );
    delayedContinuation.meta.range = null;
    delayedError.meta.range = null;

    const forced = new IRForced( withoutRange( _ir_apps(
        IRNative.strictIfThenElse,
        condition,
        delayedContinuation,
        delayedError
    )));
    forced.meta.range = null;
    return forced;
}

function markAssertCondition( ir: IRTerm, assertRange: SourceRange | undefined ): IRTerm
{
    if( isSourceRange( assertRange ) ) irMeta( ir ).assertCond = assertRange;
    return ir;
}

/** `null` range on an application spine and its function; the arguments keep theirs */
function withoutRange( app: IRTerm ): IRTerm
{
    let node: IRTerm = app;
    while( node instanceof IRApp )
    {
        node.meta.range = null;
        node = node.fn;
    }
    irMeta( node ).range = null;
    return app;
}