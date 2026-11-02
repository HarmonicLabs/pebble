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
import { equalIrHash, hashIrData, IRHash, irHashToBytes, isIRHash } from "../IRHash";
import { shallowEqualIRTermHash } from "../utils/equalIRTerm";
import { IRNodeKind } from "../IRNodeKind";
import { Force, UPLCTerm } from "@harmoniclabs/uplc";
import { ToUplcCtx } from "../toUPLC/ctx/ToUplcCtx";

export interface IRForcedMetadata extends BaseIRMetadata {}

export class IRForced
    implements IIRTerm, Cloneable<IRForced>, IIRParent, ToJson
{
    readonly meta: IRForcedMetadata

    constructor( forced: IRTerm, _unsafeHash?: IRHash )
    {
        this.meta = {};

        if( !isIRTerm( forced ) )
        throw new Error("IRForced argument was not an IRTerm");

        this._forced = forced;
        this._forced.parent = this;

        this._parent = undefined;
        
        this._hash = isIRHash( _unsafeHash ) ? _unsafeHash : undefined;
    }

    toUPLC(ctx: ToUplcCtx): UPLCTerm {
        return new Force( ctx.convert( this.forced ) );
    }

    private _hash: IRHash | undefined;
    get hash(): IRHash
    {
        if( isIRHash( this._hash ) ) return this._hash;

        this._hash = hashIrData(
            concatUint8Arr(
                IRForced.tag,
                irHashToBytes( this.forced.hash )
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
        return [ this._forced ];
    }

    private _forced!: IRTerm;
    get forced(): IRTerm { return this._forced; }
    set forced( newForced: IRTerm | undefined )
    {
        if(!isIRTerm( newForced )) {
            throw new BasePlutsError(
                "invalid IRTerm to be forced"
            );
        }
        
        // keep the parent reference in the old child, useful for compilation
        // _forced.parent = undefined;
        
        const replaced = this._forced;
        this._forced = newForced;
        this._forced.parent = this;
        // sourcemaps: the new child takes the old one's place
        inheritRange( newForced, replaced );
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

    static get kind(): IRNodeKind.Forced { return IRNodeKind.Forced; }
    get kind(): IRNodeKind.Forced { return IRForced.kind; }
    static get tag(): Uint8Array { return new Uint8Array([ IRForced.kind ]); }

    clone(): IRForced
    {
        const cloned = new IRForced(
            this.forced.clone(),
            this._hash
        );
        Object.assign( cloned.meta, this.meta );
        return cloned;
    }
    toJSON() { return this.toJson(); }
    toJson(): any
    {
        return {
            type: "IRForced",
            forced: this.forced.toJson()
        };
    }
}