import { TirAliasType } from "../TirAliasType";
import { TirBlsG1T, TirBlsG2T, TirMlResultT, TirUnConstrDataResultT, TirPairDataT } from "../TirNativeType";
import { TirBoolT } from "../TirNativeType/native/bool";
import { TirBytesT } from "../TirNativeType/native/bytes";
import { TirDataT } from "../TirNativeType/native/data";
import { TirFuncT } from "../TirNativeType/native/function";
import { TirIntT } from "../TirNativeType/native/int";
import { TirArrayT } from "../TirNativeType/native/array";
import { TirValueT } from "../TirNativeType/native/value";
import { TirLinearMapT } from "../TirNativeType/native/linearMap";
import { TirLinearMapEntryT } from "../TirNativeType/native/linearMapEntry";
import { TirListT } from "../TirNativeType/native/list";
import { TirDataOptT } from "../TirNativeType/native/Optional/data";
import { TirSopOptT } from "../TirNativeType/native/Optional/sop";
import { TirStringT } from "../TirNativeType/native/string";
import { TirVoidT } from "../TirNativeType/native/void";
import { isTirStructType, TirDataStructType, TirSoPStructType, TirStructConstr, TirStructType } from "../TirStructType";
import { TirEnumType } from "../TirEnumType";
import { isTirNamedDestructableType, TirNamedDestructableType, TirType } from "../TirType";
import { TirTypeParam } from "../TirTypeParam";
import { canCastToData } from "./canCastTo";
import { getUnaliased } from "./getUnaliased";

export enum CanAssign { 
    LeftArgIsNotConcrete = -1,
    No = 0,
    Yes = 1,
    // yes, but...
    LiftToOptional,
    RequiresExplicitCast,
    // OnlyAsData,
    // runtimeModifier,
}
Object.freeze( CanAssign );

export function isStructOrStructAlias( type: TirType ): boolean
{
    while( type instanceof TirAliasType ) type = type.aliased;
    return isTirStructType( type );
}

export function getStructType( type: TirType | undefined ): TirStructType | undefined
{
    while( type instanceof TirAliasType ) type = type.aliased;
    return isTirStructType( type ) ? type : undefined;
}

export function getNamedDestructableType( type: TirType | undefined ): TirNamedDestructableType | undefined
{
    while( type instanceof TirAliasType ) type = type.aliased;
    if( !isTirNamedDestructableType( type ) ) return undefined;
    return type;
}

export function canAssignToOptional( type: TirType ): type is TirDataOptT | TirSopOptT | TirAliasType<TirDataOptT | TirSopOptT>
{
    type = getUnaliased( type );

    return (
        type instanceof TirDataOptT
        || type instanceof TirSopOptT
    );
}

export function canAssignToList( type: TirType ): boolean
{
    type = getUnaliased( type );

    return (
        type instanceof TirListT
        // || type instanceof TirLinearMapT
    );
}

/**
 * An `Optional` seen through a narrowing (`o is Some`, the arm of a `case` or
 * a `match`) is a plain struct type holding some of the optional's
 * constructors (`narrowTo`). It is still that optional at run time, in the
 * encoding it had.
 *
 * @returns for such a view: which encoding it is, and the payload type its
 * `Some` holds (`undefined` when the view has no `Some`: a `None` is a `None`
 * of any payload). `undefined` for every other type, the two optional types
 * themselves included.
 */
export function narrowedOptionalView( type: TirType ): { sop: boolean, payload: TirType | undefined } | undefined
{
    type = getUnaliased( type );
    if( type instanceof TirSopOptT || type instanceof TirDataOptT ) return undefined;
    if(!( type instanceof TirSoPStructType || type instanceof TirDataStructType )) return undefined;
    // the name is reserved and only the standard `Optional` has no file
    if( type.name !== "Optional" || type.fileUid !== "" || !type.isNarrowed() ) return undefined;
    const some = type.constructors.find( c => c.name === "Some" );
    return {
        sop: type instanceof TirSoPStructType,
        payload: some?.fields[0]?.type
    };
}

/** an `Optional` in either encoding, or a narrowed view of one */
function optionalShape( type: TirType ): { sop: boolean, payload: TirType | undefined } | undefined
{
    type = getUnaliased( type );
    if( type instanceof TirSopOptT ) return { sop: true, payload: type.typeArg };
    if( type instanceof TirDataOptT ) return { sop: false, payload: type.typeArg };
    return narrowedOptionalView( type );
}

