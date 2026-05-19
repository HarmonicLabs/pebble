import { SourceRange } from "../../../ast/Source/SourceRange";
import type { IRTerm } from "../../../IR/IRTerm";
import { ResolveValueResult } from "../../AstCompiler/scope/AstScope";
import { TirType } from "../types/TirType";
import type { ITirExpr } from "./ITirExpr";
import type { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";

export class TirVariableAccessExpr
    implements ITirExpr
{
    readonly resolvedValue: Readonly<ResolveValueResult>;

    get type(): TirType {
        return this.resolvedValue.variableInfos.type;
    }
    constructor(
        resolvedValue: ResolveValueResult, 
        readonly range: SourceRange
    ) {
        this.resolvedValue = Object.freeze( resolvedValue );
    }

    toString(): string {
        return this.varName;
    }
    pretty( indent: number ): string {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `${this.varName}`;
    }

    clone(): TirExpr
    {
        return new TirVariableAccessExpr(
            {
                ...this.resolvedValue,
                variableInfos: {
                    ...this.resolvedValue.variableInfos,
                    type: this.resolvedValue.variableInfos.type.clone()
                },
                // isDefinedOutsideFuncScope: this.resolvedValue.isDefinedOutsideFuncScope
            },
            this.range.clone()
        );
    }
    
    get isConstant(): boolean { return false; }

    get varName(): string {
        return this.resolvedValue.variableInfos.name;
    }

    deps(): string[] { return [ this.varName ]; }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const ir = ctx.getVarAccessIR( this.varName );
        if( !ir ) {
            throw new Error(`variable '${this.varName}' is missing in [${ctx.allVariables().join(", ")}]`);
        }
        return ir;
    }
}