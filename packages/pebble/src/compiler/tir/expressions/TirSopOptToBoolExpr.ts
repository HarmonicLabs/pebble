import { SourceRange } from "../../../ast/Source/SourceRange";
import { IRCase } from "../../../IR/IRNodes/IRCase";
import { IRConst } from "../../../IR/IRNodes/IRConst";
import { IRFunc } from "../../../IR/IRNodes/IRFunc";
import type { IRTerm } from "../../../IR/IRTerm";
import { bool_t } from "../program/stdScope/stdScope";
import { TirSopOptT } from "../types/TirNativeType/native/Optional/sop";
import { TirType } from "../types/TirType";
import { getUnaliased } from "../types/utils/getUnaliased";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";

/**
 * Converts a SoP Optional value to a boolean at the IR level
 * using `case(opt, [\_ -> true, false])`.
 *
 * This is needed because `ifThenElse` expects a boolean, but
 * SoP Optional values are Constr nodes, not boolean constants.
 */
export class TirSopOptToBoolExpr implements ITirExpr
{
    readonly type: TirType = bool_t;

    constructor(
        public readonly operand: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string { return `isSome(${this.operand.toString()})`; }
    pretty(indent: number): string { return `isSome(${this.operand.pretty(indent)})`; }

    clone(): TirExpr {
        return new TirSopOptToBoolExpr(this.operand.clone(), this.range.clone());
    }

    deps(): string[] { return this.operand.deps(); }

    get isConstant(): boolean { return this.operand.isConstant; }

    toIR(ctx: ToIRTermCtx): IRTerm {
        const unusedSym = Symbol("_some_val");
        return new IRCase(
            this.operand.toIR(ctx),
            [
                // Some{ value } => true
                new IRFunc([unusedSym], IRConst.bool(true)),
                // None => false
                IRConst.bool(false)
            ]
        );
    }

    /**
     * Wraps the expression in TirSopOptToBoolExpr if its type is SoP Optional,
     * otherwise returns it as-is.
     */
    static wrapIfNeeded(expr: TirExpr): TirExpr {
        const t = getUnaliased(expr.type);
        if (t instanceof TirSopOptT) {
            return new TirSopOptToBoolExpr(expr, expr.range);
        }
        return expr;
    }
}