/** `true` for the SoP encoding of an `Optional`, narrowed or not */
export function isSopOptionalLike( type: TirType ): boolean
{
    return optionalShape( type )?.sop === true;
}

/**
 * `true` if `a` and `b` are one `Optional` in its two encodings, whichever of
 * them is narrowed: the operands of an `==` that need one of them converted.
 */
export function areOptionalsOfTwoEncodings( a: TirType, b: TirType ): boolean
{
    const sa = optionalShape( a );
    const sb = optionalShape( b );
    if( !sa || !sb || sa.sop === sb.sop ) return false;
    if( !sa.payload || !sb.payload ) return true;
    return canAssignTo( sa.payload, sb.payload ) || canAssignTo( sb.payload, sa.payload );
}

/**
 * The two `Optional` representations (data-encoded `TirDataOptT` and
 * SoP-encoded `TirSopOptT`) are **incompatible at runtime** and therefore not
 * directly assignable. They can however be bridged by a real encoding
 * conversion (`TirTypeConversionExpr`, lowered via `_inlineFromData` /
 * `_inlineToData`).
 *
 * @returns `true` if `from` and `to` are Optionals of *different* encodings
 *          whose type arguments are assignable — i.e. assigning `from` to `to`
 *          only requires inserting such an encoding conversion.
 */
export function isOptionalEncodingBridge( from: TirType, to: TirType ): boolean
{
    from = getUnaliased( from );
    to   = getUnaliased( to );

    const toIsData   = to instanceof TirDataOptT;
    const toIsSop    = to instanceof TirSopOptT;

    // a narrowed view of an optional (`o is Some`) converts like the optional it is
    const view = narrowedOptionalView( from );
    if( view )
    {
        if( !(toIsData || toIsSop) || view.sop === toIsSop ) return false;
        return view.payload === undefined
            || canAssignTo( view.payload, (to as TirDataOptT | TirSopOptT).typeArg );
    }

    const fromIsData = from instanceof TirDataOptT;
    const fromIsSop  = from instanceof TirSopOptT;

    if( !(fromIsData || fromIsSop) || !(toIsData || toIsSop) ) return false;
    // only bridge *across* encodings; same-encoding cases are handled by the
    // normal assignability rules
    if( fromIsData === toIsData ) return false;

    return canAssignTo( (from as TirDataOptT | TirSopOptT).typeArg, (to as TirDataOptT | TirSopOptT).typeArg );
}

/**
 * @returns `true` if `a` can be assigned to `b` **without** explicit cast
 * 
 * use `getCanAssign` for more detailed information
 */
export function canAssignTo( a: TirType, b: TirType ): boolean
{
    return getCanAssign( a, b ) === CanAssign.Yes;
}

/**
 * A common type that every one of `types` is assignable to, or `undefined`
 * when the types are mutually incompatible. There is no real subtyping
 * lattice, so this is the pragmatic join used to reconcile the arms of a
 * `case`/`match` expression (audit BUGs 29/34): fold left, widening the
 * accumulator to whichever side the other assigns to; incompatible pair →
 * `undefined`.
 *
 * The two encodings of one `Optional` join to the first of them: the arms of
 * the other encoding are then converted to it (`fitToType`).
 */
export function joinTypes( types: TirType[] ): TirType | undefined
{
    if( types.length === 0 ) return undefined;
    let acc: TirType = types[0];
    for( let i = 1; i < types.length; i++ )
    {
        const t = types[i];
        if( canAssignTo( t, acc ) ) continue;      // t fits acc
        if( canAssignTo( acc, t ) ) { acc = t; continue; } // acc fits t -> widen
        if( isOptionalEncodingBridge( t, acc ) ) continue; // t converts to acc
        if( isOptionalEncodingBridge( acc, t ) ) { acc = t; continue; } // acc converts to t
        // two views of one struct, each narrowed to other constructors
        // (`case v is A{} => v is B{} => v`): the view that holds both
        const union = unionOfViews( acc, t );
        if( union ) { acc = union; continue; }
        return undefined;                          // incompatible
    }
    return acc;
}

