import { IRMetadata } from "../interfaces/IRMetadata";
import { Cloneable } from "@harmoniclabs/cbor/dist/utils/Cloneable";
import { freezeAll } from "@harmoniclabs/obj-utils";
import { BasePlutsError } from "../../utils/BasePlutsError";
import { ToJson } from "../../utils/ToJson";
import { IIRTerm, IRTerm } from "../IRTerm";
import { IIRParent } from "../interfaces";
import { concatUint8Arr } from "../utils/concatUint8Arr";
import { isIRTerm } from "../utils/isIRTerm";
import { IRHoisted } from "./IRHoisted";
import { IRParentTerm, isIRParentTerm } from "../utils/isIRParentTerm";
import { _modifyChildFromTo } from "../toUPLC/_internal/_modifyChildFromTo";
import { BaseIRMetadata } from "./BaseIRMetadata";
import { hashIrData, IRHash, irHashToBytes, isIRHash } from "../IRHash";
import { IRNodeKind } from "../IRNodeKind";
import { prettyIR } from "../utils/showIR";
import { UPLCTerm } from "@harmoniclabs/uplc";


export type LettedSetEntry = {
    letted: IRLetted,
    nReferences: number
};

export function jsonLettedSetEntry( entry: LettedSetEntry )
{
    return {
        letted: entry.letted.name.description,
        nReferences: entry.nReferences
    }

}

export function expandedJsonLettedSetEntry( entry: LettedSetEntry )
{
    return {
        letted: entry.letted.name.description,
        letted_value: prettyIR( entry.letted.value ).text.split("\n"),
        nReferences: entry.nReferences
    }
}

export interface IRLettedMeta extends BaseIRMetadata {
    /**
     * force hoisting even if only a single reference is found
     * 
     * useful to hoist letted terms used once in recursive expressions
    **/
    forceHoist: boolean,
    __src__?: string | undefined,
    isClosed: boolean
}

export interface IRLettedMetadata extends IRMetadata {
    meta: IRLettedMeta
}

const defaultLettedMeta: IRLettedMeta = freezeAll({
    forceHoist: false,
    __src__: undefined,
    isClosed: false
});

const _letted_hash_to_symbol: Map<number, WeakRef<Symbol>> = new Map();

export function __unsafe_clear_letted_hash_to_symbol(): void
{
    _letted_hash_to_symbol.clear();
}

