import { inheritRange } from "../sourceMap/irRanges";
import { noteLambdaBinding } from "../sourceMap/irDebug";
import { Cloneable } from "@harmoniclabs/cbor/dist/utils/Cloneable";
import { BasePlutsError } from "../../utils/BasePlutsError";
import { ToJson } from "../../utils/ToJson";
import { IIRTerm, IRTerm } from "../IRTerm";
import { IIRParent } from "../interfaces/IIRParent";
import { concatUint8Arr } from "../utils/concatUint8Arr";
import { isIRTerm } from "../utils/isIRTerm";
import { positiveIntAsBytes } from "../utils/positiveIntAsBytes";
import { IRParentTerm, isIRParentTerm } from "../utils/isIRParentTerm";
import { _modifyChildFromTo } from "../toUPLC/_internal/_modifyChildFromTo";
import { BaseIRMetadata } from "./BaseIRMetadata";
import { IRNodeKind } from "../IRNodeKind";
import { hashIrData, IRHash, irHashToBytes, isIRHash } from "../IRHash";
import { Lambda, UPLCTerm } from "@harmoniclabs/uplc";
import { ToUplcCtx } from "../toUPLC/ctx/ToUplcCtx";
import { IRRecursive } from "./IRRecursive";
import { invalidateHashesFrom } from "./utils/invalidateHashes";

export interface IRFuncMetadata extends BaseIRMetadata {}

export class IRFunc
    implements IIRTerm, Cloneable<IRFunc>, IIRParent, ToJson
{
    readonly params: symbol[] = [];
    get arity(): number { return this.params.length; }

    constructor(
        params: symbol[],
        body: IRTerm,
        _unsafeHash?: IRHash | undefined
    ) {
        if( !isIRTerm( body ) )
        throw new Error("IRFunc body argument was not an IRTerm");

        this.params = params.slice();
        this.meta = {};

        this._body = body;
        this._body.parent = this;

        this._parent = undefined;
        this._hash = isIRHash( _unsafeHash ) ? _unsafeHash : undefined;
    }

    toUPLC( ctx: ToUplcCtx ): UPLCTerm {
        ctx = ctx.newChild( this.params );
        const arity = this.params.length;
        const irBody = this._body;
        // IRRecursive not valid for uplc translation
        let result = ctx.convert( irBody );
        // the innermost lambda binds the last parameter
        for( let i = 0; i < arity; i++ )
        {
            result = new Lambda( result );
            noteLambdaBinding( result, this.params[ arity - 1 - i ] );
        }
        return result;
    }

    private _hash: IRHash | undefined;
    get hash(): IRHash
    {
        if( isIRHash( this._hash ) ) return this._hash;

        this._hash = hashIrData(
            concatUint8Arr(
                IRFunc.tag,
                positiveIntAsBytes( this.arity ),
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

    static get kind(): IRNodeKind.Func { return  IRNodeKind.Func; }
    get kind(): IRNodeKind.Func { return IRFunc.kind; }
    static get tag(): Uint8Array { return new Uint8Array([ IRFunc.kind ]); }

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

    readonly meta: IRFuncMetadata
    get name(): string | undefined { return this.meta.name };

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

    clone(): IRFunc
    {
        const cloned = new IRFunc(
            this.params, // .slice() in constructor
            this._body.clone(),
            // as every node does: a copy remembers the hash its original remembers. A term
            // that remembers its hash holds only terms that do (`invalidateHashesFrom`
            // counts on it: it stops at the first node that remembers nothing), and a
            // function that forgot it under a copy that had not would hide from that copy
            // every change made inside the function
            this._hash
        );
        Object.assign( cloned.meta, this.meta );
        return cloned;
    }
    toJSON() { return this.toJson(); }
    toJson(): any
    {
        return {
            type: "IRFunc",
            arity: this.arity,
            body: this._body.toJson()
        }
    }
}