function unionOfViews( a: TirType, b: TirType ): TirType | undefined
{
    a = getUnaliased( a );
    b = getUnaliased( b );
    const bothData = a instanceof TirDataStructType && b instanceof TirDataStructType;
    const bothSop = a instanceof TirSoPStructType && b instanceof TirSoPStructType;
    if( !bothData && !bothSop ) return undefined;
    const x = a as TirDataStructType | TirSoPStructType;
    const y = b as TirDataStructType | TirSoPStructType;
    // one struct (the test `canAssignStruct` makes), seen through two narrowings
    if( x.name !== y.name || x.fileUid !== y.fileUid ) return undefined;
    if( !x.isNarrowed() || !y.isNarrowed() ) return undefined;
    return ( x as any ).unionWith( y );
}

/**
 * `true` for the SoP representation of an `Optional<T>` whose `T` has a data encoding:
 * the `Some` payload is that encoding already (the SoP optional convention), so the
 * optional converts to data by tagging it, and two of them compare by their payloads.
 */
export function sopOptionalHoldsData( type: TirType ): boolean
{
    type = getUnaliased( type );
    if( type instanceof TirSopOptT ) return payloadIsData( type.typeArg );
    // a narrowed view of a SoP optional (`o is Some`) is one all the same
    const view = narrowedOptionalView( type );
    if( !view || !view.sop ) return false;
    // only `None`: nothing to encode
    return view.payload === undefined || payloadIsData( view.payload );
}
function payloadIsData( payload: TirType ): boolean
{
    payload = getUnaliased( payload );
    return optionalShape( payload )?.sop ? sopOptionalHoldsData( payload ) : payload.hasDataEncoding();
}

export function getCanAssign( a: TirType, b: TirType ): CanAssign
{
    // remove for tests
    if( a === b ) return CanAssign.Yes; // same object, we don't care if not concrete
    if( !a.isConcrete() ) return CanAssign.LeftArgIsNotConcrete;
    return uncheckedGetCanAssign( a, b, new Map() );
}

