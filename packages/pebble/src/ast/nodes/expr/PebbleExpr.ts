import { CaseExpr } from "./CaseExpr";
import { ElemAccessExpr } from "./ElemAccessExpr";
import { CallExpr } from "./functions/CallExpr";
import { FuncExpr } from "./functions/FuncExpr";
import { IsExpr } from "./IsExpr";
import { isLitteralExpr, LitteralExpr } from "./litteral/LitteralExpr";
import { NonNullExpr } from "./unary/NonNullExpr";
import { ParentesizedExpr } from "./ParentesizedExpr";
import { isPropAccessExpr, PropAccessExpr } from "./PropAccessExpr";
import { TernaryExpr } from "./TernaryExpr";
import { TypeConversionExpr } from "./TypeConversionExpr";
import { isUnaryPrefixExpr, UnaryPrefixExpr } from "./unary/UnaryPrefixExpr";
import { Identifier } from "../common/Identifier";
import { BinaryExpr, isBinaryExpr } from "./binary/BinaryExpr";

/**
 * an expression is anything that can be evaluated to a value
 * it must therefore have a type
 */
export type PebbleExpr
    = UnaryPrefixExpr
    | NonNullExpr
    | LitteralExpr
    | ParentesizedExpr
    | FuncExpr
    | CallExpr
    | CaseExpr
    | TypeConversionExpr
    | NonNullExpr
    | IsExpr
    | ElemAccessExpr
    | TernaryExpr
    | Identifier // variable access
    | BinaryExpr
    | PropAccessExpr
    ;

export function isPebbleExpr( thing: any ): thing is PebbleExpr
{
    return (
        isUnaryPrefixExpr( thing )
        || thing instanceof NonNullExpr
        || isLitteralExpr( thing )
        || thing instanceof ParentesizedExpr
        || thing instanceof FuncExpr
        || thing instanceof CallExpr
        || thing instanceof CaseExpr
        || thing instanceof TypeConversionExpr
        || thing instanceof NonNullExpr
        || thing instanceof IsExpr
        || thing instanceof ElemAccessExpr
        || thing instanceof TernaryExpr
        // || thing instanceof CommaExpr
        || isPropAccessExpr( thing )
        || thing instanceof Identifier
        || isBinaryExpr( thing )
    );
}