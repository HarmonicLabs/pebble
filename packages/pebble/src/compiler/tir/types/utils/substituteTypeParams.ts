import { TirAliasType } from "../TirAliasType";
import { TirArrayT } from "../TirNativeType/native/array";
import { TirFuncT } from "../TirNativeType/native/function";
import { TirLinearMapT } from "../TirNativeType/native/linearMap";
import { TirLinearMapEntryT } from "../TirNativeType/native/linearMapEntry";
import { TirListT } from "../TirNativeType/native/list";
import { TirDataOptT } from "../TirNativeType/native/Optional/data";
import { TirSopOptT } from "../TirNativeType/native/Optional/sop";
import { TirTypeParam } from "../TirTypeParam";
import { TirType } from "../TirType";

/**
 * Walk a TirType tree and replace each `TirTypeParam` whose `symbol` is a key
 * in `subst` with the corresponding concrete type. Containers (`List`, `Func`,
 * `LinearMap`, optionals, aliases) are rebuilt with their substituted children.
 *
 * Returns the input unchanged when no substitution applies.
 */
export function substituteTypeParams(
    t: TirType,
    subst: Map<symbol, TirType>
): TirType
{
    if( subst.size === 0 ) return t;

    if( t instanceof TirTypeParam )
    {
        return subst.get( t.symbol ) ?? t;
    }
    if( t instanceof TirListT )
    {
        const sub = substituteTypeParams( t.typeArg, subst );
        return sub === t.typeArg ? t : new TirListT( sub );
    }
    if( t instanceof TirArrayT )
    {
        const sub = substituteTypeParams( t.typeArg, subst );
        return sub === t.typeArg ? t : new TirArrayT( sub );
    }
    if( t instanceof TirFuncT )
    {
        let changed = false;
        const newArgs = t.argTypes.map( a => {
            const s = substituteTypeParams( a, subst );
            if( s !== a ) changed = true;
            return s;
        });
        const newRet = substituteTypeParams( t.returnType, subst );
        if( newRet !== t.returnType ) changed = true;
        return changed ? new TirFuncT( newArgs, newRet ) : t;
    }
    if( t instanceof TirLinearMapT )
    {
        const k = substituteTypeParams( t.keyTypeArg, subst );
        const v = substituteTypeParams( t.valTypeArg, subst );
        return ( k === t.keyTypeArg && v === t.valTypeArg ) ? t : new TirLinearMapT( k, v );
    }
    if( t instanceof TirLinearMapEntryT )
    {
        const k = substituteTypeParams( t.keyTypeArg, subst );
        const v = substituteTypeParams( t.valTypeArg, subst );
        return ( k === t.keyTypeArg && v === t.valTypeArg ) ? t : new TirLinearMapEntryT( k, v );
    }
    if( t instanceof TirDataOptT )
    {
        const sub = substituteTypeParams( t.typeArg, subst );
        return sub === t.typeArg ? t : new TirDataOptT( sub );
    }
    if( t instanceof TirSopOptT )
    {
        const sub = substituteTypeParams( t.typeArg, subst );
        return sub === t.typeArg ? t : new TirSopOptT( sub );
    }
    if( t instanceof TirAliasType )
    {
        const sub = substituteTypeParams( t.aliased, subst );
        return sub === t.aliased ? t : sub;
    }
    return t;
}