function uncheckedGetCanAssign(
    a: TirType,
    b: TirType,
    symbols: Map<symbol, TirType>
): CanAssign
{
    // remove for tests
    if( a === b ) return CanAssign.Yes; // same object (here for recursive calls)

    // unwrap all aliases
    // aliases are only for custom interface implementations
    // but the data is the same
    while( a instanceof TirAliasType ) a = a.aliased;
    while( b instanceof TirAliasType ) b = b.aliased;

    if( b instanceof TirTypeParam )
    {
        if( symbols.has( b.symbol ) )
        {
            return uncheckedGetCanAssign( a, symbols.get( b.symbol )!, symbols );
        }
        symbols.set( b.symbol, a );
        return CanAssign.Yes;
    }
    if( b instanceof TirVoidT ) {
        if( a instanceof TirVoidT ) return CanAssign.Yes;
        if( a instanceof TirDataT ) return CanAssign.RequiresExplicitCast;
        return CanAssign.No;
    }
    if( b instanceof TirBoolT ) {
        if( a instanceof TirBoolT ) return CanAssign.Yes;
        if( a instanceof TirDataT ) return CanAssign.RequiresExplicitCast;
        return CanAssign.No;
    }
    if( b instanceof TirIntT  ) {
        if( a instanceof TirIntT  ) return CanAssign.Yes;
        // enum runtime representation is a plain int, so an enum value can
        // flow directly into any int operation.
        if( a instanceof TirEnumType ) return CanAssign.Yes;
        if( a instanceof TirDataT ) return CanAssign.RequiresExplicitCast;
        return CanAssign.No;
    }
    if( b instanceof TirBytesT )
    {
        if( a instanceof TirBytesT ) return CanAssign.Yes;
        if( a instanceof TirStringT ) return CanAssign.RequiresExplicitCast;
        if( a instanceof TirDataT ) return CanAssign.RequiresExplicitCast;
        return CanAssign.No;
    }
    if( b instanceof TirStringT )
    {
        if( a instanceof TirStringT ) return CanAssign.Yes;
        if( a instanceof TirBytesT ) return CanAssign.RequiresExplicitCast;
        if( a instanceof TirDataT ) return CanAssign.RequiresExplicitCast;
        return CanAssign.No;
    }
    if( b instanceof TirUnConstrDataResultT )
    {
        return a instanceof TirUnConstrDataResultT ? CanAssign.Yes : CanAssign.No;
    }
    if( b instanceof TirPairDataT )
    {
        return a instanceof TirPairDataT ? CanAssign.Yes : CanAssign.No;
    }

    if( b instanceof TirSopOptT || b instanceof TirDataOptT )
    {
        // a narrowed view of an optional (`o is Some`) is that optional: as it is
        // in its own encoding, with the conversion in the other
        const view = narrowedOptionalView( a );
        if( view )
        {
            if(
                view.payload !== undefined
                && uncheckedGetCanAssign( view.payload, b.typeArg, symbols ) !== CanAssign.Yes
            ) return CanAssign.No;
            return view.sop === ( b instanceof TirSopOptT ) ? CanAssign.Yes : CanAssign.RequiresExplicitCast;
        }
    }
    if( b instanceof TirSopOptT )
    {
        if( a instanceof TirSopOptT ) return uncheckedGetCanAssign( a.typeArg, b.typeArg, symbols );
        if( a instanceof TirDataOptT ) return canAssignTo( a.typeArg, b.typeArg ) ? CanAssign.RequiresExplicitCast : CanAssign.No;
        if( a instanceof TirDataT ) return CanAssign.RequiresExplicitCast;

        const canAssingToDefined = uncheckedGetCanAssign( a, b.typeArg, symbols );
        switch( canAssingToDefined )
        {
            case CanAssign.Yes: // value => Some{ value }
                return CanAssign.LiftToOptional;
            case CanAssign.RequiresExplicitCast:
                // TODO: do we want to allow this?
                // return CanAssign.RequiresExplicitCast;
            case CanAssign.No:
            case CanAssign.LeftArgIsNotConcrete:
            case CanAssign.LiftToOptional: // value is not assignable with single lift
                default:
                return CanAssign.No;
        }

        return CanAssign.No; 
    }
    if( b instanceof TirDataOptT )
    {
        // the mirror image of the SoP case above: the same encoding is assignable as its
        // payload is, the other encoding is not the same value at run time and needs the
        // conversion (`isOptionalEncodingBridge`, `fitToType`). These two lines used to be
        // a copy of the two above, which made a SoP optional pass for a data one unconverted.
        if( a instanceof TirDataOptT ) return uncheckedGetCanAssign( a.typeArg, b.typeArg, symbols );
        if( a instanceof TirSopOptT ) return canAssignTo( a.typeArg, b.typeArg ) ? CanAssign.RequiresExplicitCast : CanAssign.No;
        if( a instanceof TirDataT ) return CanAssign.RequiresExplicitCast;

        return CanAssign.No;
    }

    if( b instanceof TirListT )
    {
        if( a instanceof TirListT ) return uncheckedGetCanAssign( a.typeArg, b.typeArg, symbols );
        if( a instanceof TirDataT ) return CanAssign.RequiresExplicitCast;
        return CanAssign.No;
    }
    if( b instanceof TirLinearMapT )
    {
        if( a instanceof TirLinearMapT )
        {
            return decideCanAssignField(
                uncheckedGetCanAssign( a.keyTypeArg, b.keyTypeArg, symbols ),
                uncheckedGetCanAssign( a.valTypeArg, b.valTypeArg, symbols )
            );
        }
        if( a instanceof TirDataT ) return CanAssign.RequiresExplicitCast;
        return CanAssign.No;
    }
    if( b instanceof TirLinearMapEntryT )
    {
        if( a instanceof TirLinearMapEntryT )
        {
            return decideCanAssignField(
                uncheckedGetCanAssign( a.keyTypeArg, b.keyTypeArg, symbols ),
                uncheckedGetCanAssign( a.valTypeArg, b.valTypeArg, symbols )
            );
        }
        return CanAssign.No;
    }

    if( b instanceof TirDataT )
    {
        if( a instanceof TirDataT ) return CanAssign.Yes;
        if( a instanceof TirDataStructType ) return CanAssign.RequiresExplicitCast;
        if( a instanceof TirSoPStructType ) return CanAssign.No;

        // int, bytes, string, bool, even void
        // optionals (part of the standard ledger API) as long as the type argument can too
        // structs that allow data encoding
        // lists and maps of any of the above
        // can all cast to data
        return canCastToData( a ) ? CanAssign.RequiresExplicitCast : CanAssign.No;
    }
    if( b instanceof TirDataStructType )
    {
        if( a instanceof TirDataStructType ) return canAssignStruct( a, b, symbols );
        if( a instanceof TirSoPStructType ) return CanAssign.No;
        if( a instanceof TirDataT ) return CanAssign.RequiresExplicitCast;
        return CanAssign.No;
    }
    if( b instanceof TirSoPStructType )
    {
        if( a instanceof TirSoPStructType ) return canAssignStruct( a, b, symbols );
        return CanAssign.No;
    }
    if( isTirStructType( a ) ) return CanAssign.No;

    if( b instanceof TirEnumType )
    {
        if(
            a instanceof TirEnumType
            && a.toTirTypeKey() === b.toTirTypeKey()
        ) return CanAssign.Yes;
        // `data` (e.g. datum/redeemer) can be decoded to an enum with an
        // explicit cast; plain `int` cannot — there is no way to statically
        // verify it is a valid tag.
        if( a instanceof TirDataT ) return CanAssign.RequiresExplicitCast;
        return CanAssign.No;
    }
    if( a instanceof TirEnumType ) return CanAssign.No;

    if( b instanceof TirFuncT )
    {
        if(!(
            a instanceof TirFuncT
            && a.argTypes.length === b.argTypes.length
        )) return CanAssign.No;
        let currentDecision = uncheckedGetCanAssign( a.returnType, b.returnType, symbols );
        for( let i = 0; i < a.argTypes.length; i++ )
        {
            currentDecision = decideCanAssignField(
                currentDecision,
                // TODO make one only for functions
                uncheckedGetCanAssign( a.argTypes[i], b.argTypes[i], symbols )
            );
            if( currentDecision <= CanAssign.No ) return currentDecision;
        }
        return currentDecision;
    }

    // BLS / ML-result are opaque atomic types: assignable only to themselves
    if( b instanceof TirBlsG1T ) return a instanceof TirBlsG1T ? CanAssign.Yes : CanAssign.No;
    if( b instanceof TirBlsG2T ) return a instanceof TirBlsG2T ? CanAssign.Yes : CanAssign.No;
    if( b instanceof TirMlResultT ) return a instanceof TirMlResultT ? CanAssign.Yes : CanAssign.No;
    // Native Value / Array<T>
    if( b instanceof TirValueT ) return a instanceof TirValueT ? CanAssign.Yes : CanAssign.No;
    if( b instanceof TirArrayT ) {
        if( !( a instanceof TirArrayT ) ) return CanAssign.No;
        return uncheckedGetCanAssign( (a as TirArrayT).typeArg, (b as TirArrayT).typeArg, symbols );
    }

    const tsEnsureExhautstiveCheck: never = b;
    return CanAssign.No;
}

