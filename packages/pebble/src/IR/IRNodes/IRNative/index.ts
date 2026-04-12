import { Cloneable } from "@harmoniclabs/cbor/dist/utils/Cloneable";
import { IHash } from "../../interfaces/IHash";
import { IIRParent } from "../../interfaces/IIRParent";
import { concatUint8Arr } from "../../utils/concatUint8Arr";
import { zigzagBigintAsBytes } from "../../utils/positiveIntAsBytes";
import { IRNativeTag, nativeTagToString } from "./IRNativeTag";
import { IRParentTerm, isIRParentTerm } from "../../utils/isIRParentTerm";
import { _modifyChildFromTo } from "../../toUPLC/_internal/_modifyChildFromTo";
import { BaseIRMetadata } from "../BaseIRMetadata";
import { ToJson } from "../../../utils/ToJson";
import { isObject } from "@harmoniclabs/obj-utils";
import { IRNodeKind } from "../../IRNodeKind";
import { TirType } from "../../../compiler/tir/types/TirType";
import { IIRTerm, IRTerm } from "../../IRTerm";
import { getUnaliased } from "../../../compiler/tir/types/utils/getUnaliased";
import { TirDataStructType, TirSoPStructType } from "../../../compiler/tir/types/TirStructType";
import { TirAliasType } from "../../../compiler/tir/types/TirAliasType";
import { getListTypeArg } from "../../../compiler/tir/types/utils/getListTypeArg";
import { TirTypeParam } from "../../../compiler/tir/types/TirTypeParam";
import { TirPairDataT, TirUnConstrDataResultT } from "../../../compiler/tir/types/TirNativeType";
import { TirBoolT } from "../../../compiler/tir/types/TirNativeType/native/bool";
import { TirBytesT } from "../../../compiler/tir/types/TirNativeType/native/bytes";
import { TirDataT } from "../../../compiler/tir/types/TirNativeType/native/data";
import { TirFuncT } from "../../../compiler/tir/types/TirNativeType/native/function";
import { TirIntT } from "../../../compiler/tir/types/TirNativeType/native/int";
import { TirLinearMapT } from "../../../compiler/tir/types/TirNativeType/native/linearMap";
import { TirLinearMapEntryT } from "../../../compiler/tir/types/TirNativeType/native/linearMapEntry";
import { TirListT } from "../../../compiler/tir/types/TirNativeType/native/list";
import { TirDataOptT } from "../../../compiler/tir/types/TirNativeType/native/Optional/data";
import { TirSopOptT } from "../../../compiler/tir/types/TirNativeType/native/Optional/sop";
import { TirStringT } from "../../../compiler/tir/types/TirNativeType/native/string";
import { TirVoidT } from "../../../compiler/tir/types/TirNativeType/native/void";
import { IRHash, isIRHash, hashIrData, irHashToBytes } from "../../IRHash";
import { Builtin, UPLCBuiltinTag, UPLCTerm } from "@harmoniclabs/uplc";
import { ToUplcCtx } from "../../toUPLC/ctx/ToUplcCtx";
import { _ir_apps } from "../IRApp";
import { IRHoisted } from "../IRHoisted";
import { IRFunc } from "../IRFunc";
import { IRVar } from "../IRVar";
import { IRConst } from "../IRConst";

/**
 * we might not need all the hashes
 * 
 * but one we get one for a specific tag is not worth it re calculate it
 */
const nativeHashesPreimageCache: { [n: number/*IRNativeTag*/]: Uint8Array } = {} as any;

export interface IRNativeMetadata extends BaseIRMetadata {}

