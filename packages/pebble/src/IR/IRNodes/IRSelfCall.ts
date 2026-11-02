import { Cloneable } from "@harmoniclabs/cbor/dist/utils/Cloneable";
import { BasePlutsError } from "../../utils/BasePlutsError";
import { ToJson } from "../../utils/ToJson";
import { IIRParent } from "../interfaces/IIRParent";
import { concatUint8Arr } from "../utils/concatUint8Arr";
import { IRParentTerm, isIRParentTerm } from "../utils/isIRParentTerm";
import { _modifyChildFromTo } from "../toUPLC/_internal/_modifyChildFromTo";
import { BaseIRMetadata } from "./BaseIRMetadata";
import { hashIrData, IRHash, isIRHash } from "../IRHash";
import { IRNodeKind } from "../IRNodeKind";
import { IRRecursive } from "./IRRecursive";
import { IIRTerm, IRTerm } from "../IRTerm";
import { IRFunc } from "./IRFunc";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { hashVarSym } from "./utils/hashVarSym";
import { UPLCTerm } from "@harmoniclabs/uplc";
import { ToUplcCtx } from "../toUPLC/ctx/ToUplcCtx";

export interface IRSelfCallMetadata extends BaseIRMetadata {}

export class IRSelfCall
    implements IIRTerm, Cloneable<IRSelfCall>, IIRParent, ToJson
{
    readonly name: symbol;
    readonly meta: IRSelfCallMetadata;

    constructor(
        name: symbol,
        _unsafeHash?: IRHash | undefined 
    ) {
        if(!(
            typeof name === "symbol"
            && typeof name.description === "string"
            && name.description.length > 0
        )) throw new BasePlutsError("invalid name for IRSelfCall");
        this.name = name;
        this._parent = undefined;

        this.meta = {};
        this._hash = isIRHash( _unsafeHash ) ? _unsafeHash : undefined;
    }

    toUPLC( ctx: ToUplcCtx ): UPLCTerm {
        throw new Error(
            "Can't convert 'IRSelfCall' to valid UPLC;" +
            "IRSelfCall are expected to be converted before calling '_irToUplc'"
        );
    }

    private _hash: IRHash | undefined;
    get hash(): IRHash {
        if( isIRHash( this._hash ) ) return this._hash;
        
        this._hash = hashIrData(
            concatUint8Arr(
                IRSelfCall.tag,
                hashVarSym( this.name )
            )
        );

        return this._hash;
    }
    isHashPresent(): boolean { return isIRHash( this._hash ); }
    markHashAsInvalid(): void {
        this._hash = undefined;
        this.parent?.markHashAsInvalid();
    }
    
    static get kind(): IRNodeKind.SelfCall { return IRNodeKind.SelfCall; }
    get kind(): IRNodeKind.SelfCall { return IRSelfCall.kind; }
    static get tag(): Uint8Array { return new Uint8Array([ IRSelfCall.kind ]); }

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
        
        // change parent
        this._parent = newParent;

        // if we change parent, _definition should be recalculated
        // this._definition = undefined;
    }

    children(): IRTerm[] { return []; }

    clone(): IRSelfCall
    {
        const cloned = new IRSelfCall(
            this.name,
            this._hash
        );
        Object.assign( cloned.meta, this.meta );
        return cloned;
    }
    toJSON() { return this.toJson(); }
    toJson(): any
    {
        return {
            type: "IRSelfCall",
            name: this.name
        }
    }
}