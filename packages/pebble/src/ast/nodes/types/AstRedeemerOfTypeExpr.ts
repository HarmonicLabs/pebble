import { SourceRange } from "../../Source/SourceRange";
import { HasSourceRange } from "../HasSourceRange";
import { AstNamedTypeExpr } from "./AstNamedTypeExpr";

/**
 * `redeemerof C` / `redeemerof C.State` — the redeemer union type of an
 * exported contract's direct methods, or of one of its states' spend
 * methods.
 *
 * `redeemerof` is a CONTEXTUAL keyword: it is only recognized in type
 * position when followed by another identifier, so a user type actually
 * named `redeemerof` keeps working.
 */
export class AstRedeemerOfTypeExpr implements HasSourceRange
{
    constructor(
        /** `C`, `C.State`, `ns.C`, `ns.C.State` (reuses qualified `path`) */
        readonly target: AstNamedTypeExpr,
        readonly range: SourceRange
    ) {}

    toAstName(): string
    {
        return "redeemerof " + this.target.toAstName();
    }
}
