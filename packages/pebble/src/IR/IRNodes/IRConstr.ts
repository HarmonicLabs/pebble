import { Cloneable } from "../../utils/Cloneable";
import { ToJson } from "../../utils/ToJson";
import { forceBigUInt } from "../../utils/ints";
import { IIRTerm, IRTerm } from "../IRTerm";
import { IIRParent } from "../interfaces";
import { IRParentTerm, isIRParentTerm } from "../utils/isIRParentTerm";
import { BaseIRMetadata } from "./BaseIRMetadata";
import { mapArrayLike } from "./utils/mapArrayLike";
import { makeArrayLikeProxy } from "./utils/makeArrayLikeProxy";
import { _modifyChildFromTo } from "../toUPLC/_internal/_modifyChildFromTo";
import { IRNodeKind } from "../IRNodeKind";
import { isIRTerm } from "../utils/isIRTerm";
import { hashIrData, IRHash, irHashToBytes, isIRHash } from "../IRHash";
import { concatUint8Arr } from "../utils/concatUint8Arr";
import { positiveIntAsBytes } from "../utils/positiveIntAsBytes";
import { MutArrayLike } from "../utils/MutArrayLike";
import { Constr, UPLCTerm } from "@harmoniclabs/uplc";
import { ToUplcCtx } from "../toUPLC/ctx/ToUplcCtx";
import { invalidateHashesFrom } from "./utils/invalidateHashes";

export interface IRConstrMeta extends BaseIRMetadata {}

export class IRConstr
    implements IIRTerm, Cloneable<IRConstr>, IIRParent, ToJson
{
    readonly index!: bigint;
    readonly fields!: MutArrayLike<IRTerm>;

    readonly meta: IRConstrMeta

    static get kind(): IRNodeKind.Constr { return IRNodeKind.Constr; }
    get kind(): IRNodeKind.Constr { return IRConstr.kind; }
    static get tag(): Uint8Array { return new Uint8Array([ IRNodeKind.Constr ]); }

    constructor(
        index: number | bigint,
        fields: ArrayLike<IRTerm>,
        meta: IRConstrMeta = {},
        _unsafeHash?: IRHash | undefined
    ) {
        const self = this;

        this.meta = meta;

        this._parent = undefined;

        this.index = forceBigUInt( index );
        this.fields = makeArrayLikeProxy<IRTerm>(
            fields,
            isIRTerm,
            // initModifyElem
            newElem => {
                // newElem = newElem.clone();
                newElem.parent = self;
                // self.markHashAsInvalid()
                return newElem;
            },
            // modifyElem
            // called before setting the new value
            // the return value is the value that will be set
            (newElem, oldElem) => {
                newElem.parent = self;
                self.markHashAsInvalid();
                return newElem;
            }
        );

        this._hash = isIRHash( _unsafeHash ) ? _unsafeHash : undefined;
    }

    toUPLC(ctx: ToUplcCtx): UPLCTerm {
        if( this.fields.length <= 0 ) {
            return new Constr( this.index, [] );
        }

        const fields = mapArrayLike( this.fields, f => ctx.convert( f ) );
        
        return new Constr( this.index, fields );
    }

    private _hash: IRHash | undefined;
    get hash(): IRHash
    {
        if( isIRHash( this._hash ) ) return this._hash;

        this._hash = hashIrData(
            concatUint8Arr(
                IRConstr.tag,
                positiveIntAsBytes( this.index ),
                ...mapArrayLike( this.fields, f => irHashToBytes( f.hash ) )
            )
        );

        return this._hash;
    }
    isHashPresent(): boolean { return isIRHash( this._hash ); }
    markHashAsInvalid(): void
    { invalidateHashesFrom( this ); }

    children(): IRTerm[] {
        return Array.from( this.fields );
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
    
    clone(): IRConstr
    {
        return new IRConstr(
            this.index,
            mapArrayLike( this.fields, f => f.clone() ),
            { ...this.meta },
            this._hash
        );
    }
    toJSON() { return this.toJson(); }
    toJson(): any
    {
        return {
            index: this.index.toString(),
            fields: mapArrayLike( this.fields, f => f.toJson() )
        };
    }
}