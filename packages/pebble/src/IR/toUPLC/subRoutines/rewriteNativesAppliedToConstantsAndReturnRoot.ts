import { TirBoolT, TirIntT } from "../../../compiler/tir/types/TirNativeType";
import { equalIrHash } from "../../IRHash";
import { _ir_apps } from "../../IRNodes/IRApp";
import { IRCase } from "../../IRNodes/IRCase";
import { IRConst } from "../../IRNodes/IRConst";
import { IRFunc } from "../../IRNodes/IRFunc";
import { IRHoisted } from "../../IRNodes/IRHoisted";
import { IRLetted } from "../../IRNodes/IRLetted";
import { IRNative } from "../../IRNodes/IRNative";
import { IRNativeTag } from "../../IRNodes/IRNative/IRNativeTag";
import { IRVar } from "../../IRNodes/IRVar";
import { IRTerm } from "../../IRTerm";
import { _modifyChildFromTo } from "../_internal/_modifyChildFromTo";
import { getApplicationTerms } from "../utils/getApplicationTerms";
import { _compTimeDropN } from "./_comptimeDropN";
import { hoisted_isZero, hoisted_length, hoisted_not } from "./replaceNatives/nativeToIR";

export function rewriteNativesAppliedToConstantsAndReturnRoot( term: IRTerm ): IRTerm
{
    // traverse the tree, find applications of natives to constants
    // and replace them with the optimized equivalent

    
    const stack: IRTerm[] = [ term ];
    function modifyTermAndPushToReprocess( current: IRTerm, newTerm: IRTerm ): void {
        const parent = current.parent;
        if( parent ) {
            _modifyChildFromTo( parent, current, newTerm );
        } else {
            term = newTerm;
            term.parent = undefined;
        }
        stack.unshift( newTerm ); // reprocess new term for further optimizations (if any)
    }

    while( stack.length > 0 )
    {
        const current = stack.pop()!;
        // const parent = current.parent;
        const appTerms = getApplicationTerms( current );

        if( !appTerms ) {
            stack.unshift( ...current.children() );
            continue;
        }

        const { func, args } = appTerms;
        const [ fstArg, ...restArgs ] = args;

        if(
            isId( func )
            && restArgs.length === 0
        ) {
            modifyTermAndPushToReprocess( current, fstArg );
            continue;
        }

        if( func instanceof IRNative )
        {
            const tag = func.tag;

            if(
                tag === IRNativeTag.strictIfThenElse
                && restArgs.length === 2
            ) {
                const conditionArg = fstArg;
                const condtionAppTerms = getApplicationTerms( conditionArg );
                if( !condtionAppTerms )
                {
                    const boolValue = getConstBool( conditionArg );
                    if( typeof boolValue === "boolean" ) {
                        const newTerm = boolValue ? restArgs[0] : restArgs[1];
                        modifyTermAndPushToReprocess( current, newTerm );
                        continue;
                    }

                    stack.unshift( ...current.children() ); // normal processing
                    continue;
                }
    
                const { func: condFunc, args: condArgs } = condtionAppTerms;
                const thenArg = restArgs[0];
                const elseArg = restArgs[1];
    
                if(
                    isNot( condFunc )
                    && condArgs.length === 1
                ) {
                    // replace with swapped branches
                    const newTerm = _ir_apps(
                        IRNative.strictIfThenElse,
                        condArgs[0],
                        elseArg,
                        thenArg
                    );
    
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
                else if(
                    isLessThanOrEqualInteger( condFunc )
                    && condArgs.length === 2
                ) {
                    const [ lhs, rhs ] = condArgs;
                    const lhsInt = getConstInt( lhs );
                    const rhsInt = getConstInt( rhs );
                    
                    if( typeof lhsInt === "bigint" && typeof rhsInt === "bigint" ) {
                        // replace with constant
                        const newTerm = ( lhsInt <= rhsInt ) ? thenArg : elseArg;
                        modifyTermAndPushToReprocess( current, newTerm );
                        continue;
                    }
                    else if( typeof lhsInt === "bigint" ) {
                        const newTerm = _ir_apps(
                            IRNative.strictIfThenElse,
                            _ir_apps(
                                new IRHoisted(
                                    _ir_apps(
                                        IRNative.lessThanEqualInteger,
                                        lhs
                                    )
                                ),
                                rhs
                            ),
                            thenArg,
                            elseArg
                        );
                        modifyTermAndPushToReprocess( current, newTerm );
                        continue;
                    }
                    else if( typeof rhsInt === "bigint" ) {
                        const newTerm = _ir_apps(
                            IRNative.strictIfThenElse,
                            _ir_apps(
                                new IRHoisted(
                                    _ir_apps(
                                        IRNative.lessThanInteger,
                                        rhs,
                                    )
                                ),
                                lhs
                            ),
                            elseArg,
                            thenArg
                        );
                        modifyTermAndPushToReprocess( current, newTerm );
                        continue;
                    }
                }
                else if(
                    isLessThanInteger( condFunc )
                    && condArgs.length === 2
                ) {
                    const [ lhs, rhs ] = condArgs;
                    const lhsInt = getConstInt( lhs );
                    const rhsInt = getConstInt( rhs );
                    
                    if( typeof lhsInt === "bigint" && typeof rhsInt === "bigint" ) {
                        // replace with constant
                        const newTerm = ( lhsInt < rhsInt ) ? thenArg : elseArg;
                        modifyTermAndPushToReprocess( current, newTerm );
                        continue;
                    }
                    else if( typeof lhsInt === "bigint" ) {
                        const newTerm = _ir_apps(
                            IRNative.strictIfThenElse,
                            _ir_apps(
                                new IRHoisted(
                                    _ir_apps(
                                        IRNative.lessThanInteger,
                                        lhs
                                    )
                                ),
                                rhs
                            ),
                            thenArg,
                            elseArg
                        );
                        modifyTermAndPushToReprocess( current, newTerm );
                        continue;
                    }
                    else if( typeof rhsInt === "bigint" ) {
                        const newTerm = _ir_apps(
                            IRNative.strictIfThenElse,
                            _ir_apps(
                                new IRHoisted(
                                    _ir_apps(
                                        IRNative.lessThanEqualInteger,
                                        rhs,
                                    )
                                ),
                                lhs
                            ),
                            elseArg,
                            thenArg
                        );
                        modifyTermAndPushToReprocess( current, newTerm );
                        continue;
                    }
                }
                else if(
                    isEqualsZero( condFunc )
                    && condArgs.length === 1
                ) {
                    const equalZeroArg = condArgs[0];
                    const equalZeroArgAppTerms = getApplicationTerms( equalZeroArg );
                    if( !equalZeroArgAppTerms ) {
                        // standard continuation
                        stack.unshift( ...current.children() );
                        continue;
                    }

                    const { func: eqZeroArgFunc, args: eqZeroArgArgs } = equalZeroArgAppTerms;
                    if(
                        isListLength( eqZeroArgFunc )
                        && eqZeroArgArgs.length === 1
                    ) {
                        const listTerm = eqZeroArgArgs[0];
                        // if( list.length() === 0 ) thenArg else elseArg
                        //   →  case list of cons _h _t -> elseArg ; nil -> thenArg
                        const dh = Symbol("_h");
                        const dt = Symbol("_t");
                        const newTerm = new IRCase(
                            listTerm,
                            [
                                new IRFunc( [ dh, dt ], elseArg ),
                                thenArg
                            ]
                        );
                        modifyTermAndPushToReprocess( current, newTerm );
                        continue;
                    }

                    // standard continuation
                    stack.unshift( ...current.children() );
                    continue;
                } // if( x.length() === 0 )
                else if (
                    isNullList( condFunc )
                    && condArgs.length === 1
                ) {
                    const listTerm = condArgs[0];
                    // if( nullList(list) ) thenArg else elseArg
                    //   →  case list of cons _h _t -> elseArg ; nil -> thenArg
                    const dh = Symbol("_h");
                    const dt = Symbol("_t");
                    const newTerm = new IRCase(
                        listTerm,
                        [
                            new IRFunc( [ dh, dt ], elseArg ),
                            thenArg
                        ]
                    );
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                } // if( x.isEmpty() )
            } // strictIfThenElse

            else if(
                tag === IRNativeTag.equalsInteger
                && restArgs.length === 1
            ) {
                const sndArg = restArgs[0];
                const fstInt = getConstInt( fstArg );
                const sndInt = getConstInt( sndArg );
    
                if( fstInt === BigInt( 0 ) ) {
                    // replace as `isZero( sndArg )`
                    const newTerm = _ir_apps(
                        IRNative._isZero,
                        sndArg 
                    );
    
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
                else if( sndInt === BigInt( 0 ) ) {
                    // replace as `isZero( fstArg )`
                    const newTerm = _ir_apps(
                        IRNative._isZero,
                        fstArg 
                    );
    
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
                else if( typeof fstInt === "bigint" && typeof sndInt === "bigint" ) {
                    // replace as constant
                    const newTerm = IRConst.bool( fstInt === sndInt );
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
                else if( typeof fstInt === "bigint" ) {
                    const newTerm = _ir_apps(
                        new IRHoisted(
                            _ir_apps(
                                IRNative.equalsInteger,
                                fstArg
                            )
                        ),
                        sndArg 
                    );
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
                else if( typeof sndInt === "bigint" ) {
                    const newTerm = _ir_apps(
                        new IRHoisted(
                            _ir_apps(
                                IRNative.equalsInteger,
                                sndArg
                            )
                        ),
                        fstArg 
                    );
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
            } // equalsInteger
            else if(
                tag === IRNativeTag.addInteger
                && restArgs.length === 1
            ) {
                const sndArg = restArgs[0];
                const fstInt = getConstInt( fstArg );
                const sndInt = getConstInt( sndArg );
    
                if( fstInt === BigInt( 1 ) ) {
                    // replace as `incr( sndArg )`
                    const newTerm = _ir_apps(
                        IRNative._increment,
                        sndArg 
                    );
    
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
                else if( sndInt === BigInt( 1 ) ) {
                    // replace as `incr( fstArg )`
                    const newTerm = _ir_apps(
                        IRNative._increment,
                        fstArg 
                    );
    
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
                else if( typeof fstInt === "bigint" && typeof sndInt === "bigint" ) {
                    // replace as constant
                    const newTerm = IRConst.int( fstInt + sndInt );
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
                else if( typeof fstInt === "bigint" ) {
                    const newTerm = _ir_apps(
                        new IRHoisted(
                            _ir_apps(
                                IRNative.addInteger,
                                fstArg
                            )
                        ),
                        sndArg 
                    );
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
                else if( typeof sndInt === "bigint" ) {
                    const newTerm = _ir_apps(
                        new IRHoisted(
                            _ir_apps(
                                IRNative.addInteger,
                                sndArg
                            )
                        ),
                        fstArg 
                    );
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
            } // addInteger
            else if(
                tag === IRNativeTag.subtractInteger
                && restArgs.length === 1
            ) {
                const sndArg = restArgs[0];
                const sndInt = getConstInt( sndArg );
    
                if( sndInt === BigInt( 1 ) ) {
                    // replace as `decr( fstArg )`
                    const newTerm = _ir_apps(
                        IRNative._decrement,
                        fstArg 
                    );
    
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
                else if( typeof sndInt === "bigint" ) {
                    const newTerm = _ir_apps(
                        new IRHoisted(
                            _ir_apps(
                                IRNative.addInteger,
                                IRConst.int( -sndInt )
                            )
                        ),
                        fstArg
                    );
                    modifyTermAndPushToReprocess( current, newTerm );
                    continue;
                }
            }
            else if(
                tag === IRNativeTag.strictChooseList
                && restArgs.length === 2
            ) {
                // strictChooseList list caseNil caseCons
                //   →  case list of (λ_h _t → caseCons) | caseNil
                // IRCase branches are naturally lazy, so wrapping caseNil/
                // caseCons in delay/force is unnecessary at the call site.
                const listTerm = fstArg;
                const caseNil  = restArgs[0];
                const caseCons = restArgs[1];
                const dh = Symbol("_h");
                const dt = Symbol("_t");
                const newTerm = new IRCase(
                    listTerm,
                    [
                        new IRFunc( [ dh, dt ], caseCons ),
                        caseNil
                    ]
                );
                modifyTermAndPushToReprocess( current, newTerm );
                continue;
            }
        }

        // only optimizations if first argument is constant after this point
        if(!( fstArg instanceof IRConst )) {
            stack.unshift( ...current.children() );
            continue;
        }

        if(
            isDropList( func )
            && (
                typeof fstArg.value === "bigint"
                || typeof fstArg.value === "number"
            )
        ) {
            const newTerm = restArgs.length >= 1 ? _ir_apps(
                _compTimeDropN( fstArg.value ),
                ...(restArgs as [ IRTerm, ...IRTerm[] ]),
            ) : _compTimeDropN( fstArg.value );

            modifyTermAndPushToReprocess( current, newTerm );
            continue;
        }

        // const tsEnsureExhaustiveCheck: never = func;
        stack.unshift( ...current.children() );
    }

    return term;
}

function isDropList( term: IRTerm ): boolean
{
    while(
        term instanceof IRHoisted
        || term instanceof IRLetted
    ) {
        if( term instanceof IRHoisted ) term = term.hoisted;
        else if( term instanceof IRLetted ) term = term.value;
    }
    return (
        term instanceof IRNative
        && term.tag === IRNativeTag._dropList
    )
}

function isId( term: IRTerm ): boolean
{
    while(
        term instanceof IRHoisted
        || term instanceof IRLetted
    ) {
        if( term instanceof IRHoisted ) term = term.hoisted;
        else if( term instanceof IRLetted ) term = term.value;
    }
    return (
        (
            term instanceof IRNative
            && term.tag === IRNativeTag._id
        ) || (
            term instanceof IRFunc
            && term.params.length === 1
            && term.body instanceof IRVar
            && term.body.name === term.params[0]
        )
    );
}

function isNot( term: IRTerm ): boolean
{
    while(
        term instanceof IRHoisted
        || term instanceof IRLetted
    ) {
        if( term instanceof IRHoisted ) term = term.hoisted;
        else if( term instanceof IRLetted ) term = term.value;
    }
    return (
        term instanceof IRNative
        && term.tag === IRNativeTag._not
    ) || (
        equalIrHash( hoisted_not.hoisted.hash, term.hash )
    );
}

function isNullList( term: IRTerm ): boolean
{
    while(
        term instanceof IRHoisted
        || term instanceof IRLetted
    ) {
        if( term instanceof IRHoisted ) term = term.hoisted;
        else if( term instanceof IRLetted ) term = term.value;
    }
    return (
        term instanceof IRNative
        && term.tag === IRNativeTag.nullList
    );
}

function isEqualsZero( term: IRTerm ): boolean
{
    while(
        term instanceof IRHoisted
        || term instanceof IRLetted
    ) {
        if( term instanceof IRHoisted ) term = term.hoisted;
        else if( term instanceof IRLetted ) term = term.value;
    }
    return (
        term instanceof IRNative
        && term.tag === IRNativeTag._isZero
    ) || (
        equalIrHash( hoisted_isZero.hash, term.hash )
    );
}

function isLessThanOrEqualInteger( term: IRTerm ): boolean
{
    while(
        term instanceof IRHoisted
        || term instanceof IRLetted
    ) {
        if( term instanceof IRHoisted ) term = term.hoisted;
        else if( term instanceof IRLetted ) term = term.value;
    }
    return (
        term instanceof IRNative
        && term.tag === IRNativeTag.lessThanEqualInteger
    );
}

function isLessThanInteger( term: IRTerm ): boolean
{
    while(
        term instanceof IRHoisted
        || term instanceof IRLetted
    ) {
        if( term instanceof IRHoisted ) term = term.hoisted;
        else if( term instanceof IRLetted ) term = term.value;
    }
    return (
        term instanceof IRNative
        && term.tag === IRNativeTag.lessThanInteger
    );
}

function isListLength( term: IRTerm ): boolean
{
    while(
        term instanceof IRHoisted
        || term instanceof IRLetted
    ) {
        if( term instanceof IRHoisted ) term = term.hoisted;
        else if( term instanceof IRLetted ) term = term.value;
    }
    return (
        term instanceof IRNative
        && term.tag === IRNativeTag._length
    ) || equalIrHash( hoisted_length.hash, term.hash );
}

function getConstInt( term: IRTerm ): bigint | undefined
{
    if(
        term instanceof IRConst
        && term.type instanceof TirIntT
        && typeof term.value === "bigint"
    ) return term.value;

    return undefined;
}
// function isConstIntOne( term: IRTerm ): boolean
// {
//     return (
//         term instanceof IRConst
//         && term.type instanceof TirIntT
//         && term.value === BigInt( 1 )
//     );
// }

function getConstBool( term: IRTerm ): boolean | undefined
{
    if(
        term instanceof IRConst
        && term.type instanceof TirBoolT
        && typeof term.value === "boolean"
    ) return term.value;

    return undefined;
}