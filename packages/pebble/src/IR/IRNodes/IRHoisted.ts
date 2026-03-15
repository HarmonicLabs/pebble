import { IRDelayed } from "./IRDelayed";
import { IRMetadata } from "../interfaces/IRMetadata";
import { Cloneable } from "@harmoniclabs/cbor/dist/utils/Cloneable";
import { freezeAll } from "@harmoniclabs/obj-utils";
import { BasePlutsError } from "../../utils/BasePlutsError";
import { ToJson } from "../../utils/ToJson";
import { IIRTerm, IRTerm } from "../IRTerm";
import { IHash, IIRParent } from "../interfaces";
import { concatUint8Arr } from "../utils/concatUint8Arr";
import { isClosedIRTerm } from "../utils/isClosedIRTerm";
import { IRApp } from "./IRApp";
import { IRForced } from "./IRForced";
import { IRFunc } from "./IRFunc";
import { IRLetted } from "./IRLetted";
import { IRParentTerm, isIRParentTerm } from "../utils/isIRParentTerm";
import { _modifyChildFromTo } from "../toUPLC/_internal/_modifyChildFromTo";
import { IRConstr } from "./IRConstr";
import { IRCase } from "./IRCase";
import { IRNodeKind } from "../IRNodeKind";
import { IRRecursive } from "./IRRecursive";
import { IRHash, isIRHash, hashIrData, irHashToBytes, equalIrHash, irHashToHex } from "../IRHash";
import { UPLCTerm } from "@harmoniclabs/uplc";
import { ToUplcCtx } from "../toUPLC/ctx/ToUplcCtx";
import { IRNative } from "./IRNative";
import { IRNativeTag, nativeTagToString } from "./IRNative/IRNativeTag";


export type HoistedSetEntry = {
    hoisted: IRHoisted,
    nReferences: number
}

export interface IRHoistedMeta {
    /**
     * force hoisting even if only a single reference is found
     * 
     * useful to hoist terms used once in recursive expressions
    **/
    forceHoist?: boolean,
    name?: string | undefined
    handled?: boolean
}

export interface IRHoistedMetadata extends IRMetadata {
    meta: IRHoistedMeta
}

const defaultHoistedMeta: IRHoistedMeta = freezeAll({
    forceHoist: false
});

const _hoisted_hash_to_symbol: Map<number, WeakRef<Symbol>> = new Map();

export function __unsafe_clear_hoisted_hash_to_symbol(): void
{
    _hoisted_hash_to_symbol.clear();
}

