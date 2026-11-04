import { SourceRange } from "../../../ast/Source/SourceRange";
import { _ir_apps } from "../../../IR/IRNodes/IRApp";
import { IRDelayed } from "../../../IR/IRNodes/IRDelayed";
import { IRForced } from "../../../IR/IRNodes/IRForced";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import type { IRTerm } from "../../../IR/IRTerm";
import { mergeSortedStrArrInplace } from "../../../utils/array/mergeSortedStrArrInplace";
import { TirBytesT } from "../types/TirNativeType";
import { TirType } from "../types/TirType";
import { getUnaliased } from "../types/utils/getUnaliased";
import { ITirExpr } from "./ITirExpr";
import { _showIR } from "./TirShowExpr";
import { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";
import { firstStrictUse, markStrippedTrace, strippingTraces } from "../../../IR/sourceMap/irTraces";
import { IRFunc } from "../../../IR/IRNodes/IRFunc";
import { IRVar } from "../../../IR/IRNodes/IRVar";
import { strippedTrace } from "./strippedTrace";
import { TirLettedExpr } from "./TirLettedExpr";

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
        if( strippingTraces() )
        {
            // `removeTraces`: the program is the continuation; the map keeps the trace
            const trace = strippedTrace( "trace", this.range, this.traceExpr, () => this._messageIR( ctx ) );
            const continuation = this.continuation.toIR( ctx );
            // `trace v;` of a variable the continuation computes right away (`trace acc;
            // return acc;`, after a loop): without the trace, that is where `v` gets computed,
            // so the message is its value there, after whatever computing it logs
            const variable = this.traceExpr;
            if( trace.recipe !== undefined && variable instanceof TirLettedExpr )
            {
                const use = firstStrictUse( continuation, variable.irVarSym );
                if( use !== undefined )
                {
                    const value = Symbol( "traced" );
                    markStrippedTrace( use, {
                        kind: "trace",
                        range: this.range,
                        expression: trace.expression,
                        recipe: { ir: new IRFunc( [ value ], this._messageOf( new IRVar( value ) ) ).clone(), params: [] },
                    }, 3 );
                    return continuation;
                }
            }
            return markStrippedTrace( continuation, trace, 0 );
        }

        // Force(trace(msg, Delay(continuation)))
        // Delay prevents the continuation from being evaluated
        // as a trace argument; Force evaluates it after the
        // trace call has logged the message.
        // This gives correct trace order in loops and nested traces.
        const message = this._messageIR( ctx );
        return new IRForced(
            _ir_apps(
                IRNative.trace,
                message,
                new IRDelayed( this.continuation.toIR( ctx ) )
            )
        );
    }

    /** the message: the traced value as a string */
    private _messageIR( ctx: ToIRTermCtx ): IRTerm
    {
        return this._messageOf( this.traceExpr.toIR( ctx ) );
    }

    /** the message for `valueIR`, a value of the traced expression's type */
    private _messageOf( valueIR: IRTerm ): IRTerm
    {
        let bytesIR: IRTerm;
        const exprType = getUnaliased( this.traceExpr.type );

        if( exprType instanceof TirBytesT )
        {
            // bytes are assumed to already be valid UTF-8 — pass through
            // unchanged, as documented for the Show interface.
            bytesIR = valueIR;
        }
        else
        {
            // any other type implementing Show: dispatch through `_showIR`,
            // which uses the per-type compile-time table (int → decimal,
            // bool → "true"/"false", data → serialiseData+hex, struct →
            // user impl or auto-derive, list/map → recursive, ...).
            bytesIR = _showIR( exprType, valueIR );
        }

        return _ir_apps( IRNative.decodeUtf8, bytesIR );
    }
}
