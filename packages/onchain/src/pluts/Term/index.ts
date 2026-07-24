import { CEKConst, Machine } from "@harmoniclabs/plutus-machine";
import { ToUPLC, UPLCTerm } from "@harmoniclabs/uplc";
import { IRConst } from "../../IR/IRNodes/IRConst";
import { IRError } from "../../IR/IRNodes/IRError";
import { IRHoisted } from "../../IR/IRNodes/IRHoisted";
import { IRTerm } from "../../IR/IRTerm";
import { ToIR } from "../../IR/interfaces/ToIR";
import { compileIRToUPLC } from "../../IR/toUPLC/compileIRToUPLC";
import { PType } from "../PType";
import { FromPType, GenericTermType, TermType, ToPType, isWellFormedGenericType, termTypeToString } from "../type_system";
import { cloneTermType } from "../type_system/cloneTermType";
import { defineReadOnlyHiddenProperty } from "@harmoniclabs/obj-utils";
import { Cloneable, isCloneable } from "../../utils/Cloneable";
import { assert } from "../../utils/assert";
import { getCallStackAt } from "../../utils/getCallStackAt";
import { IRVar } from "@harmoniclabs/plu-ts-onchain";
import { punsafeConvertType } from "../lib/punsafeConvertType";
import { UtilityTermOf } from "../lib/std/UtilityTerms/addUtilityForType";

export type UnTerm<T extends Term<PType>> = T extends Term<infer PT extends PType > ? PT : never;