function canAssignStruct(
    a: TirStructType | TirAliasType<TirStructType>,
    b: TirStructType | TirAliasType<TirStructType>,
    symbols: Map<symbol, TirType>
): CanAssign
{
    while( a instanceof TirAliasType ) a = a.aliased;
    while( b instanceof TirAliasType ) b = b.aliased;

    // Same logical struct type? (same name + fileUid). When this holds,
    // we use parent-ctor-idx based subset checks to handle narrowing.
    const sameLogicalType =
        a.name === b.name
        && (a as any).fileUid === (b as any).fileUid;

    if( sameLogicalType )
    {
        const aIdxs = a.narrowedFromParentCtorIdxs ?? a.constructors.map( ( _, i ) => i );
        const bIdxs = b.narrowedFromParentCtorIdxs ?? b.constructors.map( ( _, i ) => i );

        // a is assignable to b iff a's parent-ctor set is a SUBSET of b's
        for( const idx of aIdxs )
        {
            if( !bIdxs.includes( idx ) ) return CanAssign.No;
        }
        return CanAssign.Yes;
    }

    // data structs of the same SHAPE but different ENCODING
    // (`listData( fields )` vs `constrData( 0, fields )`) are different
    // values on chain: a cast between them is the identity at runtime, so
    // allowing it would only move the failure to the first field access.
    if(
        a instanceof TirDataStructType
        && b instanceof TirDataStructType
        && a.untagged !== b.untagged
    ) return CanAssign.No;

    const aCtors = a.constructors;
    const bCtors = b.constructors;

    if( aCtors.length !== bCtors.length ) return CanAssign.No;

    const len = aCtors.length;

    // check for the same number of fields
    // so we avoid useless checks on types that don't exsist
    for( let i = 0; i < len; i++ )
    {
        const aCtor = aCtors[i];
        const bCtor = bCtors[i];
        if(
            aCtor.fields.length !== bCtor.fields.length
        ) return CanAssign.No;
    }

    for( let i = 0; i < len; i++ )
    {
        if(
            // check for the same fields and the extending types to extend the given struct ones
            !canAssignCtorDef(
                aCtors[i],
                bCtors[i],
                symbols
            )
        ) return CanAssign.No;
    }

    // check if cast is needed even if shape is the same
    for( let i = 0; i < len; i++ )
    {
        const aCtor = aCtors[i];
        const bCtor = bCtors[i];
        if(
            aCtor.fields.length !== bCtor.fields.length
        ) return CanAssign.RequiresExplicitCast;
    }

    if( a.name !== b.name ) return CanAssign.RequiresExplicitCast;

    return CanAssign.Yes;
}

