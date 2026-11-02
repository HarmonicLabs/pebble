import { Cloneable } from "@harmoniclabs/cbor/dist/utils/Cloneable";
import { ToJson } from "../../utils/ToJson";
import { IHash } from "../interfaces/IHash";
import { IIRParent } from "../interfaces/IIRParent";
import { IRParentTerm, isIRParentTerm } from "../utils/isIRParentTerm";
import { _modifyChildFromTo } from "../toUPLC/_internal/_modifyChildFromTo";
import { BaseIRMetadata } from "./BaseIRMetadata";
import { IRNodeKind } from "../IRNodeKind";
import { IIRTerm, IRTerm } from "../IRTerm";
import { hashIrData, IRHash } from "../IRHash";
import { ErrorUPLC, UPLCTerm } from "@harmoniclabs/uplc";
import { ToUplcCtx } from "../toUPLC/ctx/ToUplcCtx";

const irErrorBitTag = new Uint8Array([ IRNodeKind.Error ]);
const irErrorHash: IRHash = hashIrData( irErrorBitTag );

export interface IRErrorMetadata extends BaseIRMetadata {}

export class IRError
    implements IIRTerm, Cloneable<IRError>, IIRParent, ToJson
{
    readonly meta: IRErrorMetadata

    msg?: string
    addInfos?: any

    constructor( msg?: string, addInfos?: any )
    {
        this.msg = msg;
        this.addInfos = addInfos ?? {};
        this.meta = {};
        this._parent = undefined;
    }

    toUPLC(): UPLCTerm {
        return new ErrorUPLC(
            this.msg,
            this.addInfos
        );
    }

    get hash(): IRHash { return irErrorHash; }
    isHashPresent(): boolean { return true; }
    markHashAsInvalid(): void { throw new Error("IRError: hash is always present and valid"); }

    children(): IRTerm[] {
        return [];
    }

    static get kind(): IRNodeKind.Error { return IRNodeKind.Error; }
    get kind(): IRNodeKind.Error { return IRError.kind; }
    static get tag(): Uint8Array { return irErrorBitTag.slice(); }

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

    clone(): IRError
    {
        const cloned = new IRError( this.msg, { ...this.addInfos } );
        Object.assign( cloned.meta, this.meta );
        return cloned;
    }
    toJSON() { return this.toJson(); }
    toJson()
    {
        return {
            type: "IRError"
        }
    }
};