/**
 * `IRNative` ⊇ (`Builtins` + `std::fn`)
**/
export class IRNative
    implements IIRTerm, Cloneable<IRNative>, IIRParent, ToJson
{
    readonly tag!: IRNativeTag;

    static get kind(): IRNodeKind.Native { return IRNodeKind.Native; }
    get kind(): IRNodeKind.Native { return IRNative.kind; }
    static get tag(): Uint8Array { return new Uint8Array([ IRNative.kind ]); }

    constructor( tag: IRNativeTag )
    {
        this.tag = tag;
                
        this._hash = undefined;
    }

    toUPLC(): UPLCTerm
    {
        if( this.tag < 0 )
        throw new Error("IRNative tag cannot be negative during uplc translation");

        return new Builtin( this.tag as any as UPLCBuiltinTag );
    }

    private _hash: IRHash | undefined;
    get hash(): IRHash
    {
        if( isIRHash( this._hash ) ) return this._hash;

        this._hash = hashIrData(
            concatUint8Arr(
                IRNative.tag,
                zigzagBigintAsBytes( BigInt( this.tag ) )
            )
        );

        return this._hash;
    }
    isHashPresent(): boolean { return isIRHash( this._hash ); }
    markHashAsInvalid(): void
    {
        this._hash = undefined;
        this.parent?.markHashAsInvalid();
    }

    children(): IRTerm[] {
        return [];
    }

    private _meta: IRNativeMetadata | undefined;
    get meta(): IRNativeMetadata
    {
        if( !isObject( this._meta ) ) this._meta = {};
        return this._meta!;
    }

    private _parent: IRParentTerm | undefined = undefined;
    get parent(): IRParentTerm | undefined
    {
        return this._parent;
    }
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

    clone(): IRNative
    {
        return new IRNative( this.tag );
    }
    toJSON() { return this.toJson(); }
    toJson()
    {
        return {
            type: "IRNative",
            native: nativeTagToString( this.tag )
        };
    }

    static get addInteger() { return new IRNative( IRNativeTag.addInteger ); }
    static get subtractInteger() { return new IRNative( IRNativeTag.subtractInteger ); }
    static get multiplyInteger() { return new IRNative( IRNativeTag.multiplyInteger ); }
    static get divideInteger() { return new IRNative( IRNativeTag.divideInteger ); }
    static get quotientInteger() { return new IRNative( IRNativeTag.quotientInteger ); }
    static get remainderInteger() { return new IRNative( IRNativeTag.remainderInteger ); }
    static get modInteger() { return new IRNative( IRNativeTag.modInteger ); }
    static get equalsInteger() { return new IRNative( IRNativeTag.equalsInteger ); }
    static get lessThanInteger() { return new IRNative( IRNativeTag.lessThanInteger ); }
    static get lessThanEqualInteger() { return new IRNative( IRNativeTag.lessThanEqualInteger ); }
    static get appendByteString() { return new IRNative( IRNativeTag.appendByteString ); }
    static get consByteString() { return new IRNative( IRNativeTag.consByteString ); }
    static get sliceByteString() { return new IRNative( IRNativeTag.sliceByteString ); }
    static get lengthOfByteString() { return new IRNative( IRNativeTag.lengthOfByteString ); }
    static get indexByteString() { return new IRNative( IRNativeTag.indexByteString ); }
    static get equalsByteString() { return new IRNative( IRNativeTag.equalsByteString ); }
    static get lessThanByteString() { return new IRNative( IRNativeTag.lessThanByteString ); }
    static get lessThanEqualsByteString() { return new IRNative( IRNativeTag.lessThanEqualsByteString ); }
    static get sha2_256() { return new IRNative( IRNativeTag.sha2_256 ); }
    static get sha3_256() { return new IRNative( IRNativeTag.sha3_256 ); }
    static get blake2b_256() { return new IRNative( IRNativeTag.blake2b_256 ); }
    static get verifyEd25519Signature() { return new IRNative( IRNativeTag.verifyEd25519Signature ); }
    static get appendString() { return new IRNative( IRNativeTag.appendString ); }
    static get equalsString() { return new IRNative( IRNativeTag.equalsString ); }
    static get encodeUtf8() { return new IRNative( IRNativeTag.encodeUtf8 ); }
    static get decodeUtf8() { return new IRNative( IRNativeTag.decodeUtf8 ); }
    static get strictIfThenElse() { return new IRNative( IRNativeTag.strictIfThenElse ); }
    static get chooseUnit() { return new IRNative( IRNativeTag.chooseUnit ); }
    static get trace() { return new IRNative( IRNativeTag.trace ); }
    static get fstPair() { return new IRNative( IRNativeTag.fstPair ); }
    static get sndPair() { return new IRNative( IRNativeTag.sndPair ); }
    static get strictChooseList() { return new IRNative( IRNativeTag.strictChooseList ); }
    static get mkCons() { return new IRNative( IRNativeTag.mkCons ); }
    static get headList() { return new IRNative( IRNativeTag.headList ); }
    static get tailList() { return new IRNative( IRNativeTag.tailList ); }
    static get nullList() { return new IRNative( IRNativeTag.nullList ); }
    static get chooseData() { return new IRNative( IRNativeTag.chooseData ); }
    static get constrData() { return new IRNative( IRNativeTag.constrData ); }
    static get mapData() { return new IRNative( IRNativeTag.mapData ); }
    static get listData() { return new IRNative( IRNativeTag.listData ); }
    static get iData() { return new IRNative( IRNativeTag.iData ); }
    static get bData() { return new IRNative( IRNativeTag.bData ); }
    static get unConstrData() { return new IRNative( IRNativeTag.unConstrData ); }
    static get unMapData() { return new IRNative( IRNativeTag.unMapData ); }
    static get unListData() { return new IRNative( IRNativeTag.unListData ); }
    static get unIData() { return new IRNative( IRNativeTag.unIData ); }
    static get unBData() { return new IRNative( IRNativeTag.unBData ); }
    static get equalsData() { return new IRNative( IRNativeTag.equalsData ); }
    static get mkPairData() { return new IRNative( IRNativeTag.mkPairData ); }
    static get mkNilData() { return new IRNative( IRNativeTag.mkNilData ); }
    static get mkNilPairData() { return new IRNative( IRNativeTag.mkNilPairData ); }
    static get serialiseData() { return new IRNative( IRNativeTag.serialiseData ); }
    static get verifyEcdsaSecp256k1Signature() { return new IRNative( IRNativeTag.verifyEcdsaSecp256k1Signature ); }
    static get verifySchnorrSecp256k1Signature() { return new IRNative( IRNativeTag.verifySchnorrSecp256k1Signature ); }
    static get bls12_381_G1_add() { return new IRNative( IRNativeTag.bls12_381_G1_add ); }
    static get bls12_381_G1_neg() { return new IRNative( IRNativeTag.bls12_381_G1_neg ); }
    static get bls12_381_G1_scalarMul() { return new IRNative( IRNativeTag.bls12_381_G1_scalarMul ); }
    static get bls12_381_G1_equal() { return new IRNative( IRNativeTag.bls12_381_G1_equal ); }
    static get bls12_381_G1_hashToGroup() { return new IRNative( IRNativeTag.bls12_381_G1_hashToGroup ); }
    static get bls12_381_G1_compress() { return new IRNative( IRNativeTag.bls12_381_G1_compress ); }
    static get bls12_381_G1_uncompress() { return new IRNative( IRNativeTag.bls12_381_G1_uncompress ); }
    static get bls12_381_G2_add() { return new IRNative( IRNativeTag.bls12_381_G2_add ); }
    static get bls12_381_G2_neg() { return new IRNative( IRNativeTag.bls12_381_G2_neg ); }
    static get bls12_381_G2_scalarMul() { return new IRNative( IRNativeTag.bls12_381_G2_scalarMul ); }
    static get bls12_381_G2_equal() { return new IRNative( IRNativeTag.bls12_381_G2_equal ); }
    static get bls12_381_G2_hashToGroup() { return new IRNative( IRNativeTag.bls12_381_G2_hashToGroup ); }
    static get bls12_381_G2_compress() { return new IRNative( IRNativeTag.bls12_381_G2_compress ); }
    static get bls12_381_G2_uncompress() { return new IRNative( IRNativeTag.bls12_381_G2_uncompress ); }
    static get bls12_381_millerLoop() { return new IRNative( IRNativeTag.bls12_381_millerLoop ); }
    static get bls12_381_mulMlResult() { return new IRNative( IRNativeTag.bls12_381_mulMlResult ); }
    static get bls12_381_finalVerify() { return new IRNative( IRNativeTag.bls12_381_finalVerify ); }
    static get keccak_256() { return new IRNative( IRNativeTag.keccak_256 ); }
    static get blake2b_224() { return new IRNative( IRNativeTag.blake2b_224 ); }
    static get integerToByteString() { return new IRNative( IRNativeTag.integerToByteString ); }
    static get byteStringToInteger() { return new IRNative( IRNativeTag.byteStringToInteger ); }
    // plomin (batch 5)
    static get andByteString() { return new IRNative( IRNativeTag.andByteString ); }
    static get orByteString() { return new IRNative( IRNativeTag.orByteString ); }
    static get xorByteString() { return new IRNative( IRNativeTag.xorByteString ); }
    static get complementByteString() { return new IRNative( IRNativeTag.complementByteString ); }
    static get readBit() { return new IRNative( IRNativeTag.readBit ); }
    static get writeBits() { return new IRNative( IRNativeTag.writeBits ); }
    static get replicateByte() { return new IRNative( IRNativeTag.replicateByte ); }
    static get shiftByteString() { return new IRNative( IRNativeTag.shiftByteString ); }
    static get rotateByteString() { return new IRNative( IRNativeTag.rotateByteString ); }
    static get countSetBits() { return new IRNative( IRNativeTag.countSetBits ); }
    static get findFirstSetBit() { return new IRNative( IRNativeTag.findFirstSetBit ); }
    static get ripemd_160() { return new IRNative( IRNativeTag.ripemd_160 ); }

    static get _dropList() { return new IRNative( IRNativeTag._dropList ); }
    static get _foldr() { return new IRNative( IRNativeTag._foldr ); }
    static get _foldl() { return new IRNative( IRNativeTag._foldl ); }
    // static get _mkFindDataOptional() { return new IRNative( IRNativeTag._mkFindDataOptional ); }
    static get _length() { return new IRNative( IRNativeTag._length ); }
    static get _some() { return new IRNative( IRNativeTag._some ); }
    static get _every() { return new IRNative( IRNativeTag._every ); }
    static get _filter() { return new IRNative( IRNativeTag._filter ); }
    // static get _fstPair() { return new IRNative( IRNativeTag._fstPair ); }
    // static get _sndPair() { return new IRNative( IRNativeTag._sndPair ); }
    static get _id() { return new IRNative( IRNativeTag._id ); }
    static get _not() { return new IRNative( IRNativeTag._not ); }
    static get _strictAnd() { return new IRNative( IRNativeTag._strictAnd ); }
    static get _strictOr() { return new IRNative( IRNativeTag._strictOr ); }
    static get _gtBS() { return new IRNative( IRNativeTag._gtBS ); }
    static get _gtEqBS() { return new IRNative( IRNativeTag._gtEqBS ); }
    static get _gtInt() { return new IRNative( IRNativeTag._gtInt ); }
    static get _gtEqInt() { return new IRNative( IRNativeTag._gtEqInt ); }
    static get _strToData() { return new IRNative( IRNativeTag._strToData ); }
    static get _pairDataToData() { return new IRNative( IRNativeTag._pairDataToData ); }
    static get _strFromData() { return new IRNative( IRNativeTag._strFromData ); }
    static get _pairDataFromData() { return new IRNative( IRNativeTag._pairDataFromData ); }
    static get _mkEqualsList() { return new IRNative( IRNativeTag._mkEqualsList ); }
    static get _equalPairData() { return new IRNative( IRNativeTag._equalPairData ); }
    static get _equalBoolean() { return new IRNative( IRNativeTag._equalBoolean ); }
    static get _negateInt() { return new IRNative( IRNativeTag._negateInt ); }
    static get _mkMapList() { return new IRNative( IRNativeTag._mkMapList ); }
    static get _bytesToIntBE() { return new IRNative( IRNativeTag._bytesToIntBE ); }
    static get _boolToInt() { return new IRNative( IRNativeTag._boolToInt ); }
    /** internally handles int size */
    static get _intToBytesBE() { return new IRNative( IRNativeTag._intToBytesBE ); }
    static get _intToBool() { return new IRNative( IRNativeTag._intToBool ); }
    static get _exponentiateInteger() { return new IRNative( IRNativeTag._exponentiateInteger ); }
    static get _amountOfValue() { return new IRNative( IRNativeTag._amountOfValue ); }
    static get _sortedValueLovelaces() { return new IRNative( IRNativeTag._sortedValueLovelaces ); }
    static get _getCredentialsHash() { return new IRNative( IRNativeTag._getCredentialsHash ); }
    static get _increment() { return new IRNative( IRNativeTag._increment ); }
    static get _decrement() { return new IRNative( IRNativeTag._decrement ); }
    static get _isZero() { return new IRNative( IRNativeTag._isZero ); }


    static equals( type: TirType ): IRTerm
    {
        type = getUnaliased( type );
        if( type instanceof TirAliasType ) throw new Error("unreachable")
        if( type instanceof TirIntT ) return IRNative.equalsInteger;
        if( type instanceof TirBytesT ) return IRNative.equalsByteString;
        if( type instanceof TirStringT ) return IRNative.equalsString;
        if( type instanceof TirBoolT ) return IRNative._equalBoolean;
        if( type instanceof TirPairDataT ) return IRNative._equalPairData;
        if(
            type instanceof TirDataT
            || type instanceof TirDataOptT 
            || type instanceof TirDataStructType 
        ) return IRNative.equalsData;
        if( type instanceof TirListT ) return IRNative.equalListOf( getListTypeArg( type )! );
        if( type instanceof TirLinearMapT ) return IRNative.equalListOf( new TirPairDataT() );
        if( type instanceof TirLinearMapEntryT ) return IRNative._equalPairData;
        if( type instanceof TirUnConstrDataResultT ) return getEqUnConstr();
        if( type instanceof TirVoidT ) return getEqVoid();

        const tsEnsureExsaustiveCheck: TirSopOptT | TirFuncT | TirSoPStructType | TirTypeParam = type;
        throw new Error("invalid type for std equality");
    }
    static equalListOf( type: TirType ): IRHoisted
    {
        const key = type.toTirTypeKey();
        if(!( eqListNames[ key ] instanceof IRHoisted ))
        {
            eqListNames[ key ] = new IRHoisted(
                _ir_apps(
                    IRNative._mkEqualsList,
                    IRNative.equals( type )
                ),
                { forceHoist: false, name: `equalsListOf_${type.toString()}` }
            );
        }
        return eqListNames[ key ].clone();
    }
}

