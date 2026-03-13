import { SourceRange } from "../../Source/SourceRange";
import { PebbleExpr } from "../expr/PebbleExpr";
import { HasSourceRange } from "../HasSourceRange";

export class TraceStmt
    implements HasSourceRange
{
    constructor(
        /** expression to trace (must be string) */
        public expr: PebbleExpr,
        readonly range: SourceRange,
    ) {}
}
