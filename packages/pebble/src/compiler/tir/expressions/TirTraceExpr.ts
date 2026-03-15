import { SourceRange } from "../../../ast/Source/SourceRange";
import { _ir_apps } from "../../../IR/IRNodes/IRApp";
import { IRDelayed } from "../../../IR/IRNodes/IRDelayed";
import { IRForced } from "../../../IR/IRNodes/IRForced";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import type { IRTerm } from "../../../IR/IRTerm";
import { hoisted_intToUtf8Bytes } from "../../../IR/tree_utils/intToUtf8Bytes";
import { mergeSortedStrArrInplace } from "../../../utils/array/mergeSortedStrArrInplace";
import { TirIntT } from "../types/TirNativeType";
import { TirType } from "../types/TirType";
import { getUnaliased } from "../types/utils/getUnaliased";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";

export class TirTraceExpr
    implements ITirExpr
{
    get type(): TirType { return this.continuation.type; }

    constructor(
        /** must be bytes or int (converted to string via decodeUtf8 in toIR) */
        public traceExpr: TirExpr,
        public continuation: TirExpr,
        readonly range: SourceRange,
    ) {}

    toString(): string
    {
        return `(trace ${this.traceExpr.toString()} ${this.continuation.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        const indent_1 = indent_base + singleIndent;

        return (
            `(trace` +
            `\n${indent_1}${this.traceExpr.pretty(indent + 1)}` +
            `\n${indent_1}${this.continuation.pretty(indent + 1)}` +
            `\n${indent_base})`
        );
    }

    clone(): TirExpr
    {
        return new TirTraceExpr(
            this.traceExpr.clone(),
            this.continuation.clone(),
            this.range.clone()
        );
    }

    deps(): string[]
    {
        return mergeSortedStrArrInplace(
            this.traceExpr.deps(),
            this.continuation.deps()
        );
    }

    get isConstant(): boolean { return this.traceExpr.isConstant && this.continuation.isConstant; }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        let bytesIR: IRTerm;
        const exprType = getUnaliased( this.traceExpr.type );

        if( exprType instanceof TirIntT )
        {
            // int -> bytes via intToUtf8Bytes
            bytesIR = _ir_apps( hoisted_intToUtf8Bytes.clone(), this.traceExpr.toIR( ctx ) );
        }
        else
        {
            // assume bytes
            bytesIR = this.traceExpr.toIR( ctx );
        }

        // Force(trace(msg, Delay(continuation)))
        // Delay prevents the continuation from being evaluated
        // as a trace argument; Force evaluates it after the
        // trace call has logged the message.
        // This gives correct trace order in loops and nested traces.
        return new IRForced(
            _ir_apps(
                IRNative.trace,
                _ir_apps( IRNative.decodeUtf8, bytesIR ),
                new IRDelayed( this.continuation.toIR( ctx ) )
            )
        );
    }
}
