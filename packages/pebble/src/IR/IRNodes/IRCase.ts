import { Cloneable } from "../../utils/Cloneable";
import { ToJson } from "../../utils/ToJson";
import { IIRTerm, IRTerm } from "../IRTerm";
import { IHash, IIRParent } from "../interfaces";
import { concatUint8Arr } from "../utils/concatUint8Arr";
import { IRParentTerm, isIRParentTerm } from "../utils/isIRParentTerm";
import { BaseIRMetadata } from "./BaseIRMetadata";
import { mapArrayLike } from "./utils/mapArrayLike";
import { makeArrayLikeProxy } from "./utils/makeArrayLikeProxy";
import { MutArrayLike } from "../utils/MutArrayLike";
import { _modifyChildFromTo } from "../toUPLC/_internal/_modifyChildFromTo";
import { shallowEqualIRTermHash } from "../utils/equalIRTerm";
import { IRNodeKind } from "../IRNodeKind";
import { isIRTerm } from "../utils/isIRTerm";
import { hashIrData, IRHash, irHashToBytes, isIRHash } from "../IRHash";
import { Case, UPLCTerm } from "@harmoniclabs/uplc";
import { ToUplcCtx } from "../toUPLC/ctx/ToUplcCtx";

export interface IRCaseMeta extends BaseIRMetadata {}

export class IRCase
    implements IIRTerm, Cloneable<IRCase>, IIRParent, ToJson
{
    readonly continuations!: MutArrayLike<IRTerm>;

    static get kind(): IRNodeKind.Case { return IRNodeKind.Case; }
    get kind(): IRNodeKind.Case { return IRCase.kind; }
    static get tag(): Uint8Array { return new Uint8Array([ IRCase.kind ]); }

    constructor(
        constrTerm: IRTerm,
        continuations: ArrayLike<IRTerm>,
        meta: IRCaseMeta = {},
        _unsafeHash?: IRHash | undefined
    ) {
        const self = this;

        this.meta = meta;

        this._constrTerm = constrTerm;
        this._constrTerm.parent = self;

        this.continuations = makeArrayLikeProxy<IRTerm>(
            continuations,
            isIRTerm,
            // initModifyElem
            // function called once for each element in the array
            // only at element definition
            newElem => {
                newElem.parent = self;
                return newElem;
            },
            // modifyElem
            (newElem, oldElem) => {
                // keep the parent reference in the old child, useful for compilation
                // oldElem.parent = undefined;
                newElem.parent = self;
                return newElem;
            }
        );

        this._hash = isIRHash( _unsafeHash ) ? _unsafeHash : undefined;
    }

    toUPLC(ctx: ToUplcCtx): UPLCTerm {
        const constrTermUplc = this.constrTerm.toUPLC( ctx );
        const continuationsUplc = mapArrayLike(
            this.continuations,
            c => c.toUPLC( ctx )
        );

        return new Case(
            constrTermUplc,
            continuationsUplc
        );
    }

    private _hash: IRHash | undefined;
    get hash(): IRHash {
        if( isIRHash( this._hash ) ) return this._hash;

        this._hash = hashIrData(
            concatUint8Arr(
                IRCase.tag,
                irHashToBytes( this.constrTerm.hash ),
                ...Array.from( this.continuations, c => irHashToBytes( c.hash ) )
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
            this.constrTerm,
            ...Array.from( this.continuations )
        ];
    }
    
    private _constrTerm!: IRTerm;
    get constrTerm(): IRTerm { return this._constrTerm; }
    set constrTerm( newConstrTerm: IRTerm )
    {
        if( !isIRTerm( newConstrTerm ) ) return;

        // keep the parent reference in the old child, useful for compilation
        // constrTerm.parent = undefined;
        this._constrTerm = newConstrTerm;
        this._constrTerm.parent = this;
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

    readonly meta: IRCaseMeta

    clone(): IRCase
    {
        return new IRCase(
            // MUST be cloned like the continuations: passing the original
            // node re-parents it onto the clone, so pipeline mutations on
            // the clone (native hoisting etc.) leak into every other tree
            // still referencing it — this is how the shared module-level
            // FromData/ToData helpers got poisoned after their first use
            // (BUG 43, "only closed terms can be hoisted").
            this.constrTerm.clone(),
            mapArrayLike( this.continuations, f => f.clone() ),
            { ...this.meta },
            this._hash
        );
    }
    toJSON() { return this.toJson(); }
    toJson(): any
    {
        return {
            constrTerm: this.constrTerm.toString(),
            continuations: mapArrayLike( this.continuations, f => f.toJson() )
        };
    }
}