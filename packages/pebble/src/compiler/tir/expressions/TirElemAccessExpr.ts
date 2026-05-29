import { CEKConst, Machine } from "@harmoniclabs/plutus-machine";
import { SourceRange } from "../../../ast/Source/SourceRange";
import { IRConst } from "../../../IR/IRNodes/IRConst";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import type { IRTerm } from "../../../IR/IRTerm";
import { mergeSortedStrArrInplace } from "../../../utils/array/mergeSortedStrArrInplace";
import { TirType } from "../types/TirType";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";
import { compileIRToUPLC } from "../../../IR/toUPLC/compileIRToUPLC";
import { _ir_apps } from "../../../IR/IRNodes/IRApp";

/**
 * `arrLikeExpr[ indexExpr ]`
 */
export class TirElemAccessExpr
    implements ITirExpr
{
    constructor(
        public arrLikeExpr: TirExpr,
        public indexExpr: TirExpr,
        readonly type: TirType,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `${this.arrLikeExpr.toString()}[ ${this.indexExpr.toString()} ]`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `${this.arrLikeExpr.pretty(indent)}[ ${this.indexExpr.pretty(indent)} ]`;
    }
    
    clone(): TirExpr
    {
        return new TirElemAccessExpr(
            this.arrLikeExpr.clone(),
            this.indexExpr.clone(),
            this.type.clone(),
            this.range.clone()
        );
    }

    deps(): string[]
    {
        const deps: string[] = this.arrLikeExpr.deps();
        mergeSortedStrArrInplace( deps, this.indexExpr.deps() );
        return deps;
    }

    get isConstant(): boolean
    {
        return this.arrLikeExpr.isConstant && this.indexExpr.isConstant;
    }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        let irArr = this.arrLikeExpr.toIR( ctx );
        let irIndex = this.indexExpr.toIR( ctx );
        if( this.indexExpr.isConstant )
        {
            const result = Machine.evalSimple(
                compileIRToUPLC( irIndex )
            );
            if(
                ( result instanceof CEKConst )
                && (typeof result.value === "number" || typeof result.value === "bigint" )
            ) return _ir_apps(
                IRNative.headList,
                _ir_apps(
                    IRNative.dropList,
                    IRConst.int( result.value ),
                    irArr,
                )
            );
        }

        return _ir_apps(
            IRNative.headList,
            _ir_apps(
                IRNative.dropList,
                irIndex,
                irArr,
            )
        );
    }
}