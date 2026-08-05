import { SourceRange } from "../../../ast/Source/SourceRange";
import { TirExpr } from "../expressions/TirExpr";
import { TirVariableAccessExpr } from "../expressions/TirVariableAccessExpr";
import { ITirStmt } from "./TirStmt";

export class TirAssignmentStmt
    implements ITirStmt
{
    constructor(
        readonly varIdentifier: TirVariableAccessExpr,
        readonly assignedExpr: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `${this.varIdentifier.toString()} = ${this.assignedExpr.toString()};`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat( indent );
        return `${this.varIdentifier.pretty( indent )} = ${this.assignedExpr.pretty( indent )}`;
    }

    definitelyTerminates(): boolean { return false; }

    clone(): TirAssignmentStmt
    {
        return new TirAssignmentStmt(
            this.varIdentifier.clone() as TirVariableAccessExpr,
            this.assignedExpr.clone(),
            this.range
        );
    }

    deps(): string[]
    {
        return this.varIdentifier.deps();
    }
}