import { inheritRange } from "../sourceMap/irRanges";
import { IIRTerm, IRTerm } from "../IRTerm";
import { IHash } from "../interfaces/IHash";
import { IIRParent } from "../interfaces/IIRParent";
import { concatUint8Arr } from "../utils/concatUint8Arr";
import { isIRTerm } from "../utils/isIRTerm";
import { ToJson } from "../../utils/ToJson";
import { Cloneable } from "@harmoniclabs/cbor/dist/utils/Cloneable";
import { IRParentTerm, isIRParentTerm } from "../utils/isIRParentTerm";
import { _modifyChildFromTo } from "../toUPLC/_internal/_modifyChildFromTo";
import { BaseIRMetadata } from "./BaseIRMetadata";
import { isObject } from "@harmoniclabs/obj-utils";
import { shallowEqualIRTermHash } from "../utils/equalIRTerm";
import { IRNodeKind } from "../IRNodeKind";
import { hashIrData, IRHash, irHashToBytes, isIRHash } from "../IRHash";
import { Application, UPLCTerm } from "@harmoniclabs/uplc";
import { ToUplcCtx } from "../toUPLC/ctx/ToUplcCtx";

export interface IRAppMeta extends BaseIRMetadata {
    __src__?: string | undefined
}

export class IRApp
    implements IIRTerm, Cloneable<IRApp>, IIRParent, ToJson
{
    constructor(
        _fn_: IRTerm,
        _arg_: IRTerm,
        meta: IRAppMeta | undefined = undefined,
        _unsafeHash?: IRHash
    )
    {
        if( !isIRTerm( _fn_ ) )
        throw new Error(
            "invalid function node for `IRApp`"
        );
        if( !isIRTerm( _arg_ ) )
        throw new Error(
            "invalid argument node for `IRApp`"
        );

        this._meta = meta;
        
        this._fn = _fn_;
        this._arg = _arg_;

        this._fn.parent = this;
        this._arg.parent = this;

        this._hash = isIRHash( _unsafeHash ) ? _unsafeHash : undefined;
    }

    toUPLC( ctx: ToUplcCtx ): UPLCTerm {
        const arg = ctx.convert( this._arg );
        const fn = ctx.convert( this._fn );
        return new Application( fn, arg );
    }

    private _hash: IRHash | undefined;
    get hash(): IRHash
    {
        if( isIRHash( this._hash ) ) return this._hash;

        this._hash = hashIrData(
            concatUint8Arr(
                IRApp.tag,
                irHashToBytes( this._fn.hash ),
                irHashToBytes( this._arg.hash )
            )
        );

        return this._hash;
    }
    isHashPresent(): boolean { return isIRHash( this._hash ); }
    markHashAsInvalid(): void {
        this._hash = undefined;
        this.parent?.markHashAsInvalid();
    }

    children(): IRTerm[] {
        return [
            this._fn,
            this._arg
        ];
    }

    static get kind(): IRNodeKind { return IRNodeKind.App; }
    get kind(): IRNodeKind { return IRApp.kind; }
    static get tag(): Uint8Array { return new Uint8Array([ IRApp.kind ]); }

    private _fn!: IRTerm;
    get fn(): IRTerm { return this._fn; }
    set fn( newFn: IRTerm ) {
        if( !isIRTerm( newFn ) ) return;
                    
        // keep the parent reference in the old child, useful for compilation
        // fn.parent = undefined;
        const replaced = this._fn;
        this._fn = newFn;
        this._fn.parent = this;
        // sourcemaps: the new child takes the old one's place
        inheritRange( newFn, replaced );
    }

    private _arg!: IRTerm;
    get arg(): IRTerm { return this._arg; }
    set arg( newArg: IRTerm )
    {
        if( !isIRTerm( newArg ) ) return;

        // keep the parent reference in the old child, useful for compilation
        // arg.parent = undefined;
        const replaced = this._arg;
        this._arg = newArg;
        this._arg.parent = this;
        // sourcemaps: the new child takes the old one's place
        inheritRange( newArg, replaced );
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
        
        // change parent
        this._parent = newParent;
    }

    private _meta: IRAppMeta | undefined;
    get meta(): IRAppMeta
    {
        if( !isObject( this._meta ) ) this._meta = {};
        return this._meta!;
    }

    clone(): IRApp
    {
        return new IRApp(
            this.fn.clone(),
            this.arg.clone(),
            isObject( this._meta ) ? { ...this._meta } : undefined,
            this._hash
        );
    }
    toJSON() { return this.toJson(); }
    toJson(): any
    {
        return {
            type: "IRApp",
            fn: this.fn.toJson(),
            arg: this.arg.toJson()
        }
    }
}

export function _ir_apps( ...terms: [ IRTerm, IRTerm, ...IRTerm[] ] ): IRApp
{
    // if( terms.length === 1 ) return terms[0] as IRApp;
    let term = new IRApp( terms[0], terms[1] );
    for( let i = 2; i < terms.length; i++ )
    {
        term = new IRApp(
            term,
            terms[i]
        );
    }
    return term;
}