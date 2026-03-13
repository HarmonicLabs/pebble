import { Cloneable } from "@harmoniclabs/cbor/dist/utils/Cloneable";
import { Data, isData, dataToCbor } from "@harmoniclabs/plutus-data";
import { fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { BasePlutsError } from "../../utils/BasePlutsError";
import { ToJson } from "../../utils/ToJson";
import { IHash, IIRParent } from "../interfaces";
import { concatUint8Arr } from "../utils/concatUint8Arr";
import { positiveBigIntAsBytes } from "../utils/positiveIntAsBytes";
import { IRParentTerm, isIRParentTerm } from "../utils/isIRParentTerm";
import { _modifyChildFromTo } from "../toUPLC/_internal/_modifyChildFromTo";
import { BaseIRMetadata } from "./BaseIRMetadata";
import { IRNodeKind } from "../IRNodeKind";
import { TirType } from "../../compiler/tir/types/TirType";
import { getUnaliased } from "../../compiler/tir/types/utils/getUnaliased";
import { TirAliasType } from "../../compiler/tir/types/TirAliasType";
import { TirDataStructType, TirSoPStructType } from "../../compiler/tir/types/TirStructType";
import { getListTypeArg } from "../../compiler/tir/types/utils/getListTypeArg";
import { TirTypeParam } from "../../compiler/tir/types/TirTypeParam";
import { constT, ConstType, isPair, UPLCConst } from "@harmoniclabs/uplc";
import { TirPairDataT, TirUnConstrDataResultT } from "../../compiler/tir/types/TirNativeType";
import { TirBoolT } from "../../compiler/tir/types/TirNativeType/native/bool";
import { TirBytesT } from "../../compiler/tir/types/TirNativeType/native/bytes";
import { TirDataT } from "../../compiler/tir/types/TirNativeType/native/data";
import { TirFuncT } from "../../compiler/tir/types/TirNativeType/native/function";
import { TirIntT } from "../../compiler/tir/types/TirNativeType/native/int";
import { TirLinearMapT } from "../../compiler/tir/types/TirNativeType/native/linearMap";
import { TirListT } from "../../compiler/tir/types/TirNativeType/native/list";
import { TirDataOptT } from "../../compiler/tir/types/TirNativeType/native/Optional/data";
import { TirSopOptT } from "../../compiler/tir/types/TirNativeType/native/Optional/sop";
import { TirStringT } from "../../compiler/tir/types/TirNativeType/native/string";
import { TirVoidT } from "../../compiler/tir/types/TirNativeType/native/void";
import { IIRTerm, IRTerm } from "../IRTerm";
import { hashIrData, IRHash, isIRHash } from "../IRHash";
import { UPLCFlatUtils } from "../../utils/UPLCFlatUtils";

export interface IRConstPair {
    fst: IRConstValue;
    snd: IRConstValue;
}

export function isIRConstPair( value: any ): value is IRConstPair
{
    return (
        isPair( value ) &&
        isIRConstValue( value.fst ) &&
        isIRConstValue( value.snd )
    );
}

export type IRConstValue
    = bigint
    | Uint8Array
    | string
    | boolean
    | IRConstValue[]
    | IRConstPair
    | Data
    | undefined;

export interface IRConstMetadata extends BaseIRMetadata {}

export class IRConst
    implements IIRTerm, Cloneable<IRConst>, IIRParent, ToJson
{
    static get kind(): IRNodeKind.Const { return IRNodeKind.Const; }
    get kind(): IRNodeKind.Const { return IRConst.kind; }
    static get tag(): Uint8Array { return new Uint8Array([ IRConst.kind ]); }

    constructor(
        readonly type: TirType,
        readonly value: IRConstValue,
        _unsafeHash?: IRHash
    )
    {
        if(!(
            isValueAssignableToType( value, type )
        )) throw new BasePlutsError(
            "invalid IR constant value for type " + type.toString()
        );

        this._parent = undefined;
        this._hash = isIRHash( _unsafeHash ) ? _unsafeHash : undefined;
    }

    private _hash: IRHash | undefined = undefined;
    get hash(): IRHash
    {
        if( isIRHash( this._hash ) ) return this._hash;

        this._hash =  hashIrData(
            concatUint8Arr(
                IRConst.tag,
                new Uint8Array( this.type.toUplcConstType() ),
                serializeIRConstValue( this.value, this.type )
            )
        );

        return this._hash;
    }
    isHashPresent(): boolean { return true; }
    markHashAsInvalid(): void {
        this._hash = undefined;
        this.parent?.markHashAsInvalid();
    }


    children(): IRTerm[] {
        return [];
    }

    toUPLC(): UPLCConst
    {
        const type = getUnaliased( this.type );
        if( type instanceof TirBytesT && this.value instanceof Uint8Array ) {
            // make a copy to prevent external mutation
            return new UPLCConst(
                tirTypeToUplcType( type ),
                this.value
            );
        }
        return new UPLCConst(
            tirTypeToUplcType( type ),
            this.value as any
        );
    }

    private _meta: IRConstMetadata | undefined = undefined;
    get meta(): IRConstMetadata | undefined
    {
        if( !this._meta ) this._meta = {};
        return this._meta;
    }

    private _parent: IRParentTerm | undefined;
    get parent(): IRParentTerm | undefined { return this._parent; }
    set parent( newParent: IRParentTerm | undefined )
    {
        if(!( // assert
            // new parent value is different than current
            this._parent !== newParent && (
                // and the new parent value is valid
                newParent === undefined || 
                isIRParentTerm( newParent )
            )
        )) return;
        
        this._parent = newParent;
    }

    clone(): IRConst
    {
        return new IRConst(
            this.type,
            this.value,
            this._hash
        );
    }
    toJSON() { return this.toJson(); }
    toJson(): any
    {
        return {
            type: "IRConst",
            constType: this.type.toString(),
            value: constValueToJson( this.value )
        }
    }

    static get unit(): IRConst
    {
        return new IRConst( new TirVoidT(), undefined );
    }

    static bool( b: boolean ): IRConst
    {
        return new IRConst( new TirBoolT(), b );
    }

    static bytes( b:  | Uint8Array ): IRConst
    {
        return new IRConst( new TirBytesT(), b );
    }

    static int( n: number | bigint ): IRConst
    {
        return new IRConst( new TirIntT(), BigInt(n) );
    }

    static str( string: string ): IRConst
    {
        return new IRConst( new TirStringT(), string );
    }

    static data( d: Data ): IRConst
    {
        return new IRConst( new TirDataT(), d );
    }

    static listOf( t: TirType ): ( vals: IRConstValue[] ) => IRConst
    {
        return ( vals: IRConstValue[] ) => new IRConst( new TirListT( t ), vals );
    }
}

function isIRConstValueList( value: any ): value is IRConstValue[]
{
    if(!Array.isArray( value )) return false;
    if( value.length === 0 ) return true;

    return value.every( isIRConstValue )
}

function isValueAssignableToType( value: IRConstValue, type: TirType ): boolean
{
    type = getUnaliased( type );

    if(
        // so that typescirpt is happy
        type instanceof TirAliasType
        || type instanceof TirFuncT
        || type instanceof TirSopOptT
        || type instanceof TirSoPStructType
        || type instanceof TirTypeParam
    ) return false;

    if( type instanceof TirVoidT ) return value === undefined;
    if( type instanceof TirBoolT ) return typeof value === "boolean";
    if( type instanceof TirIntT ) return typeof value === "bigint";
    if( type instanceof TirBytesT ) return value instanceof Uint8Array;
    if( type instanceof TirStringT ) return typeof value === "string";
    if( type instanceof TirPairDataT ) return (
        isIRConstPair( value ) 
        && isValueAssignableToType( value.fst, new TirDataT() )
        && isValueAssignableToType( value.snd, new TirDataT() )
    );

    if( type instanceof TirLinearMapT ) {
        return (
            Array.isArray( value ) 
            && value.every(
                v => isValueAssignableToType( v, new TirPairDataT )
            )
        );
    }

    if( type instanceof TirUnConstrDataResultT ) return (
        isIRConstPair( value ) 
        && isValueAssignableToType( value.fst, new TirIntT() )
        && isValueAssignableToType( value.snd, new TirListT( new TirDataT() ) )
    );

    if(
        type instanceof TirDataT
        || type instanceof TirDataOptT
        || type instanceof TirDataStructType
    ) return isData( value );

    if( type instanceof TirListT )
    {
        const elemsT = getListTypeArg( type )!;
        return (
            Array.isArray( value ) &&
            value.every( v => isValueAssignableToType( v, elemsT ) )
        );
    }
    
    const tsEnsureExsaustiveCheck: never = type;
    return false;
}

export function isIRConstValue( value: any ): value is IRConstValue
{
    return (
        typeof value === "bigint"
        || value instanceof Uint8Array
        || typeof value === "string"
        || typeof value === "boolean"
        || isIRConstValueList( value )
        || isIRConstPair( value )
        || isData( value )
        || typeof value === "undefined"
    );
}

function serializeIRConstValue( value: any, type: TirType ): Uint8Array
{
    type = getUnaliased( type );

    if( type instanceof TirAliasType ) throw new Error("unreachable");

    if( type instanceof TirVoidT ) return new Uint8Array(0);
    if( type instanceof TirIntT )
    {
        return positiveBigIntAsBytes(
            UPLCFlatUtils.zigzagBigint(
                BigInt( value )
            )
        )
    }
    if( type instanceof TirStringT ) return fromUtf8( value );
    if( type instanceof TirBytesT )
    {
        if( value instanceof Uint8Array ) return value.slice();
        throw new Error("invalid value");
    }
    if( type instanceof TirBoolT ) return new Uint8Array([value ? 1 : 0]);
    if( type instanceof TirListT ) {
        const elemsT = getListTypeArg( type )!;
        return concatUint8Arr(
            ...(value as any[]).map( stuff =>
                serializeIRConstValue( stuff, elemsT )
            )
        );
    }
    if( type instanceof TirLinearMapT )
    {
        return concatUint8Arr(
            ...(value as any[]).map( stuff =>
                serializeIRConstValue( stuff, new TirPairDataT() )
            )
        );
    }
    if( type instanceof TirPairDataT )
    {
        return concatUint8Arr(
            serializeIRConstValue( value.fst, new TirDataT() ),
            serializeIRConstValue( value.snd, new TirDataT() ),
        );
    }
    if( type instanceof TirUnConstrDataResultT )
    {
        return concatUint8Arr(
            serializeIRConstValue( BigInt( value.fst ), new TirIntT() ),
            serializeIRConstValue( value.snd, new TirListT( new TirDataT() ) )
        );
    }
    if(
        type instanceof TirDataT
        || type instanceof TirDataOptT
        || type instanceof TirDataStructType
    ) return dataToCbor( value );

    if(
        type instanceof TirFuncT
        || type instanceof TirSopOptT
        || type instanceof TirSoPStructType
        || type instanceof TirTypeParam
    ) throw new Error("invalid uplc const type");

    const tsEnsureExsaustiveCheck: never = type;
    throw new Error("unreachable");
}

export function constValueToJson( value: IRConstValue ): any
{
    if( typeof value === "bigint" ) return value.toString();
    if( value instanceof Uint8Array ) return toHex( value );
    if( typeof value === "string" ) return value;
    if( typeof value === "boolean" ) return value;
    if( isIRConstValueList( value ) )
        return value.map( constValueToJson );
    if( isIRConstPair( value ) )
        return {
            fst: constValueToJson( value.fst ),
            snd: constValueToJson( value.snd )
        };
    if( isData( value ) ) return dataToCbor( value ).toString();
    if( typeof value === "undefined" ) return null;

    throw new Error("unreachable");
}

export function tirTypeToUplcType( t: TirType ): ConstType
{
    t = getUnaliased( t );

    if( t instanceof TirVoidT ) return constT.unit;
    if( t instanceof TirBoolT ) return constT.bool;
    if( t instanceof TirIntT ) return constT.int;
    if( t instanceof TirBytesT ) return constT.byteStr;
    if( t instanceof TirStringT ) return constT.str;

    if( t instanceof TirListT )
    {
        const elemsT = tirTypeToUplcType( getListTypeArg( t )! );
        return constT.listOf( elemsT );
    }

    if(
        t instanceof TirDataT
        || t instanceof TirDataOptT
        || t instanceof TirDataStructType
    ) return constT.data;

    if( t instanceof TirPairDataT ) return constT.pairOf( constT.data, constT.data );
    if( t instanceof TirLinearMapT ) return constT.listOf( constT.pairOf( constT.data, constT.data ) );
    if( t instanceof TirUnConstrDataResultT ) return constT.pairOf( constT.int, constT.listOf( constT.data ) );

    if(
        t instanceof TirAliasType
        || t instanceof TirFuncT
        || t instanceof TirSopOptT
        || t instanceof TirSoPStructType
        || t instanceof TirTypeParam
    ) throw new Error("invalid uplc const type");

    const tsEnsureExsaustiveCheck: never = t;
    throw new Error("tirTypeToUplcType: unreachable");
}