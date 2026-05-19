import { TirAliasType } from "../TirAliasType";
import { TirEnumType } from "../TirEnumType";
import { TirDataT } from "../TirNativeType/native/data";
import { TirLinearMapT } from "../TirNativeType/native/linearMap";
import { TirListT } from "../TirNativeType/native/list";
import { TirDataOptT } from "../TirNativeType/native/Optional/data";
import { TirSopOptT } from "../TirNativeType/native/Optional/sop";
import { isTirStructType, TirStructType } from "../TirStructType";
import { TirType } from "../TirType";

export type DeconstructableTirType = TirStructType | TirEnumType | TirSopOptT | TirDataOptT | TirListT | TirLinearMapT | TirDataT;

export function getDeconstructableType(
    type: TirType
): DeconstructableTirType | undefined
{
    while( type instanceof TirAliasType ) type = type.aliased;
    if(
        isTirStructType( type )
        || type instanceof TirEnumType
        || type instanceof TirSopOptT
        || type instanceof TirDataOptT
        || type instanceof TirListT
        || type instanceof TirLinearMapT
        || type instanceof TirDataT // builtin choose data
    ) return type;
    return undefined;
}