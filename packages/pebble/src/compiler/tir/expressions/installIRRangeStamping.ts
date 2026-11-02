import type { IRTerm } from "../../../IR/IRTerm";
import type { SourceRange } from "../../../ast/Source/SourceRange";
import type { ToIRTermCtx } from "./ToIRTermCtx";
import { stampRange } from "../../../IR/sourceMap/irRanges";
import * as TirBinaryExpr from "./binary/TirBinaryExpr";
import * as TirLitArrExpr from "./litteral/TirLitArrExpr";
import * as TirLitEnumMemberExpr from "./litteral/TirLitEnumMemberExpr";
import * as TirLitFailExpr from "./litteral/TirLitFailExpr";
import * as TirLitFalseExpr from "./litteral/TirLitFalseExpr";
import * as TirLitHexBytesExpr from "./litteral/TirLitHexBytesExpr";
import * as TirLitIntExpr from "./litteral/TirLitIntExpr";
import * as TirLitNamedObjExpr from "./litteral/TirLitNamedObjExpr";
import * as TirLitObjExpr from "./litteral/TirLitObjExpr";
import * as TirLitStrExpr from "./litteral/TirLitStrExpr";
import * as TirLitThisExpr from "./litteral/TirLitThisExpr";
import * as TirLitTrueExpr from "./litteral/TirLitTrueExpr";
import * as TirLitUndefExpr from "./litteral/TirLitUndefExpr";
import * as TirLitVoidExpr from "./litteral/TirLitVoidExpr";
import * as TirAssertAndContinueExpr from "./TirAssertAndContinueExpr";
import * as TirCallExpr from "./TirCallExpr";
import * as TirCaseExpr from "./TirCaseExpr";
import * as TirElemAccessExpr from "./TirElemAccessExpr";
import * as TirFailExpr from "./TirFailExpr";
import * as TirFromDataExpr from "./TirFromDataExpr";
import * as TirFuncExpr from "./TirFuncExpr";
import * as TirHoistedExpr from "./TirHoistedExpr";
import * as TirInlineClosedIR from "./TirInlineClosedIR";
import * as TirIsExpr from "./TirIsExpr";
import * as TirLettedExpr from "./TirLettedExpr";
import * as TirNativeFunc from "./TirNativeFunc";
import * as TirParentesizedExpr from "./TirParentesizedExpr";
import * as TirPropAccessExpr from "./TirPropAccessExpr";
import * as TirShowExpr from "./TirShowExpr";
import * as TirSopOptToBoolExpr from "./TirSopOptToBoolExpr";
import * as TirTernaryExpr from "./TirTernaryExpr";
import * as TirToDataExpr from "./TirToDataExpr";
import * as TirTraceExpr from "./TirTraceExpr";
import * as TirTraceIfFalseExpr from "./TirTraceIfFalseExpr";
import * as TirTypeConversionExpr from "./TirTypeConversionExpr";
import * as TirVariableAccessExpr from "./TirVariableAccessExpr";
import * as TirUnaryExclamation from "./unary/TirUnaryExclamation";
import * as TirUnaryMinus from "./unary/TirUnaryMinus";
import * as TirUnaryPlus from "./unary/TirUnaryPlus";
import * as TirUnaryTilde from "./unary/TirUnaryTilde";

/** every module defining TIR expressions with a `toIR`; a test checks the list is complete */
export const tirExpressionModules: readonly Readonly<Record<string, unknown>>[] = [
    TirBinaryExpr,
    TirLitArrExpr,
    TirLitEnumMemberExpr,
    TirLitFailExpr,
    TirLitFalseExpr,
    TirLitHexBytesExpr,
    TirLitIntExpr,
    TirLitNamedObjExpr,
    TirLitObjExpr,
    TirLitStrExpr,
    TirLitThisExpr,
    TirLitTrueExpr,
    TirLitUndefExpr,
    TirLitVoidExpr,
    TirAssertAndContinueExpr,
    TirCallExpr,
    TirCaseExpr,
    TirElemAccessExpr,
    TirFailExpr,
    TirFromDataExpr,
    TirFuncExpr,
    TirHoistedExpr,
    TirInlineClosedIR,
    TirIsExpr,
    TirLettedExpr,
    TirNativeFunc,
    TirParentesizedExpr,
    TirPropAccessExpr,
    TirShowExpr,
    TirSopOptToBoolExpr,
    TirTernaryExpr,
    TirToDataExpr,
    TirTraceExpr,
    TirTraceIfFalseExpr,
    TirTypeConversionExpr,
    TirVariableAccessExpr,
    TirUnaryExclamation,
    TirUnaryMinus,
    TirUnaryPlus,
    TirUnaryTilde,
];

const STAMPS_RANGE = Symbol("stampsIRRange");

/**
 * Makes the `toIR` of every TIR expression class stamp its result with the expression's
 * source range (see `stampRange`). One wrapper per class instead of an edit at each of the
 * 200+ `toIR` call sites; idempotent.
 */
export function installIRRangeStamping(): void
{
    for( const mod of tirExpressionModules )
    {
        for( const exported of Object.values( mod ) )
        {
            if( typeof exported === "function" && typeof exported.prototype?.toIR === "function" )
            wrapToIR( exported.prototype );
        }
    }
}

/** whether `cls.prototype.toIR` stamps ranges */
export function stampsIRRange( cls: Function ): boolean
{
    return cls.prototype?.toIR?.[ STAMPS_RANGE ] === true;
}

function wrapToIR( proto: { toIR: ( ctx: ToIRTermCtx ) => IRTerm } ): void
{
    const toIR = proto.toIR;
    if( ( toIR as any )[ STAMPS_RANGE ] === true ) return;

    const stamped = function( this: { range?: SourceRange }, ctx: ToIRTermCtx ): IRTerm {
        const ir = toIR.call( this, ctx );
        stampRange( ir, this.range );
        return ir;
    };
    ( stamped as any )[ STAMPS_RANGE ] = true;
    proto.toIR = stamped;
}
