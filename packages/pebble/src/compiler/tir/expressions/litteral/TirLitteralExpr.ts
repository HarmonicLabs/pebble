import { TirLitArrExpr } from "./TirLitArrExpr";
import { TirLitEnumMemberExpr } from "./TirLitEnumMemberExpr";
import { TirLitFailExpr } from "./TirLitFailExpr";
import { TirLitFalseExpr } from "./TirLitFalseExpr";
import { TirLitHexBytesExpr } from "./TirLitHexBytesExpr";
import { TirLitIntExpr } from "./TirLitIntExpr";
import { TirLitNamedObjExpr } from "./TirLitNamedObjExpr";
import { TirLitObjExpr } from "./TirLitObjExpr";
import { TirLitStrExpr } from "./TirLitStrExpr";
import { TirLitThisExpr } from "./TirLitThisExpr";
import { TirLitTrueExpr } from "./TirLitTrueExpr";
import { TirLitUndefExpr } from "./TirLitUndefExpr";
import { TirLitVoidExpr } from "./TirLitVoidExpr";

export type TirLitteralExpr
    = TirLitVoidExpr
    | TirLitUndefExpr
    | TirLitTrueExpr
    | TirLitFalseExpr
    | TirLitStrExpr
    | TirLitIntExpr
    | TirLitHexBytesExpr
    | TirLitThisExpr
    | TirLitArrExpr
    | TirLitObjExpr
    | TirLitNamedObjExpr
    | TirLitEnumMemberExpr
    | TirLitFailExpr


export function isTirLitteralExpr( thing: any ): thing is TirLitteralExpr
{
    return (
        thing instanceof TirLitVoidExpr
        || thing instanceof TirLitUndefExpr
        || thing instanceof TirLitTrueExpr
        || thing instanceof TirLitFalseExpr
        || thing instanceof TirLitThisExpr
        || thing instanceof TirLitArrExpr
        || thing instanceof TirLitObjExpr
        || thing instanceof TirLitNamedObjExpr
        || thing instanceof TirLitEnumMemberExpr
        || thing instanceof TirLitStrExpr
        || thing instanceof TirLitIntExpr
        || thing instanceof TirLitHexBytesExpr
        || thing instanceof TirLitFailExpr
    );
}