export class IRHoisted
    implements IIRTerm, Cloneable<IRHoisted>, IIRParent, ToJson, IRHoistedMetadata
{
    readonly meta!: IRHoistedMeta
    get name(): symbol
    {
        const hash = this.hash;
        const cached = _hoisted_hash_to_symbol.get( hash )?.deref();

        if( typeof cached === "symbol" ) return cached;

        const sym = Symbol( tryInferName( this.hoisted ) ?? "hoisted_" + irHashToHex( hash ) );
        
        /// @ts-ignore Argument of type 'WeakRef<object>' is not assignable to parameter of type 'WeakRef<Symbol>'
        _hoisted_hash_to_symbol.set( hash, new WeakRef( sym ) );

        return sym;
    }

    constructor(
        hoisted: IRTerm, 
        metadata: Partial<IRHoistedMeta> = {},
        _unsafeHash?: IRHash | undefined
    ) {
        // unwrap
        // !!! IMPORTANT !!!
        while( hoisted instanceof IRHoisted ) hoisted = hoisted.hoisted;

        if( !isClosedIRTerm( hoisted ) ) {
            throw new BasePlutsError(
                "only closed terms can be hoisted"
            );
        }

        this._parent = undefined;
        
        // initialize without calling "set"
        this._hoisted = hoisted;
        this._hoisted.parent = this;
        
        this._deps = undefined;


        this.meta = {
            ...defaultHoistedMeta,
            ...metadata,
            name: this._hoisted.meta?.name ?? metadata.name
        };
                
        this._hash = isIRHash( _unsafeHash ) ? _unsafeHash : undefined;
    }

    toUPLC(): UPLCTerm {
        throw new Error(
            "Can't convert 'IRHoisted' to valid UPLC;"
        );
    }

    private _hash: IRHash | undefined;
    get hash(): IRHash
    {
        if( isIRHash( this._hash ) ) return this._hash;

        this._hash = hashIrData(
            concatUint8Arr(
                IRHoisted.tag,
                irHashToBytes( this.hoisted.hash )
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
        return [ this.hoisted ];
    }

    static get kind(): IRNodeKind.Hoisted { return IRNodeKind.Hoisted; }
    get kind(): IRNodeKind.Hoisted { return IRHoisted.kind; }
    static get tag(): Uint8Array { return new Uint8Array([ IRHoisted.kind ]); }

    private _hoisted!: IRTerm;
    get value(): IRTerm { return this._hoisted; }
    get hoisted(): IRTerm { return this._hoisted; }
    set hoisted( newHoisted: IRTerm )
    {
        if( !isClosedIRTerm( newHoisted ) )
        throw new BasePlutsError(
            "only closed terms can be hoisted"
        );
        
        // dependencies need to be updated EVEN if hash is the same
        // since the terms might be the same but maybe cloned
        this._deps = undefined;

        // keep the parent reference in the old child, useful for compilation
        // _hoisted.parent = undefined;
        this._hoisted = newHoisted;
        this._hoisted.parent = this
    }
    
    private _deps: HoistedSetEntry[] | undefined;
    get dependencies(): HoistedSetEntry[]
    {
        if( this._deps === undefined )
        this._deps = getSortedHoistedSet( getHoistedTerms( this._hoisted ) );
        return this._deps;
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

    clone(): IRHoisted
    {
        return new IRHoisted(
            this.value.clone(),
            { ...this.meta },
            this._hash
        );
    }
    toJSON() { return this.toJson(); }
    toJson(): any
    {
        return {
            type: "IRHoisted",
            hoisted: this.hoisted.toJson()
        }
    }
}


/**
 * basically an insertion sort;
 * 
 * @param {HoistedSetEntry[]} hoistedTerms
 * @returns {HoistedSetEntry[]} a **new** array with ```IRHoisted```s with no dependencies first, followed by the dependents
 */
export function getSortedHoistedSet( hoistedTerms: HoistedSetEntry[] ): HoistedSetEntry[]
{
    const set: HoistedSetEntry[] = [];
    const hashesSet: IRHash[] = [];
     
    /**
     * **O((n * m) * d)**
     * 
     * where
     * 
     *      n = length of set
     *      m = number of terms passed
     *      d = number of unique dependencies among the passed terms
     */
    function addToSet( ..._terms: HoistedSetEntry[] ): void
    {
        for( let i = 0; i < _terms.length; i++ )
        {
            const thisHoistedEntry = _terms[i]; 
            const thisHash = thisHoistedEntry.hoisted.hash;

            const idxInSet = hashesSet.findIndex( h => equalIrHash( h, thisHash ) );

            // if( !hashesSet.includes( compiled ) )
            // "includes" uses standard equality (===)
            if( idxInSet < 0 ) // not present
            {
                // add dependencies first
                addToSet( ..._terms[ i ].hoisted.dependencies );

                hashesSet.push( thisHash );
                set.push( thisHoistedEntry );
            }
            else
            {
                const entry = set[ idxInSet ]; 
                entry.nReferences += thisHoistedEntry.nReferences;
                entry.hoisted.meta.forceHoist = 
                    entry.hoisted.meta.forceHoist || 
                    thisHoistedEntry.hoisted.meta.forceHoist;
            }
        }
    }

    addToSet( ...hoistedTerms );

    return set;
}

export function getHoistedTerms( irTerm: IRTerm ): HoistedSetEntry[]
{
    const hoisteds: HoistedSetEntry[] = [];

    function searchIn( term: IRTerm ): void
    {
        if( term instanceof IRHoisted )
        {
            // only push direct hoisteds
            // dependencies are counted calling `getSortedHoistedSet`
            hoisteds.push({ hoisted: term, nReferences: 1 });
            return;
        }

        if( term instanceof IRApp )
        {
            searchIn( term.fn );
            searchIn( term.arg );
            return;
        }

        if( term instanceof IRConstr )
        {
            for( let i = 0; i < term.fields.length; i++ )
            {
                searchIn( term.fields[i] );
            }
            return;
        }
        if( term instanceof IRCase )
        {
            searchIn( term.constrTerm );
            for( let i = 0; i < term.continuations.length; i++ )
            {
                searchIn( term.continuations[i] );
            }
            return;
        }

        if( term instanceof IRFunc )
        {
            searchIn( term.body );
            return;
        }
        
        if( term instanceof IRRecursive )
        {
            searchIn( term.body );
            return;
        }

        if( term instanceof IRLetted )
        {
            // useless
            // term.dependencies.forEach( searchIn )
            // dependecies are still in the body anyway (hoisted are closed)

            searchIn( term.value );
            return;
        }

        if( term instanceof IRForced )
        {
            searchIn( term.forced );
            return;
        }

        if( term instanceof IRDelayed )
        {
            searchIn( term.delayed );
            return;
        }

        // if( term instanceof IRNative ) return;
        // if( term instanceof IRVar ) return;
        // if( term instanceof IRConst ) return;
        // if( term instanceof IRError ) return;
    }

    searchIn( irTerm );

    return hoisteds;
}

export function cloneHoistedSetEntry({hoisted, nReferences}: HoistedSetEntry ): HoistedSetEntry
{
    return {
        hoisted: hoisted.clone(),
        nReferences
    };
}

export function tryInferName( value: IRTerm ): string | undefined
{
    if( value instanceof IRNative ) return nativeTagToString( value.tag );

    return undefined;
}