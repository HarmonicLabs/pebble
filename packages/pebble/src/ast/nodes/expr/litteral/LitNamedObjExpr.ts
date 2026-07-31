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
        /**
         * Namespace segments BEFORE `typeName` when the literal is reached
         * through a qualified path (`M.S.C{ ... }` -> `[ M ]`, type `S`,
         * constructor `C`). Empty for the plain `Type.Constructor{ ... }`
         * and bare `Constructor{ ... }` forms.
         */
        readonly typePath: Identifier[] = [],
    ) {}
}