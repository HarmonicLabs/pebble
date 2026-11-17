import { inheritRange } from "../sourceMap/irRanges";
import { UPLCTerm } from "@harmoniclabs/uplc";
import { BasePlutsError } from "../../utils/BasePlutsError";
import { Cloneable } from "../../utils/Cloneable";
import { ToJson } from "../../utils/ToJson";
import { IHash, IIRParent } from "../interfaces";
import { IRHash, isIRHash, hashIrData, irHashToBytes } from "../IRHash";
import { IRNodeKind } from "../IRNodeKind";
import { IIRTerm, IRTerm } from "../IRTerm";
import { ToUplcCtx } from "../toUPLC/ctx/ToUplcCtx";
import { concatUint8Arr } from "../utils/concatUint8Arr";
import { IRParentTerm, isIRParentTerm } from "../utils/isIRParentTerm";
import { isIRTerm } from "../utils/isIRTerm";
import { BaseIRMetadata } from "./BaseIRMetadata";
import { invalidateHashesFrom } from "./utils/invalidateHashes";

export interface IRRecursiveMetadata extends BaseIRMetadata {}

export class IRRecursive
    implements IIRTerm, Cloneable<IRRecursive>, IIRParent, ToJson
{
    get arity(): number { return 1; }
    readonly name: symbol;

    get params(): symbol[] { return [ this.name ]; }

    readonly meta: IRRecursiveMetadata

    constructor(
        name: symbol,
        body: IRTerm,
        _unsafeHash?: IRHash | undefined,
    ) {
        if( !isIRTerm( body ) )
        throw new Error("IRRecursive body argument was not an IRTerm");

        if(!(
            typeof name === "symbol"
            && typeof name.description === "string"
            && name.description.length > 0
        )) throw new BasePlutsError("invalid name for IRVar");
        this.name = name;
        this._parent = undefined;
        
        this.meta = { name: name.description };

        this._body = body;
        this._body.parent = this;

        this._hash = isIRHash( _unsafeHash ) ? _unsafeHash : undefined;
    }

    toUPLC(ctx: ToUplcCtx): UPLCTerm {   
        throw new Error(
            "Can't convert 'IRRecursive' to valid UPLC;" +
            "IRRecursive are expected to be converted before calling '_irToUplc'"
        ); 
    }

    private _hash: IRHash | undefined;
    get hash(): IRHash
    {
        if( isIRHash( this._hash ) ) return this._hash;

        this._hash = hashIrData(
            concatUint8Arr(
                IRRecursive.tag,
                irHashToBytes( this._body.hash )
            )
        );

        return this._hash;
    }
    isHashPresent(): boolean { return isIRHash( this._hash ); }
    markHashAsInvalid(): void { invalidateHashesFrom( this ); }

    children(): IRTerm[] {
        return [ this._body ];
    }

    static get kind(): IRNodeKind.Recursive { return IRNodeKind.Recursive; }
    get kind(): IRNodeKind.Recursive { return IRRecursive.kind; }
    static get tag(): Uint8Array { return new Uint8Array([ IRRecursive.kind ]); }

    private _body!: IRTerm
    get body(): IRTerm { return this._body }
    set body( newBody: IRTerm )
    {
        if(!isIRTerm( newBody ))
        {
            throw new BasePlutsError(
                "invalid IRTerm to be a function body"
            );
        }
        
        // keep the parent reference in the old child, useful for compilation
        // _body.parent = undefined;
        const replaced = this._body;
        this._body = newBody;
        this._body.parent = this;
        this.markHashAsInvalid();
        // sourcemaps: the new body takes the old one's place
        inheritRange( newBody, replaced );
    }

    private _parent: IRParentTerm | undefined;
    get parent(): IRParentTerm | undefined { return this._parent; }
    set parent( newParent: IRTerm | undefined )
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

    clone(): IRRecursive
    {
        const cloned = new IRRecursive(
            this.name,
            this._body.clone(),
            this._hash
        );
        Object.assign( cloned.meta, this.meta );
        return cloned;
    }

    toJSON() { return this.toJson(); }
    toJson(): any
    {
        return {
            type: "IRRecursive",
            arity: this.arity,
            body: this._body.toJson()
        };
    }
}