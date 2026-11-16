import { SourceRange } from "../../../Source/SourceRange";
import { HasSourceRange } from "../../HasSourceRange";
import { PebbleExpr } from "../PebbleExpr";

/**
 * a map literal: `{ #01: 10, #02: 20 }`, a `LinearMap<K, V>`.
 *
 * The parser builds one when at least one key is not a bare identifier. A brace literal
 * whose keys are ALL bare identifiers (`{ a: 1 }`, and the empty `{}`) is a `LitObjExpr`:
 * the parser cannot tell a struct's fields from a map's keys, the expected type does (see
 * `_compileLitteralObjExpr`).
 */
export class LitMapExpr
    implements HasSourceRange
{
    constructor(
        readonly keys: PebbleExpr[],
        readonly values: PebbleExpr[],
        readonly range: SourceRange
    ) {}
}
