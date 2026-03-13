import { SourceRange } from "../../../ast/Source/SourceRange";
import { TirExpr } from "../expressions/TirExpr";
import { ITirStmt } from "./TirStmt";

export class TirTraceStmt
    implements ITirStmt
{
    constructor(
        /** must be string */
        public expr: TirExpr,
        readonly range: SourceRange,
    ) {}

    toString(): string
    {
        return `trace ${this.expr.toString()}`;
    }
    pretty( indent: number ): string
    {
        return `trace ${this.expr.pretty( indent )}`;
    }

    definitelyTerminates(): boolean { return false; }

    deps(): string[]
    {
        return this.expr.deps();
    }
}
