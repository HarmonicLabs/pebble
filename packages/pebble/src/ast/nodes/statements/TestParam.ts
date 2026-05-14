import { SourceRange } from "../../Source/SourceRange";
import { Identifier } from "../common/Identifier";
import { PebbleExpr } from "../expr/PebbleExpr";
import { AstTypeExpr } from "../types/AstTypeExpr";
import { HasSourceRange } from "../HasSourceRange";

/**
 * A parameter of a `test` declaration: `<name>: <type> ( via <expr> )?`.
 *
 * This is intentionally a separate node from `SimpleVarDecl` / `VarDecl` so the
 * `via` keyword cannot leak into function/method/contract parameter grammar.
 */
export class TestParam
    implements HasSourceRange
{
    constructor(
        readonly name: Identifier,
        readonly type: AstTypeExpr,
        readonly viaExpr: PebbleExpr | undefined,
        readonly range: SourceRange,
    ) {}
}
