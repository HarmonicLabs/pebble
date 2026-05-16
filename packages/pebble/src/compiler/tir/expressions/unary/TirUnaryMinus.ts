import { ITirExpr } from "../ITirExpr";
import { SourceRange } from "../../../../ast/Source/SourceRange";
import { TirExpr } from "../TirExpr";
import { ITirUnaryExpression } from "./ITirUnaryExpression";
import { TirType } from "../../types/TirType";
import { TirValueT } from "../../types/TirNativeType/native/value";
import { getUnaliased } from "../../types/utils/getUnaliased";
import { ToIRTermCtx } from "../ToIRTermCtx";
import { _ir_apps } from "../../../../IR/IRNodes/IRApp";
import { IRNative } from "../../../../IR/IRNodes/IRNative";
import type { IRTerm } from "../../../../IR/IRTerm";

export class TirUnaryMinus
    implements ITirExpr, ITirUnaryExpression
{
    constructor(
        public operand: TirExpr,
        readonly type: TirType,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `-${this.operand.toString()}`;
    }
    pretty( indent: number ): string
    {
        return `-${this.operand.pretty( indent )}`;
    }

    clone(): TirExpr
    {
        return new TirUnaryMinus(
            this.operand.clone(),
            this.type.clone(),
            this.range.clone()
        );
    }

    deps(): string[]
    {
        return this.operand.deps();
    }

    get isConstant(): boolean { return this.operand.isConstant; }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const operandTy = getUnaliased( this.operand.type );
        return _ir_apps(
            operandTy instanceof TirValueT ? IRNative._negateValue : IRNative._negateInt,
            this.operand.toIR( ctx )
        );
    }
}