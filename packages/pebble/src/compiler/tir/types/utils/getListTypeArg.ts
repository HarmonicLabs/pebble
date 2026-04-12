import { TirAliasType } from "../TirAliasType";
import { TirLinearMapT } from "../TirNativeType/native/linearMap";
import { TirLinearMapEntryT } from "../TirNativeType/native/linearMapEntry";
import { TirListT } from "../TirNativeType/native/list";
import { TirType } from "../TirType";

export function getListTypeArg( list_t: TirType ): TirType | undefined
{
    while( list_t instanceof TirAliasType ) list_t = list_t.aliased;
    if( list_t instanceof TirListT ) return list_t.typeArg;
    if( list_t instanceof TirLinearMapT ) return new TirLinearMapEntryT( list_t.keyTypeArg, list_t.valTypeArg );
    return undefined;
}

export function getLinearMapTypeArgs( map_t: TirType ): [key: TirType, value: TirType] | undefined
{
    while( map_t instanceof TirAliasType ) map_t = map_t.aliased;
    if( map_t instanceof TirLinearMapT ) return [ map_t.keyTypeArg, map_t.valTypeArg ];
    return undefined;
}