/// NOTE, wrap in functions to break circular dependencies

const eqListNames: Record<string, IRHoisted> = {};

const eqUnConstr_a = Symbol("a");
const eqUnConstr_b = Symbol("b");
let _eqUnConstr: IRHoisted | undefined = undefined;
function getEqUnConstr(): IRHoisted
{
    if( _eqUnConstr instanceof IRHoisted ) return _eqUnConstr.clone();
    _eqUnConstr =  new IRHoisted(
        new IRFunc([ eqUnConstr_a, eqUnConstr_b ],
            _ir_apps(
                IRNative.equalsData,
                _ir_apps( IRNative.constrData, new IRVar( eqUnConstr_a ) ),
                _ir_apps( IRNative.constrData, new IRVar( eqUnConstr_b ) ),
            )
        )
    );
    return _eqUnConstr.clone();
}

const eqVoid_a = Symbol("a");
const eqVoid_b = Symbol("b");
let _eqVoid: IRHoisted | undefined = undefined;
function getEqVoid(): IRHoisted
{
    if( _eqVoid instanceof IRHoisted ) return _eqVoid.clone();
    _eqVoid =  new IRHoisted(
        new IRFunc([ eqVoid_a, eqVoid_b ],
            IRConst.bool( true )
        )
    );
    return _eqVoid.clone();
}