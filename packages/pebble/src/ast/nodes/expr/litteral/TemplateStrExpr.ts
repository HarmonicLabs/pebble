import { SourceRange } from "../../../Source/SourceRange";
import { HasSourceRange } from "../../HasSourceRange";
import { PebbleExpr } from "../PebbleExpr";

/**
 * A template string literal: backtick-delimited text with `${expr}`
 * interpolation slots — e.g. `` `hello ${name}, count is ${n}` ``.
 *
 * Stored as alternating literal text fragments and interpolated expressions.
 * For a template with N interpolations, `parts.length === N + 1`.
 *
 * Compilation produces a chain of UTF-8 byte concatenations:
 *
 *   parts[0]_bytes
 *     ++ show-or-passthrough( exprs[0] )
 *     ++ parts[1]_bytes
 *     ++ show-or-passthrough( exprs[1] )
 *     ++ ...
 *     ++ parts[N]_bytes
 *
 * For each interpolated expression: if its type is `bytes` it is passed
 * through verbatim (assumed to already be valid UTF-8 — same convention as
 * `trace`); otherwise the compiler implicitly inserts `.show()` via the
 * built-in Show interface dispatch.
 */
export class TemplateStrExpr
    implements HasSourceRange
{
    constructor(
        readonly parts: string[],
        readonly exprs: PebbleExpr[],
        readonly range: SourceRange,
    ) {
        if( parts.length !== exprs.length + 1 )
        {
            throw new Error(
                `TemplateStrExpr: parts.length (${parts.length}) must equal ` +
                `exprs.length + 1 (${exprs.length + 1})`
            );
        }
    }
}
