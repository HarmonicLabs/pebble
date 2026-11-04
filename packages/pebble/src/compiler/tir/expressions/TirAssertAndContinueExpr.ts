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

        if( this.conditions.length <= 0 ) return irContinuation;

        // sourcemaps: the conditions share one `error`, which has a location only when it
        // stands for a single assert; the glue around them belongs to no assert
        const nConditions = this.conditions.length;
        const lastAssertRange = this.assertRanges.pop();
        let irConditions: IRTerm = markAssertCondition( this.conditions.pop()!.toIR( ctx ), lastAssertRange );

        irConditions = this.conditions.reduce(( ir, cond, i ) => withoutRange( _ir_apps(
            IRNative._strictAnd,
            ir,
            markAssertCondition( cond.toIR( ctx ), this.assertRanges[i] ),
        )), irConditions );

        const error = new IRError();
        error.meta.range = nConditions === 1 && isSourceRange( lastAssertRange ) ? lastAssertRange : null;
        // `removeTraces`: an assert's message prints when its condition is false; the optimizer
        // may rewrite the condition (`x > 0` checked as `x <= 0`), so a lone assert's `error`,
        // which fails for it alone, prints the message too (the replay prints it once)
        if( nConditions === 1 )
        {
            const messages = ( irMeta( irConditions ).tracePoints ?? [] ).filter( p => p.when === 1 );
            if( messages.length > 0 ) irMeta( error ).tracePoints = messages.map( p => ({ trace: p.trace, when: 2 }) );
        }
        const delayedContinuation = new IRDelayed( irContinuation );
        const delayedError = new IRDelayed( error );
        delayedContinuation.meta.range = null;
        delayedError.meta.range = null;

        const forced = new IRForced( withoutRange( _ir_apps(
            IRNative.strictIfThenElse,
            irConditions,
            delayedContinuation,
            delayedError
        )));
        forced.meta.range = null;
        return forced;
    }

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