/**
 * 
 * @param a extending ctor
 * @param b extended ctor
 * @returns 
 */
function canAssignCtorDef(
    a: TirStructConstr,
    b: TirStructConstr,
    symbols: Map<symbol, TirType>
): CanAssign
{
    if( a.fields.length !== b.fields.length ) return CanAssign.No;

    const len = a.fields.length;
    let currentDecision = CanAssign.Yes;
    let prevDecision: CanAssign = currentDecision;
    for( let i = 0; i < len; i++ )
    {
        prevDecision = currentDecision;
        currentDecision = decideCanAssignField(
            currentDecision,
            uncheckedGetCanAssign(
                a.fields[i].type,
                b.fields[i].type,
                symbols
            )
        );
        if( currentDecision <= CanAssign.No ) return currentDecision;
        if(
            a.fields[i].name !== b.fields[i].name

        ) currentDecision = decideCanAssignField(
            currentDecision,
            CanAssign.RequiresExplicitCast
        );
    }

    return currentDecision;
}

function decideCanAssignField( currentDecision: CanAssign, fieldDecision: CanAssign ): CanAssign
{
    if(
        currentDecision === CanAssign.No
        || currentDecision === CanAssign.LeftArgIsNotConcrete
    ) return currentDecision;
    switch( fieldDecision )
    {
        // lift to optional only valid for direct types
        case CanAssign.LiftToOptional: return CanAssign.No;
        // no decisions always win
        case CanAssign.No: return CanAssign.No;
        case CanAssign.LeftArgIsNotConcrete: return CanAssign.LeftArgIsNotConcrete;
        // yes decisions by most descriptive (sop and data conflict become nos)
        case CanAssign.Yes: return currentDecision;
        case CanAssign.RequiresExplicitCast: {
            switch( currentDecision )
            {
                case CanAssign.Yes: return CanAssign.RequiresExplicitCast;
                case CanAssign.RequiresExplicitCast: return CanAssign.RequiresExplicitCast;
                // case CanAssign.OnlyAsData: return CanAssign.OnlyAsData;
                // case CanAssign.runtimeModifier: return CanAssign.runtimeModifier;
                default: return CanAssign.No;
            }
            break;
        }
        // case CanAssign.OnlyAsData: {
        //     switch( currentDecision )
        //     {
        //         case CanAssign.Yes: return CanAssign.OnlyAsData;
        //         case CanAssign.RequiresExplicitCast: return CanAssign.OnlyAsData;
        //         case CanAssign.OnlyAsData: return CanAssign.OnlyAsData;
        //         case CanAssign.runtimeModifier: return CanAssign.No; // conflict
        //         default: return CanAssign.No;
        //     }
        //     break;
        // }
        // case CanAssign.runtimeModifier: {
        //     switch( currentDecision )
        //     {
        //         case CanAssign.Yes: return CanAssign.runtimeModifier;
        //         case CanAssign.RequiresExplicitCast: return CanAssign.runtimeModifier;
        //         // case CanAssign.OnlyAsData: return CanAssign.No; // conflict
        //         case CanAssign.runtimeModifier: return CanAssign.runtimeModifier;
        //         default: return CanAssign.No;
        //     }
        //     break;
        // }
        default:
            // never
            // fieldDecision; 
            return CanAssign.No;
    }
}