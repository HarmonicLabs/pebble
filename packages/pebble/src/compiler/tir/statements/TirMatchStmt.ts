import { HasSourceRange } from "../../../ast/nodes/HasSourceRange";
import { SourceRange } from "../../../ast/Source/SourceRange";
import { filterSortedStrArrInplace } from "../../../utils/array/filterSortedStrArrInplace";
import { mergeSortedStrArrInplace } from "../../../utils/array/mergeSortedStrArrInplace";
import { TirCasePattern } from "../expressions/TirCaseExpr";
import { TirExpr } from "../expressions/TirExpr";
import { ITirStmt, TirStmt } from "./TirStmt";
import { TirNamedDeconstructVarDecl } from "./TirVarDecl/TirNamedDeconstructVarDecl";
export class TirMatchStmt
    implements ITirStmt
{
    constructor(
        readonly matchExpr: TirExpr,
        readonly cases: TirMatchStmtCase[],
        public wildcardCase: TirMatchStmtWildcardCase | undefined,
        readonly range: SourceRange,
    ) {}

    toString(): string
    {
        return (
            `match ( ${this.matchExpr.toString()} ) { ` +
            this.cases.map( c =>
                `when ${c.pattern.toString()}: ${c.body.toString()};`
            ).join(" ") +
            ( this.wildcardCase ? ` else ${this.wildcardCase.body.toString()};` : "" ) +
            ` }`
        );
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat( indent );
        const indent_0 = "\n" + indent_base;
        const indent_1 = indent_0 + singleIndent;

        const caseParts = this.cases.map(
            c => `when ${c.pattern.pretty( indent + 1 )}: ${c.body.pretty( indent + 1 )}`
        );
        const casesPart = caseParts.length > 0
            ? indent_1 + caseParts.join(`;${indent_1}`) + ";"
            : "";
        const wildcardPart = this.wildcardCase
            ? indent_1 + `else ${this.wildcardCase.body.pretty( indent + 1 )};`
            : "";

        if( caseParts.length === 0 && !this.wildcardCase )
        {
            return (
                `match (` +
                indent_1 + this.matchExpr.pretty( indent + 1 ) +
                `${indent_0}) { }`
            );
        }

        return (
            `match (` +
            indent_1 + this.matchExpr.pretty( indent + 1 ) +
            `${indent_0}) {` +
            casesPart +
            wildcardPart +
            `${indent_0}}`
        );
    }

    /**
     * Every way through the statement: the named cases, then the `else` arm.
     *
     * The `else` arm is stored apart from `cases` because it has no pattern,
     * but it is an arm like the others: whatever asks what this statement can
     * do — terminate, fail, reassign a variable, `continue` a loop — has to
     * ask it of these, not of `cases` alone.
     */
    arms(): ( TirMatchStmtCase | TirMatchStmtWildcardCase )[]
    {
        return this.wildcardCase ? [ ...this.cases, this.wildcardCase ] : this.cases.slice();
    }

    definitelyTerminates(): boolean
    {
        return this.arms().every(({ body }) => body.definitelyTerminates());
    }

    deps(): string[]
    {
        const deps = this.matchExpr.deps();
        for (const caseStmt of this.cases) {
            mergeSortedStrArrInplace(
                deps,
                caseStmt.deps()
            );
        }
        if( this.wildcardCase ) mergeSortedStrArrInplace(
            deps,
            this.wildcardCase.deps()
        );
        return deps;
    }
}

export class TirMatchStmtCase
    implements HasSourceRange
{
    constructor(
        public pattern: TirNamedDeconstructVarDecl,
        public body: TirStmt,
        readonly range: SourceRange,
    ) {}

    deps(): string[]
    {
        const introducedVars = this.pattern.introducedVars();
        return filterSortedStrArrInplace(
            this.body.deps(),
            introducedVars
        );
    }
}

export class TirMatchStmtWildcardCase
    implements HasSourceRange
{
    constructor(
        public body: TirStmt,
        readonly range: SourceRange,
    ) {}

    deps(): string[]
    {
        return this.body.deps();
    }
}