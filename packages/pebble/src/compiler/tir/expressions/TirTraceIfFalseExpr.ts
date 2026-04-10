import { SourceRange } from "../../../ast/Source/SourceRange";
import { mergeSortedStrArrInplace } from "../../../utils/array/mergeSortedStrArrInplace";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { bool_t } from "../program/stdScope/stdScope";
import { TirType } from "../types/TirType";
import { ToIRTermCtx } from "./ToIRTermCtx";
import { IRConst } from "../../../IR/IRNodes/IRConst";
import { IRDelayed } from "../../../IR/IRNodes/IRDelayed";
import { IRForced } from "../../../IR/IRNodes/IRForced";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import type { IRTerm } from "../../../IR/IRTerm";
import { _ir_apps } from "../../../IR/IRNodes/IRApp";
import { _ir_lazyIfThenElse } from "../../../IR/tree_utils/_ir_lazyIfThenElse";
import { IRCase, IRConstr } from "../../../IR/IRNodes";
import { IRFunc } from "../../../IR/IRNodes/IRFunc";
import { TirSopOptT } from "../types/TirNativeType/native/Optional/sop";
import { getUnaliased } from "../types/utils/getUnaliased";

export class TirTraceIfFalseExpr
    implements ITirExpr
{
    readonly type: TirType = bool_t;

    constructor(
        /** must be boolean or Optional */
        public condition: TirExpr,
        /** must be string */ 
        public traceStrExpr: TirExpr,
        readonly range: SourceRange,
    ) {}

    toString(): string
    {
        return `traceIfFalse( ${this.condition.toString()}, ${this.traceStrExpr.toString()} )`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        const indent_1 = indent_base + singleIndent;

        return (
            `traceIfFalse(` +
            `\n${indent_1}${this.condition.pretty(indent + 1)},` +
            `\n${indent_1}${this.traceStrExpr.pretty(indent + 1)}` +
            `\n${indent_base})`
        );
    }

    clone(): TirExpr
    {
        return new TirTraceIfFalseExpr(
            this.condition.clone(),
            this.traceStrExpr.clone(),
            this.range.clone()
        );
    }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const condType = getUnaliased( this.condition.type );

        // SoP Optional: use case expression to convert to bool
        if( condType instanceof TirSopOptT )
        {
            const unusedSym = Symbol("_some_val");
            return new IRCase(
                this.condition.toIR( ctx ),
                [
                    // Some{ value } => true
                    new IRFunc( [ unusedSym ], IRConst.bool( true ) ),
                    // None => trace(msg, false)
                    _ir_apps(
                        IRNative.trace,
                        this.traceStrExpr.toIR( ctx ),
                        IRConst.bool( false )
                    )
                ]
            );
        }

        return _ir_lazyIfThenElse(
            // condition
            this.condition.toIR( ctx ),
            // then
            IRConst.bool( true ),
            // else
            _ir_apps(
                IRNative.trace,
                this.traceStrExpr.toIR( ctx ),
                IRConst.bool( false )
            )
        );
    }

    get isConstant(): boolean { return this.condition.isConstant && this.traceStrExpr.isConstant; }

    deps(): string[]
    {
        return mergeSortedStrArrInplace(
            this.condition.deps(),
            this.traceStrExpr.deps()
        );
    }
}