import { TirAliasType } from "../TirAliasType";
import { TirEnumType } from "../TirEnumType";
import { TirPairDataT, TirUnConstrDataResultT } from "../TirNativeType";
import { TirBoolT } from "../TirNativeType/native/bool";
import { TirBytesT } from "../TirNativeType/native/bytes";
import { TirDataT } from "../TirNativeType/native/data";
import { TirIntT } from "../TirNativeType/native/int";
import { TirLinearMapT } from "../TirNativeType/native/linearMap";
import { TirLinearMapEntryT } from "../TirNativeType/native/linearMapEntry";
import { TirListT } from "../TirNativeType/native/list";
import { TirDataOptT } from "../TirNativeType/native/Optional/data";
import { TirStringT } from "../TirNativeType/native/string";
import { TirValueT } from "../TirNativeType/native/value";
import { TirVoidT } from "../TirNativeType/native/void";
import { TirDataStructType } from "../TirStructType";
import { TirType } from "../TirType";
import { sopOptionalHoldsData } from "./canAssignTo";
import { getUnaliased } from "./getUnaliased";

/**
 * `true` if `==` and `!=` are defined for values of `type`: exactly the types
 * `IRNative.equals` has a term for. The front end asks this before it accepts
 * a comparison, so the back end is never handed one it cannot lower.
 *
 * Functions, BLS12-381 elements, arrays and runtime (SoP) structs have no
 * equality; an `Optional<T>` has one in either encoding, as long as `T` has a
 * data encoding (its `Some` holds that encoding).
 */
export function hasStdEquality( type: TirType ): boolean
{
    type = getUnaliased( type );
    if( type instanceof TirAliasType ) return false; // unreachable
    if(
        type instanceof TirIntT
        || type instanceof TirEnumType
        || type instanceof TirBytesT
        || type instanceof TirStringT
        || type instanceof TirBoolT
        || type instanceof TirPairDataT
        || type instanceof TirDataT
        || type instanceof TirDataOptT
        || type instanceof TirDataStructType
        || type instanceof TirLinearMapT
        || type instanceof TirLinearMapEntryT
        || type instanceof TirUnConstrDataResultT
        || type instanceof TirVoidT
        || type instanceof TirValueT
    ) return true;
    if( type instanceof TirListT ) return hasStdEquality( type.typeArg );
    // a SoP optional, also seen through a narrowing (`o is Some`)
    if( sopOptionalHoldsData( type ) ) return true;
    return false;
}