export class Term<PT extends PType>
    implements ToUPLC, ToIR, Cloneable<Term<PT>>
{
    /**
     * in most cases it will never be used
     * 
     * it's solely purpose is to allow typescript to rise errors (at type level)
     * when the type arguments don't match
     */
    _pInstance?: PT;
    get pInstance(): PT | undefined
    {
        if( this._pInstance === undefined ) return undefined;
        return isCloneable( this._pInstance ) ? 
            this._pInstance.clone() : 
            this._pInstance;
    }

    // typescript being silly here
    readonly type!: FromPType<PT> | TermType;
    
    readonly toUPLC!: ( deBruijnLevel?: bigint | number ) => UPLCTerm

    readonly toIR!: ( deBruijnLevel?: bigint | number ) => IRTerm

    readonly clone!: () => Term<PT>

    as<T extends TermType>( type: T ): UtilityTermOf<ToPType<T>>
    {
        return punsafeConvertType( this, type );
    }

    constructor( type: FromPType<PT> | TermType | GenericTermType, _toIR: ( dbn: bigint ) => IRTerm, isConstant: boolean = false )
    {
        assert(
            isWellFormedGenericType( type ) ||
            Boolean(void console.log( termTypeToString( type ) )),
            "invalid type while constructing Term"
        );

        let _type = cloneTermType( type );
        Object.defineProperty(
            this,
            "type",
            {
                get: () => cloneTermType( _type ),
                set: () => {},
                enumerable: true,
                configurable: false
            }
        );

        let _toIR_ = _toIR; //.bind( this );
        let shouldHoist = false;

        let _IR_cache : { [dbn: string]: IRTerm } = {};
        Object.defineProperty(
            this, "toIR",
            {
                value: ( deBruijnLevel: bigint | number = 0 ) =>
                {
                    const dbnStr = deBruijnLevel.toString();
                    const _cacheHit = _IR_cache[ shouldHoist ? "hoisted" : dbnStr ];
                    if( _cacheHit ) return _cacheHit.clone();

                    if( typeof deBruijnLevel !== "bigint" ) deBruijnLevel = BigInt( deBruijnLevel );

                    let ir = _toIR_( deBruijnLevel );
                    if( shouldHoist )
                    {
                        const res = new IRHoisted( ir );
                        _IR_cache["hoisted"] = res.clone();
                        return res;
                    }
                    
                    if( 
                        !(ir instanceof IRHoisted) &&
                        (this as any).isConstant &&
                        !(ir instanceof IRConst)
                    )
                    {
                        // console.log( showIR( ir ).text );
                        // logJson( ir )
                        // !!! IMPORTANT !!!
                        // `compileIRToUPLC` modifies the `IRTerm` in place !
                        // as for the current implementation we don't care
                        // because we are going to re-assign the variable `ir` anyway
                        // if this ever changes make sure to call `ir.clone()`
                        let uplc = compileIRToUPLC( ir/*.clone()*/ );

                        // console.log( showUPLC( uplc ) )
        
                        // !!! IMPORTANT !!!
                        // pair creation assumes this evaluation is happening here
                        // if for whatever reason this is removed please adapt the rest of the codebas
                        uplc = Machine.evalSimple( uplc );

                        if( uplc instanceof CEKConst )
                        {
                            ir = new IRConst( this.type, uplc.value as any );
                        }
                        else
                        {
                            ir = new IRError();
                        }
                    }

                    if(!(
                        // we don't cache `IRVar` since
                        // it is likely they will be accessed at different dbn
                        ir instanceof IRVar ||
                        // same for `IRConst`
                        ir instanceof IRConst
                    ))
                    {
                        _IR_cache[dbnStr] = ir.clone();
                    }
                    return ir;
                },
                writable: false,
                enumerable: true,
                configurable: false
            });

        let _UPLC_cache : { [dbn: string]: UPLCTerm } = {};
        Object.defineProperty(
        this, "toUPLC",
        {
            value: ( deBruijnLevel: bigint | number = 0 ) =>
            {
                const key = shouldHoist ? "hoisted" : deBruijnLevel.toString();
                const _cacheHit = _UPLC_cache[key];
                if( _cacheHit ) return _cacheHit.clone()
                const res = compileIRToUPLC( this.toIR( deBruijnLevel ) );
                _UPLC_cache[key] = res.clone();
                return res;
            },
            writable: false,
            enumerable: true,
            configurable: false
        });

        defineReadOnlyHiddenProperty(
            this,
            "hoist",
            () => {
                shouldHoist = true;
            }
        )

        let _isConstant: boolean = false;
        Object.defineProperty(
            this,
            "isConstant",
            {
                get: () => _isConstant,
                set: ( isConst: boolean ) => {
                    if( typeof isConst !== "boolean" ) return;
                    
                    _isConstant = isConst;
                },
                enumerable: false,
                configurable: false
            }
        );
        // calls the `set` function of the descriptor above;
        (this as any).isConstant = isConstant;

        Object.defineProperty(
            this, "clone",
            {
                value: () => {
                    const cloned = new Term(
                        this.type,
                        _toIR_,
                        Boolean((this as any).isConstant) // isConstant
                    ) as any;

                    Object.keys( this ).forEach( k => {

                        if( k === "_type" || k === "toUPLC" || k === "toIR" ) return;

                        Object.defineProperty(
                            cloned,
                            k,
                            Object.getOwnPropertyDescriptor(
                                this,
                                k
                            ) ?? {}
                        );

                    });

                    if( shouldHoist )
                    {
                        cloned.hoist();
                    }

                    return cloned;
                },
                writable: false,
                enumerable: false,
                configurable: false
            }
        );
    }
    
}

export type ToTermArr<Ts extends TermType[]> =
    Ts extends [] ? [] & Term<PType>[] :
    Ts extends [infer T extends TermType] ? [ Term<ToPType<T>>] & [ Term<PType> ] :
    Ts extends [infer T extends TermType, ...infer RestTs extends [ TermType, ...TermType[] ] ] ? [ Term<ToPType<T>>, ...ToTermArr<RestTs> ] & [ Term<PType>, ...Term<PType>[] ] :
    never;

export type ToTermArrNonEmpty<Ts extends [ TermType, ...TermType[] ]> =
    Ts extends [] ? never & Term<PType>[] :
    Ts extends [infer T extends TermType] ? [ Term<ToPType<T>>] & [ Term<PType> ] :
    Ts extends [infer T extends TermType, ...infer RestTs extends [ TermType, ...TermType[] ] ] ? [ Term<ToPType<T>>, ...ToTermArr<RestTs> ] & [ Term<PType>, ...Term<PType>[] ] :
    never;
