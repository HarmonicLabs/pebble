import { LitArrExpr } from "./LitArrExpr";
import { LitContextExpr } from "./LitContextExpr";
import { LitFailExpr } from "./LitFailExpr";
import { LitFalseExpr } from "./LitFalseExpr";
import { LitHexBytesExpr } from "./LitHexBytesExpr";
import { LitIntExpr } from "./LitIntExpr";
import { LitNamedObjExpr } from "./LitNamedObjExpr";
import { LitObjExpr } from "./LitObjExpr";
import { LitStrExpr } from "./LitStrExpr";
import { LitThisExpr } from "./LitThisExpr";
import { LitTrueExpr } from "./LitTrueExpr";
import { LitUndefExpr } from "./LitUndefExpr";
import { LitVoidExpr } from "./LitVoidExpr";
import { TemplateStrExpr } from "./TemplateStrExpr";

export type LitteralExpr
    = LitVoidExpr
    | LitUndefExpr
    | LitTrueExpr
    | LitFalseExpr
    | LitThisExpr
    | LitContextExpr
    | LitArrExpr
    | LitObjExpr
    | LitNamedObjExpr
    | LitStrExpr
    | TemplateStrExpr
    | LitIntExpr
    | LitHexBytesExpr
    | LitFailExpr

export function isLitteralExpr( thing: any ): thing is LitteralExpr
{
    return (
        thing instanceof LitVoidExpr
        || thing instanceof LitUndefExpr
        || thing instanceof LitTrueExpr
        || thing instanceof LitFalseExpr
        || thing instanceof LitThisExpr
        || thing instanceof LitContextExpr
        || thing instanceof LitArrExpr
        || thing instanceof LitObjExpr
        || thing instanceof LitNamedObjExpr
        || thing instanceof LitStrExpr
        || thing instanceof TemplateStrExpr
        || thing instanceof LitIntExpr
        || thing instanceof LitHexBytesExpr
        || thing instanceof LitFailExpr
    );
}