import { ITirExpr } from "../ITirExpr";
import { SourceRange } from "../../../../ast/Source/SourceRange";
import { TirEnumType } from "../../types/TirEnumType";
import { ToIRTermCtx } from "../ToIRTermCtx";
import { IRConst, IRTerm } from "../../../../IR";
import type { TirExpr } from "../TirExpr";

export class TirLitEnumMemberExpr
    implements ITirExpr
{
    readonly isConstant: boolean = true;

    constructor(
        readonly type: TirEnumType,
        readonly memberIdx: number,
        readonly range: SourceRange
    ) {}

    get memberName(): string { return this.type.members[ this.memberIdx ]; }

    pretty(): string { return this.toString(); }
    toString(): string
    {
        return `${this.type.name}.${this.memberName}`;
    }

    clone(): TirExpr
    {
        return new TirLitEnumMemberExpr(
            this.type.clone(),
            this.memberIdx,
            this.range.clone()
        );
    }

    deps(): string[] { return []; }

    toIR( _ctx: ToIRTermCtx ): IRTerm
    {
        return IRConst.int( BigInt( this.memberIdx ) );
    }
}
