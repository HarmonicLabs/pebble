import { SourceRange } from "../../../../ast/Source/SourceRange";
import { CommonFlags } from "../../../../common";
import { mergeSortedStrArrInplace } from "../../../../utils/array/mergeSortedStrArrInplace";
import { TirExpr } from "../../expressions/TirExpr";
import { TirType } from "../../types/TirType";
import { ITirStmt, Termination } from "../TirStmt";
import { ITirVarDecl, TirVarDecl } from "./TirVarDecl";

export class TirNamedDeconstructVarDecl
    implements ITirStmt, ITirVarDecl
{
    constructor(
        /** only original (not aliased) constr name used in destructuring */
        readonly constrName: string,
        readonly fields: Map<string, TirVarDecl>,
        readonly rest: string | undefined,
        public type: TirType,
        public initExpr: TirExpr | undefined,
        public isConst: boolean,
        readonly range: SourceRange,
        /** range of just the constructor name identifier (for LSP) */
        readonly constrNameRange?: SourceRange,
        /** source ranges and constructor-definition types of field label identifiers (for LSP hover) */
        readonly fieldLabelRanges?: Map<string, { range: SourceRange, type: TirType }>,
        /** range of explicit type annotation (e.g., `MyDatum` in `as MyDatum`) for LSP */
        readonly typeAnnotationRange?: SourceRange,
    ) {}

    toString(): string
    {
        return (
            `${this.isConst ? "const" : "let"} ` +
            `${this.constrName}{ ` +
            Array.from( this.fields.entries() )
            .map( ([ name, decl ]) => 
                `${name}: ${decl.toString()}`
            ).join(", ") +
            ( this.rest ? `, ...${this.rest}` : "" ) +
            ` }` +
            ( this.initExpr ? ` = ${this.initExpr.toString()}` : "" )
        );
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat( indent );
        const indent_0 = "\n" + indent_base;
        const indent_1 = indent_0 + singleIndent;

        const fieldEntries = Array.from( this.fields.entries() ).map(
            ([ name, decl ]) => `${name}: ${decl.pretty( indent + 1 )}`
        );

        const fieldsPart =
            fieldEntries.length === 0
            ? ""
            : indent_1 + fieldEntries.join(`,${indent_1}`);

        const restPart =
            this.rest
            ? ( fieldEntries.length === 0 ? indent_1 : `,${indent_1}` ) + `...${this.rest}`
            : "";

        const closing = fieldEntries.length === 0 && !this.rest ? " { }" : `${indent_0}}`;

        return (
            `${this.isConst ? "const" : "let"} ${this.constrName}{` +
            fieldsPart +
            restPart +
            closing +
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
        const introducedVars: string[] = [];
        for (const field of this.fields.values()) {
            mergeSortedStrArrInplace( introducedVars, field.introducedVars() );
        }
        if (this.rest) mergeSortedStrArrInplace( introducedVars, [ this.rest ] );
        return introducedVars;
    }
}