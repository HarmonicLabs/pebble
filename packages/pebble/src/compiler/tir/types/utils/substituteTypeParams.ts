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
import { getAppliedStructTypeName, isTirStructType, TirDataStructType, TirSoPStructType, TirStructConstr, TirStructField, TirStructType } from "../TirStructType";

/**
 * Walk a TirType tree and replace each `TirTypeParam` whose `symbol` is a key
 * in `subst` with the corresponding concrete type. Containers (`List`, `Func`,
 * `LinearMap`, optionals, aliases) are rebuilt with their substituted children.
 *
 * Structs may be RECURSIVE, so the walk carries a `seen` map
 * (original -> substituted) and substitutes a struct by registering an
 * UNFILLED shell first and filling its constructors after — a back-edge to a
 * struct being substituted resolves to its shell, preserving the cycle in
 * the result instead of recursing forever.
 *
 * Returns the input unchanged when no substitution applies.
 */
export function substituteTypeParams(
    t: TirType,
    subst: Map<symbol, TirType>,
    seen?: Map<TirType, TirStructType>
): TirType
{
    if( subst.size === 0 ) return t;

    if( t instanceof TirTypeParam )
    {
        return subst.get( t.symbol ) ?? t;
    }
    if( t instanceof TirListT )
    {
        const sub = substituteTypeParams( t.typeArg, subst, seen );
        return sub === t.typeArg ? t : new TirListT( sub );
    }
    if( t instanceof TirArrayT )
    {
        const sub = substituteTypeParams( t.typeArg, subst, seen );
        return sub === t.typeArg ? t : new TirArrayT( sub );
    }
    if( t instanceof TirFuncT )
    {
        let changed = false;
        const newArgs = t.argTypes.map( a => {
            const s = substituteTypeParams( a, subst, seen );
            if( s !== a ) changed = true;
            return s;
        });
        const newRet = substituteTypeParams( t.returnType, subst, seen );
        if( newRet !== t.returnType ) changed = true;
        return changed ? new TirFuncT( newArgs, newRet ) : t;
    }
    if( t instanceof TirLinearMapT )
    {
        const k = substituteTypeParams( t.keyTypeArg, subst, seen );
        const v = substituteTypeParams( t.valTypeArg, subst, seen );
        return ( k === t.keyTypeArg && v === t.valTypeArg ) ? t : new TirLinearMapT( k, v );
    }
    if( t instanceof TirLinearMapEntryT )
    {
        const k = substituteTypeParams( t.keyTypeArg, subst, seen );
        const v = substituteTypeParams( t.valTypeArg, subst, seen );
        return ( k === t.keyTypeArg && v === t.valTypeArg ) ? t : new TirLinearMapEntryT( k, v );
    }
    if( t instanceof TirDataOptT )
    {
        const sub = substituteTypeParams( t.typeArg, subst, seen );
        return sub === t.typeArg ? t : new TirDataOptT( sub );
    }
    if( t instanceof TirSopOptT )
    {
        const sub = substituteTypeParams( t.typeArg, subst, seen );
        return sub === t.typeArg ? t : new TirSopOptT( sub );
    }
    if( t instanceof TirAliasType )
    {
        const sub = substituteTypeParams( t.aliased, subst, seen );
        return sub === t.aliased ? t : sub;
    }
    if( isTirStructType( t ) )
    {
        // a struct already being substituted higher up this walk: resolve
        // the back-edge to its (possibly still unfilled) shell.
        seen = seen ?? new Map();
        const cached = seen.get( t );
        if( cached ) return cached;

        // The `name` is the struct's IDENTITY (`canAssignStruct` compares by
        // name + fileUid), so a symbolic applied struct (`Box<T>`) must be
        // RENAMED (`Box<int>`) when its type arguments are substituted —
        // `appliedGeneric` records the base name and args to make it possible.
        // (A generic TEMPLATE carries `appliedGeneric` too, with its own
        // params as args, so applying a template IS a substitution.)
        let argsChanged = false;
        let newName = t.name;
        let newApplied = t.appliedGeneric;
        if( t.appliedGeneric )
        {
            const newArgs = t.appliedGeneric.args.map( a => {
                const s = substituteTypeParams( a, subst, seen );
                if( s !== a ) argsChanged = true;
                return s;
            });
            if( argsChanged )
            {
                newApplied = { baseName: t.appliedGeneric.baseName, args: newArgs };
                newName = getAppliedStructTypeName( t.appliedGeneric.baseName, newArgs );
            }
        }

        // shell FIRST, fields after: self-references land on the shell.
        // `methodNamesPtr` is intentionally SHARED (pointer semantics with
        // the alternative encoding), never cloned.
        const narrowed = t.narrowedFromParentCtorIdxs ? [ ...t.narrowedFromParentCtorIdxs ] : undefined;
        const shell = t instanceof TirDataStructType
            ? TirDataStructType.unfilled( newName, t.fileUid, t.methodNamesPtr, newApplied, narrowed )
            : TirSoPStructType.unfilled( newName, t.fileUid, t.methodNamesPtr, newApplied, narrowed );
        seen.set( t, shell );

        let fieldsChanged = false;
        const newCtors = t.constructors.map( c => {
            let ctorChanged = false;
            const newFields = c.fields.map( f => {
                const s = substituteTypeParams( f.type, subst, seen );
                if( s === f.type ) return f;
                ctorChanged = true;
                fieldsChanged = true;
                return new TirStructField( f.name, s );
            });
            return ctorChanged ? new TirStructConstr( c.name, newFields ) : c;
        });

        if( !argsChanged && !fieldsChanged )
        {
            // nothing substituted: discard the shell (no self-reference can
            // have captured it — a self-reference would have changed a field)
            seen.delete( t );
            return t;
        }

        if( shell instanceof TirDataStructType )
            shell.fillConstructors( newCtors, t instanceof TirDataStructType ? t.untagged : false );
        else
            shell.fillConstructors( newCtors );
        return shell;
    }
    return t;
}
