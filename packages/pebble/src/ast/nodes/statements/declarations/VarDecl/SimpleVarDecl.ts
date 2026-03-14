import { CommonFlags } from "../../../../../common";
import { SourceRange } from "../../../../Source/SourceRange";
import { Identifier } from "../../../common/Identifier";
import { PebbleExpr } from "../../../expr/PebbleExpr";
import { HasSourceRange } from "../../../HasSourceRange";
import { AstTypeExpr } from "../../../types/AstTypeExpr";
import { HasInitExpr } from "./HasInit";

export class SimpleVarDecl
    implements HasSourceRange, HasInitExpr
{
    constructor(
        readonly name: Identifier,
        public type: AstTypeExpr | undefined,
        public initExpr: PebbleExpr | undefined,
        public flags: CommonFlags,
        readonly range: SourceRange,
        /** original source name when the identifier was renamed internally (for LSP) */
        readonly sourceName?: string,
    ) {}

    isConst(): boolean
    {
        return (this.flags & CommonFlags.Const) !== 0;
    }

    static onlyIdentifier( identifier: Identifier, flags: CommonFlags ): SimpleVarDecl
    {
        return new SimpleVarDecl(
            identifier,
            undefined,
            undefined,
            flags,
            identifier.range
        );
    }

    static onlyNameConst( name: string, range: SourceRange ): SimpleVarDecl
    {
        return new SimpleVarDecl(
            new Identifier( name, range ),
            undefined, // type
            undefined, // initExpr
            CommonFlags.Const,
            range
        );
    }

}