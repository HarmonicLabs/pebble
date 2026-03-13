import { SourceRange } from "../../../ast/Source/SourceRange";
import { _ir_apps } from "../../../IR/IRNodes/IRApp";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import type { IRTerm } from "../../../IR/IRTerm";
import { TirBoolT } from "../types/TirNativeType/native/bool";
import { TirBytesT } from "../types/TirNativeType/native/bytes";
import { TirDataT } from "../types/TirNativeType/native/data";
import { TirIntT } from "../types/TirNativeType/native/int";
import { TirDataOptT } from "../types/TirNativeType/native/Optional/data";
import { TirStringT } from "../types/TirNativeType/native/string";
import { TirDataStructType } from "../types/TirStructType";
import { TirType } from "../types/TirType";
import { getUnaliased } from "../types/utils/getUnaliased";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { _inlineFromData } from "./TirFromDataExpr";
import { _inlineToData } from "./TirToDataExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";

export class TirTypeConversionExpr
    implements ITirExpr
{
    constructor(
        public expr: TirExpr,
        readonly type: TirType,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.expr.toString()} as ${this.type.toString()})`;
    }

    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat( indent );
        return (
            `(${this.expr.pretty( indent )} as ${this.type.toString()})`
        );
    }

    deps(): string[]
    {
        return this.expr.deps();
    }

    get isConstant(): boolean { return this.expr.isConstant; }

    clone(): TirExpr
    {
        return new TirTypeConversionExpr(
            this.expr.clone(),
            this.type.clone(),
            this.range.clone()
        );
    }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const from_t = getUnaliased( this.expr.type );
        const to_t = getUnaliased( this.type );
        const exprIR = this.expr.toIR( ctx );

        if(
            from_t instanceof TirDataT
            || from_t instanceof TirDataOptT
            || from_t instanceof TirDataStructType
        ) return _inlineFromData( to_t, exprIR );
        if( 
            to_t instanceof TirDataT
            || to_t instanceof TirDataOptT
            || to_t instanceof TirDataStructType
        ) return _inlineToData( from_t, exprIR );

        if( to_t instanceof TirIntT )
        {
            if( from_t instanceof TirIntT ) return exprIR;
            if( from_t instanceof TirBytesT ) return _ir_apps(
                IRNative._bytesToIntBE,
                exprIR
            );
            if( from_t instanceof TirBoolT ) return _ir_apps(
                IRNative._boolToInt,
                exprIR
            );
            throw new Error(`Cannot convert from ${from_t.toString()} to ${to_t.toString()}`);
        }
        if( to_t instanceof TirBytesT )
        {
            if( from_t instanceof TirBytesT ) return exprIR;
            if( from_t instanceof TirIntT ) return _ir_apps(
                IRNative._intToBytesBE, // internally handles int size
                exprIR
            );
            throw new Error(`Cannot convert from ${from_t.toString()} to ${to_t.toString()}`);
        }
        if( to_t instanceof TirBoolT )
        {
            if( from_t instanceof TirBoolT ) return exprIR;
            if( from_t instanceof TirIntT ) return _ir_apps(
                IRNative._intToBool,
                exprIR
            );
            throw new Error(`Cannot convert from ${from_t.toString()} to ${to_t.toString()}`);
        }

        if( to_t instanceof TirStringT )
        {
            if( from_t instanceof TirBytesT ) return _ir_apps(
                IRNative.decodeUtf8,
                exprIR
            );
            throw new Error(`Cannot convert from ${from_t.toString()} to ${to_t.toString()}`);
        }

        throw new Error(`Cannot convert from ${from_t.toString()} to ${to_t.toString()}`);
    }
}