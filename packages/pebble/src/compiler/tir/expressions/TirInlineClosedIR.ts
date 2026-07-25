import { SourceRange } from "../../../ast/Source/SourceRange";
import { IRHoisted } from "../../../IR/IRNodes/IRHoisted";
import type { IRTerm } from "../../../IR/IRTerm";
import { TirFuncT } from "../types/TirNativeType";
import { TirType } from "../types/TirType";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";



export class TirInlineClosedIR
    implements ITirExpr
{
    /**
     * only meaningful when this node holds a FUNCTION (the usual case: every
     * entry of `program.functions`). A closed-IR VALUE (e.g. the
     * `std.value.zero` constant) is never used in call position, so `sig()`
     * is never reached for one.
     */
    sig(): TirFuncT
    {
        return this.type as TirFuncT;
    }

    constructor(
        /**
         * `TirFuncT` for the function entries; any type for a closed-IR
         * constant registered in `program.constants`
         */
        readonly type: TirType,
        readonly getIr: ( ctx: ToIRTermCtx ) => IRTerm,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `<closed IR> as ${this.type.toString()}`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `<closed IR> as ${this.type.toString()}`;
    }

    get isConstant(): boolean { return true; }

    clone(): TirExpr
    {
        return new TirInlineClosedIR(
            this.type.clone(),
            this.getIr,
            this.range.clone()
        );
    }

    deps(): string[]
    {
        return []; // closed IR has no dependencies
    }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        // since closed, we can hoist to avoid duplications
        return new IRHoisted( this.getIr( ctx ) );
    }
}