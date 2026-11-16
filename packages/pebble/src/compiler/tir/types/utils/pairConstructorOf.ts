import { data_t, int_t } from "../../program/stdScope/stdScope";
import { TirLinearMapEntryT } from "../TirNativeType/native/linearMapEntry";
import { TirListT } from "../TirNativeType/native/list";
import { TirUnConstrDataResultT } from "../TirNativeType";
import { TirStructConstr, TirStructField } from "../TirStructType";
import { TirType } from "../TirType";
import { getUnaliased } from "./getUnaliased";

/** the name `RawConstr{ index, fields }` destructures what `unConstrData` returns with */
export const RAW_CONSTR_NAME = "RawConstr";
/** the name a destructured `LinearMapEntry` has inside the compiler (the source has none) */
export const LINEAR_MAP_ENTRY_CONSTR_NAME = "Entry";

/**
 * `RawConstr` (what `unConstrData` returns) and `LinearMapEntry<K, V>` are builtin PAIRS at
 * runtime, not structs. Each has two named properties though, and is destructured by them,
 * as a struct with this one constructor would be:
 *
 * - `RawConstr{ index, fields }`: `index: int` is the pair's first, `fields: List<data>` its second
 * - `{ key, value }` of an entry: `key: K` the first, `value: V` the second (both data in the pair)
 *
 * `undefined` for any other type.
 */
export function pairConstructorOf( type: TirType ): TirStructConstr | undefined
{
    type = getUnaliased( type );
    if( type instanceof TirUnConstrDataResultT )
    return new TirStructConstr(
        RAW_CONSTR_NAME,
        [
            new TirStructField( "index", int_t ),
            new TirStructField( "fields", new TirListT( data_t ) ),
        ]
    );
    if( type instanceof TirLinearMapEntryT )
    return new TirStructConstr(
        LINEAR_MAP_ENTRY_CONSTR_NAME,
        [
            new TirStructField( "key", type.keyTypeArg ),
            new TirStructField( "value", type.valTypeArg ),
        ]
    );
    return undefined;
}
