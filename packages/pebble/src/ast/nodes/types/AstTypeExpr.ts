import { isObject } from "@harmoniclabs/obj-utils";
import { isAstNativeTypeExpr, AstNativeTypeExpr } from "./AstNativeTypeExpr";
import { AstNamedTypeExpr } from "./AstNamedTypeExpr";
import { AstRedeemerOfTypeExpr } from "./AstRedeemerOfTypeExpr";

export type AstTypeExpr
    = AstNativeTypeExpr
    | AstNamedTypeExpr
    | AstRedeemerOfTypeExpr
    ;

export function isAstTypeExpr( obj: any ): obj is AstTypeExpr
{
    return isObject( obj ) && (
        isAstNativeTypeExpr( obj ) ||
        (obj instanceof AstNamedTypeExpr) ||
        (obj instanceof AstRedeemerOfTypeExpr)
    );
}