import { SourceRange } from "../../Source/SourceRange";
import { Identifier } from "../common/Identifier";
import { HasSourceRange } from "../HasSourceRange";
import { AstTypeExpr } from "./AstTypeExpr";

/**
 * struct, aliases and respective params
 */
export class AstNamedTypeExpr implements HasSourceRange
{
    constructor(
        readonly name: Identifier,
        readonly tyArgs: AstTypeExpr[],
        readonly range: SourceRange,
        /**
         * leading qualifiers of a TS-style qualified type name
         * (`Ns.Type`, `Struct.Constructor`, `Contract.State`);
         * empty for a plain (unqualified) type name.
         */
        readonly path: Identifier[] = []
    ) {}

    toAstName() {
        return this.path.length === 0
            ? this.name.text
            : this.path.map( p => p.text ).join(".") + "." + this.name.text;
    }
}