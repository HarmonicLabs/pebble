import { inheritRange } from "../sourceMap/irRanges";
import { Cloneable } from "@harmoniclabs/cbor/dist/utils/Cloneable";
import { BasePlutsError } from "../../utils/BasePlutsError";
import { ToJson } from "../../utils/ToJson";
import { IIRTerm, IRTerm } from "../IRTerm";
import { IHash } from "../interfaces/IHash";
import { IIRParent } from "../interfaces/IIRParent";
import { concatUint8Arr } from "../utils/concatUint8Arr";
import { isIRTerm } from "../utils/isIRTerm";
import { IRParentTerm, isIRParentTerm } from "../utils/isIRParentTerm";
import { _modifyChildFromTo } from "../toUPLC/_internal/_modifyChildFromTo";
import { BaseIRMetadata } from "./BaseIRMetadata";
import { shallowEqualIRTermHash } from "../utils/equalIRTerm";
import { IRNodeKind } from "../IRNodeKind";
import { IRHash, isIRHash, hashIrData, irHashToBytes } from "../IRHash";
import { positiveIntAsBytes } from "../utils/positiveIntAsBytes";
import { mapArrayLike } from "./utils/mapArrayLike";
import { Delay, UPLCTerm } from "@harmoniclabs/uplc";
import { ToUplcCtx } from "../toUPLC/ctx/ToUplcCtx";

export interface IRDelayedMetadata extends BaseIRMetadata {}

export class IRDelayed
    implements IIRTerm, Cloneable<IRDelayed>, IIRParent, ToJson
{
    readonly meta: IRDelayedMetadata = {};

    constructor(
        delayed: IRTerm,
        _unsafeHash?: IRHash | undefined
    ) {
        if( !isIRTerm( delayed ) )
        throw new Error("IRDelayed argument was not an IRTerm");
        
        this._delayed = delayed;
        this._delayed.parent = this;
        
        this._parent = undefined;

        this._hash = isIRHash( _unsafeHash ) ? _unsafeHash : undefined;
    }

    toUPLC(ctx: ToUplcCtx): UPLCTerm {
        return new Delay( ctx.convert( this.delayed ) );
    }

    private _hash: IRHash | undefined;
    get hash(): IRHash
    {
        if( isIRHash( this._hash ) ) return this._hash;

        this._hash = hashIrData(
            concatUint8Arr(
                IRDelayed.tag,
                irHashToBytes( this.delayed.hash )
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
        return [ this.delayed ];
    }
    
    static get kind(): IRNodeKind.Delayed { return IRNodeKind.Delayed; }
    get kind(): IRNodeKind.Delayed { return IRDelayed.kind; }
    static get tag(): Uint8Array { return new Uint8Array([ IRDelayed.kind ]); }

    private _delayed!: IRTerm
    get delayed(): IRTerm { return this._delayed }
    set delayed( newDelayed: IRTerm | undefined)
    {
        if(!isIRTerm( newDelayed )) {
            throw new BasePlutsError(
                "invalid IRTerm to be delayed"
            );
        }
        
        // keep the parent reference in the old child, useful for compilation
        // _delayed.parent = undefined;
        
        const replaced = this._delayed;
        this._delayed = newDelayed;
        this._delayed.parent = this;
        // sourcemaps: the new child takes the old one's place
        inheritRange( newDelayed, replaced );
    }

    private _parent: IRParentTerm | undefined;
    get parent(): IRParentTerm | undefined { return this._parent }
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

    clone(): IRDelayed
    {
        const cloned = new IRDelayed(
            this.delayed.clone(),
            this._hash
        );
        Object.assign( cloned.meta, this.meta );
        return cloned;
    }
    toJSON() { return this.toJson(); }
    toJson(): any
    {
        return {
            type: "IRDelayed",
            delayed: this.delayed.toJson()
        }
    }
}