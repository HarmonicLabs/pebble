import { isObject } from "@harmoniclabs/obj-utils";
import { ConstType, constT } from "@harmoniclabs/uplc";
import { AstFuncName, TirFuncName } from "../../AstCompiler/scope/AstScope";
import { TirAliasType } from "./TirAliasType";
import { ITirType, TirType } from "./TirType";

export class TirEnumType
    implements ITirType
{
    constructor(
        readonly name: string,
        readonly fileUid: string,
        readonly members: readonly string[],
        readonly methodNamesPtr: Map<AstFuncName, TirFuncName>,
    ) {}

    indexOf( member: string ): number
    {
        return this.members.indexOf( member );
    }

    isConcrete(): boolean { return true; }
    hasDataEncoding(): boolean { return true; }

    toString(): string { return this.name; }
    toAstName(): string { return this.name; }
    toTirTypeKey(): string { return "enum_" + this.name + "_" + this.fileUid; }
    toConcreteTirTypeName(): string { return this.toTirTypeKey(); }

    toUplcConstType(): ConstType { return constT.int; }

    clone(): TirEnumType
    {
        return new TirEnumType(
            this.name,
            this.fileUid,
            this.members.slice(),
            this.methodNamesPtr
        );
    }
}

export function isTirEnumType( thing: any ): thing is TirEnumType
{
    return isObject( thing ) && thing instanceof TirEnumType;
}

export function getEnumType( type: TirType | undefined ): TirEnumType | undefined
{
    while( type instanceof TirAliasType ) type = type.aliased;
    return type instanceof TirEnumType ? type : undefined;
}
