import { isObject } from "@harmoniclabs/obj-utils";
import { TirAliasType } from "./TirAliasType";
import { isTirStructType, TirStructType } from "./TirStructType";
import { isTirNamedDestructableNativeType, isTirNativeType, TirNamedDestructableNativeType, TirNativeType } from "./TirNativeType/TirNativeType";
import { TirTypeParam } from "./TirTypeParam";
import { ConstType } from "@harmoniclabs/uplc";

export interface ITirType {
    /** @returns the AST name (human friendly) */
    toString(): string;
    /**
     * @returns the TIR name
     * 
     * if the type is generic, it returns only the name of the generic type
     **/
    toTirTypeKey(): string;
    /**
     * @returns the (unapplied) AST name
     * 
     * if the type is generic, it return only the name of the generic type
     * and not the type parameters
     * 
     * if the type is concrete, it returns the same as `toString()`
     */
    toAstName(): string;
    /**
     * translate to uplc type
     */
    toUplcConstType(): ConstType
}

export type TirType
    = TirNativeType
    | TirCustomType
    | TirTypeParam
    ;

export function isTirType( thing: any ): thing is TirType
{
    return isObject( thing ) && (
        isTirNativeType( thing )
        || isTirCustomType( thing )
        || thing instanceof TirTypeParam
    );
}

export type TirCustomType
    = TirAliasType
    | TirStructType
    ;

export function isTirCustomType( thing: any ): thing is TirCustomType
{
    return isObject( thing ) && (
        thing instanceof TirAliasType
        || isTirStructType( thing )
    );
}

export type TirNamedDestructableType
    = TirNamedDestructableNativeType
    | TirStructType
    ;

export function isTirNamedDestructableType( thing: any ): thing is TirNamedDestructableType
{
    return isObject( thing ) && (
        isTirStructType( thing )
        || isTirNamedDestructableNativeType( thing )
    );
}