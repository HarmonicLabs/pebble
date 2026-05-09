import { SourceRange } from "../../Source/SourceRange";
import { Identifier } from "../common/Identifier";
import { HasSourceRange } from "../HasSourceRange";
import { PebbleExpr } from "./PebbleExpr";

export class IsExpr
    implements HasSourceRange
{
    constructor(
        public instanceExpr: PebbleExpr,
        readonly ofConstr: Identifier,
        readonly range: SourceRange
    ) {}
}
