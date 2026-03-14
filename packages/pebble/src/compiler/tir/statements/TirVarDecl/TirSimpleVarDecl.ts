import { SourceRange } from "../../../../ast/Source/SourceRange";
import { TirExpr } from "../../expressions/TirExpr";
import { TirType } from "../../types/TirType";
import { ITirStmt, Termination } from "../TirStmt";
import { ITirVarDecl } from "./TirVarDecl";

export class TirSimpleVarDecl
    implements ITirStmt, ITirVarDecl
{
    constructor(
        readonly name: string,
        readonly type: TirType,
        public initExpr: TirExpr | undefined, // deconstructed OR function param
        public isConst: boolean,
        readonly range: SourceRange,
        /** range of explicit type annotation (e.g., `MyDatum` in `as MyDatum`) for LSP */
        readonly typeAnnotationRange?: SourceRange,
        /** original source name for internal-renamed params (e.g., `owner` for `§owner_0`) for LSP */
        readonly sourceName?: string,
    ) {
    }

    clone(): TirSimpleVarDecl
    {
        return new TirSimpleVarDecl(
            this.name,
            this.type,
            this.initExpr?.clone(),
            this.isConst,
            this.range
        );
    }

    toString(): string
    {
        return (
            `${this.isConst ? "const" : "let"} ${this.name}: ${this.type.toString()}` +
            ( this.initExpr ? ` = ${this.initExpr.toString()}` : "" )
        );
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat( indent );
        return (
            `${this.isConst ? "const" : "let"} ${this.name}: ${this.type.toString()}` +
            ( this.initExpr ? ` = ${this.initExpr.pretty( indent )}` : "" )
        );
    }

    deps(): string[]
    {
        return this.initExpr?.deps() ?? [];
    }

    definitelyTerminates(): boolean { return false; }

    introducedVars(): string[]
    {
        return [ this.name ];
    }
}