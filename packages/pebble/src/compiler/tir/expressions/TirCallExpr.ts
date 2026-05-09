import { SourceRange } from "../../../ast/Source/SourceRange";
import { _ir_apps } from "../../../IR/IRNodes/IRApp";
import { IRForced } from "../../../IR/IRNodes/IRForced";
import type { IRTerm } from "../../../IR/IRTerm";
import { mergeSortedStrArrInplace } from "../../../utils/array/mergeSortedStrArrInplace";
import { TirType } from "../types/TirType";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";

export class TirCallExpr implements ITirExpr
{
    constructor(
        public func: TirExpr,
        readonly args: TirExpr[],
        readonly type: TirType,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `${this.func.toString()}( ${this.args.map( a => a.toString() ).join(", ")} )`;
    }
    pretty( indent: number = 1 ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat( indent );
        const indent_0 = "\n" + indent_base;
        const indent_1 = indent_0 + singleIndent;

        if (this.args.length === 0) {
            return `${this.func.pretty(indent)}()`;
        }

        return (
            `${this.func.pretty(indent)}(` +
            indent_1 + this.args.map(arg => arg.pretty(indent + 1)).join(`,${indent_1}`) +
            `${indent_0})`
        );
    }

    clone(): TirExpr
    {
        return new TirCallExpr(
            this.func.clone(),
            this.args.map( a => a.clone() ),
            this.type.clone(),
            this.range.clone()
        );
    }

    deps(): string[]
    {
        const deps: string[] = this.func.deps();
        for (const arg of this.args) {
            mergeSortedStrArrInplace( deps, arg.deps() );
        }
        return deps;
    }

    get isConstant(): boolean { return false; }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        if( this.args.length === 0 ) {
            return new IRForced( this.func.toIR( ctx ) );
        }
        return _ir_apps(
            this.func.toIR( ctx ),
            ...(this.args.map( arg => arg.toIR( ctx ) ) as [ IRTerm ]),
        );
    }
}