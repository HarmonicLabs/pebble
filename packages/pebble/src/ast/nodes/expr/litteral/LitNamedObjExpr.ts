import { SourceRange } from "../../../Source/SourceRange";
import { Identifier } from "../../common/Identifier";
import { HasSourceRange } from "../../HasSourceRange";
import { PebbleExpr } from "../PebbleExpr";
import { ILibObjExpr } from "./LitObjExpr";

export class LitNamedObjExpr
    implements HasSourceRange, ILibObjExpr
{
    constructor(
        readonly name: Identifier,
        readonly fieldNames: Identifier[],
        readonly values: PebbleExpr[],
        readonly range: SourceRange,
        /** When using `Type.Constructor{ ... }` syntax, this is the type name */
        readonly typeName: Identifier | undefined = undefined,
    ) {}
}