export class IRLetted
    implements IIRTerm, Cloneable<IRLetted>, IIRParent, ToJson, IRLettedMetadata
{
    private _name: symbol;
    readonly meta!: IRLettedMeta

    get name(): symbol {
        const hash = this.hash;
        const cached = _letted_hash_to_symbol.get( hash )?.deref();

        if( typeof cached === "symbol" ) return cached;

        if( typeof this._name !== "symbol" ) throw new Error("IRLetted had invalid name");

        const sym = this._name;
        /// @ts-ignore Argument of type 'WeakRef<object>' is not assignable to parameter of type 'WeakRef<Symbol>'
        _letted_hash_to_symbol.set( hash, new WeakRef( sym ) );

        return sym;
    }

    constructor(
        name: symbol,
        toLet: IRTerm,
        metadata: Partial<IRLettedMeta> = {},
        _unsafeHash?: IRHash | undefined
    ) {
        if(!(
            typeof name === "symbol"
            && typeof name.description === "string"
            && name.description.length > 0
        )) throw new BasePlutsError("invalid name for IRVar");
        this._name = name;

        while(
            toLet instanceof IRLetted
            || toLet instanceof IRHoisted
        ) toLet = toLet instanceof IRLetted ? toLet.value : toLet.hoisted;

        if( !isIRTerm( toLet ) )
        throw new BasePlutsError(
            "letted value was not an IRTerm"
        );

        this._value = toLet;
        this._value.parent = this;

        this._deps = undefined;

        this._parent = undefined;

        this.meta = {
            ...defaultLettedMeta,
            ...metadata,
            // isClosed: metadata.isClosed || this.isClosedAtDbn( 0 )
        };
        
        this._hash = isIRHash( _unsafeHash ) ? _unsafeHash : undefined;
    }

    toUPLC(): UPLCTerm {
        throw new Error(
            "Can't convert 'IRLetted' to valid UPLC"
        );
    }

    private _hash: IRHash | undefined;
    get hash(): IRHash
    {
        if( isIRHash( this._hash ) ) return this._hash;

        this._hash = hashIrData(
            concatUint8Arr(
                IRLetted.tag,
                irHashToBytes( this.value.hash )
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

    private _value!: IRTerm
    get value(): IRTerm { return this._value; }
    set value( newVal: IRTerm )
    {
        while(
            newVal instanceof IRLetted
            || newVal instanceof IRHoisted
        ) newVal = newVal instanceof IRLetted ? newVal.value : newVal.hoisted;

        if( !isIRTerm( newVal ) )
        throw new BasePlutsError("letted term was not IRTerm");
    
        // remove deps even if the value is the same
        // newValue might be a clone of the current value
        // and so have different (new) objects
        this._deps = undefined;

        // keep the parent reference in the old child, useful for compilation
        // _value.parent = undefined;
        this._value = newVal;
        this._value.parent = this
    }

    private _deps: LettedSetEntry[] | undefined;
    get dependencies(): LettedSetEntry[]
    {
        if( this._deps === undefined )
        this._deps = getSortedLettedSet( getLettedTerms( this._value ) );
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

    children(): IRTerm[] {
        return [ this._value ];
    }

    static get kind(): IRNodeKind.Letted { return IRNodeKind.Letted; }
    get kind(): IRNodeKind.Letted { return IRLetted.kind; }
    static get tag(): Uint8Array { return new Uint8Array([ IRLetted.kind ]); }

    clone(): IRLetted
    {
        return new IRLetted(
            this.name,
            this.value.clone(),
            { ...this.meta },
            this._hash
        );
    }
    toJSON() { return this.toJson(); }
    toJson(): any 
    {
        return {
            type: "IRLetted",
            name: this.name.description,
            value: this.value.toJson()
        };
    }
}

/**
 * basically an insertion sort;
 * 
 * @param {LettedSetEntry[]} lettedTerms
 * @returns {LettedSetEntry[]} a **new** array with ```IRLetted```s with no dependencies first, followed by the dependents
 */
export function getSortedLettedSet( lettedTerms: LettedSetEntry[] ): LettedSetEntry[]
{
    const set: LettedSetEntry[] = [];
    const hashesSet: symbol[] = [];
     
    /**
     * **O((n * m) * d)**
     * 
     * where
     * 
     *      n = length of set
     *      m = number of terms passed
     *      d = number of unique dependencies among the passed terms
     */
    function addToSet( _terms: LettedSetEntry[] ): void
    {
        for( let i = 0; i < _terms.length; i++ )
        {
            const thisLettedEntry = _terms[i]; 
            const thisHash = thisLettedEntry.letted.name;

            const idxInSet = hashesSet.indexOf( thisHash )
            if( idxInSet < 0 ) // not present
            {
                // add dependencies first
                // dependencies don't have references to the current letted
                addToSet( getLettedTerms( thisLettedEntry.letted.value ) );

                hashesSet.push( thisHash );
                set.push({
                    letted: thisLettedEntry.letted,
                    nReferences: thisLettedEntry.nReferences
                });
            }
            else
            {
                const entry = set[ idxInSet ]; 
                entry.nReferences += thisLettedEntry.nReferences;
                entry.letted.meta.forceHoist = 
                    entry.letted.meta.forceHoist || 
                    thisLettedEntry.letted.meta.forceHoist;
            }
        }
    }

    addToSet( lettedTerms );

    return set;
}

export interface GetLettedTermsOptions {
    /**
     * looks for letted terms inside other letted terms
     * 
     * (unnecessary if called only to later pass the result to `getSortedLettedSet`)
     */
    all: boolean,
    /**
     * look for letted terms inside hoisted terms (always closed)
     */
    includeHoisted: boolean
}

export const default_getLettedTermsOptions: GetLettedTermsOptions = {
    all: false,
    includeHoisted: false
}
/**
 * 
 * @param {IRTerm} irTerm term to search in
 * @returns direct letted terms (no possible dependencies)
 */
export function getLettedTerms( irTerm: IRTerm, options?: Partial<GetLettedTermsOptions> ): LettedSetEntry[]
{
    const {
        all,
        includeHoisted
    } = {
        ...default_getLettedTermsOptions,
        ...options
    };

    const lettedTerms: LettedSetEntry[] = [];

    const stack: IRTerm[] = [ irTerm ];

    while( stack.length > 0 )
    {
        const t = stack.pop() as IRTerm;

        if( t instanceof IRHoisted )
        {
            if( includeHoisted ) stack.push( t.hoisted );
            continue;
        }

        if( t instanceof IRLetted )
        {
            lettedTerms.push({ letted: t, nReferences: 1 });
            if( all ) stack.push( t.value );
            continue;
        }

        stack.push( ...t.children() );
    }

    return lettedTerms;
}