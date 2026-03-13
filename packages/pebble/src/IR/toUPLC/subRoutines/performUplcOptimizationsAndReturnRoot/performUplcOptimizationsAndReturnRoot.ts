import { get } from "http";
import { IRConst, IRConstr, IRError, IRNative } from "../../../IRNodes";
import { IRApp } from "../../../IRNodes/IRApp";
import { IRCase } from "../../../IRNodes/IRCase";
import { IRDelayed } from "../../../IRNodes/IRDelayed";
import { IRForced } from "../../../IRNodes/IRForced";
import { IRFunc } from "../../../IRNodes/IRFunc";
import { IRHoisted } from "../../../IRNodes/IRHoisted";
import { IRLetted } from "../../../IRNodes/IRLetted";
import { IRRecursive } from "../../../IRNodes/IRRecursive";
import { IRSelfCall } from "../../../IRNodes/IRSelfCall";
import { IRVar } from "../../../IRNodes/IRVar";
import { mapArrayLike } from "../../../IRNodes/utils/mapArrayLike";
import { IRTerm } from "../../../IRTerm";
import { _modifyChildFromTo } from "../../_internal/_modifyChildFromTo";
import { CompilerOptions, CompilerUplcOptimizations, isDebugUplcOptimizations } from "../../CompilerOptions";
import { expandFuncsAndReturnRoot, getExpandedIRFunc } from "./expandFuncsAndReturnRoot";
import { getApplicationTerms } from "../../utils/getApplicationTerms";
import { getUnboundedVars } from "../handleLetted/groupByScope";
import { prettyIRInline } from "../../../utils";

// type StackEntry = [ term: IRTerm, dbn: number ];
type StackEntry = IRTerm;

export function performUplcOptimizationsAndReturnRoot(
    root: IRTerm,
    options: CompilerOptions
): IRTerm
{
    // const opts = options.uplcOptimizations;
    // if( isDebugUplcOptimizations( opts ) ) return root;

    // const {
    //     groupApplications,
    //     inlineSingleUse: shouldInlineSingleUse,
    //     simplifyWrappedPartialFuncApps,
    //     removeForceDelay
    // } = opts;

    root = expandFuncsAndReturnRoot( root );
    const stack: StackEntry[] = [ root ];
    let t: IRTerm = root

    while( t = stack.pop()! )
    {
        if(
            t instanceof IRApp
            && isIdLike( t.fn )
        ) {
            const arg = t.arg;
            if( t.parent ) _modifyChildFromTo( t.parent, t, arg );
            else root = arg;
            stack.push( arg );
            continue;
        }

        const indepApps = groupIndependentApplications( t );
        if( indepApps ) {
            const { newRoot, args, nextBody } = indepApps;
            if( newRoot ) root = newRoot;
            stack.push( ...args );
            stack.push( nextBody );
            continue;
        }

        // group 3 or more consecutive applications into a case
        const consecutiveAppTerms = getApplicationTerms( t );
        if( consecutiveAppTerms )
        {
            const { func, args } = consecutiveAppTerms;

            if( args.length > 2 ) {
                const newTerm = new IRCase(
                    new IRConstr( 0, args ),
                    [ func ]
                );
                if( t.parent ) _modifyChildFromTo(
                    t.parent,
                    t,
                    newTerm
                );
                else root = newTerm;

                stack.push( ...args, func );
                continue;
            }

            // else normal application traversing
            stack.push( ...args, func );
            continue;
        }

        if(
            t instanceof IRRecursive ||
            t instanceof IRHoisted ||
            t instanceof IRLetted ||
            t instanceof IRSelfCall
        ) throw new Error("Unexpected term while performing uplc optimizations");

        stack.push( ...t.children() );
    }

    return root;
}

function isIdLike( term: IRTerm ): boolean
{
    return (
        term instanceof IRFunc &&
        term.params.length === 1 &&
        term.body instanceof IRVar &&
        term.body.name === term.params[0]
    );
}

/**
 * 
 * @returns either an object containing the new root, sorted args and next body
 *          or undefined if grouping wasnt possible (root is the same)
 */
function groupIndependentApplications( root: IRTerm ): { newRoot: IRTerm | undefined, args: IRTerm[], nextBody: IRTerm } | undefined
{
    const parent = root.parent;

    let applicaitonTerms = getApplicationTerms( root );
    if( !applicaitonTerms ) return undefined;
    let { func, args } = applicaitonTerms;
    if(!( func instanceof IRFunc ) ) return undefined;

    const params: symbol[] = func.params.slice();

    // Separate excess outer args: getApplicationTerms may return more args
    // than func.params (e.g. `(λp. body)(arg1)(arg2)` → 2 args, 1 param).
    // Excess args are trailing applications applied after all param bindings.
    const trailingArgs: IRTerm[] = args.splice(params.length);

    while( true )
    {
        applicaitonTerms = getApplicationTerms( func.body );
        if( !applicaitonTerms ) break;
        if(!( applicaitonTerms.func instanceof IRFunc ) ) break;
        func = applicaitonTerms.func;

        const nNewParams = func.params.length;
        const innerArgs = applicaitonTerms.args;

        params.push( ...func.params );
        args.push( ...innerArgs.slice( 0, nNewParams ) );
        // Inner excess args are applied before outer excess args
        if( innerArgs.length > nNewParams ) {
            trailingArgs.unshift( ...innerArgs.slice( nNewParams ) );
        }

        if( params.length !== args.length ) break;
    }

    const len = Math.min( params.length, args.length );
    const finalParams = params.slice( len );
    const finalArgs = [ ...args.slice( len ), ...trailingArgs ];
    params.length = len;
    args.length = len;

    const paramToArg: Record<symbol, IRTerm> = {};
    for( let i = 0; i < len; i++ ) {
        const p = params[i];
        paramToArg[p] = args[i];
    }

    const globalUnbound = getUnboundedVars( root );
    const groups: symbol[][] = [[]];

    for( let i = 0; i < len; i++ )
    {
        const p = params[i];
        const arg = args[i];

        const unbound = getUnboundedVars( arg, globalUnbound );

        let highestIdx: number = -1;
        for( let j = groups.length - 1; j >= 0; j-- )
        {
            const group = groups[j];
            if(
                group.some( sym =>
                    unbound.has( sym )
                )
            ) {
                highestIdx = j;
                break;
            }
        }
        if( highestIdx === groups.length - 1 ) {
            groups.push( [ p ] );
            continue;
        }
        groups[ highestIdx + 1 ].push( p );
    }

    groups[ groups.length - 1 ].push( ...finalParams );

    const sortedArgs: IRTerm[] = new Array( len );
    const soretedParams = groups.flat();
    for( let i = 0; i < len; i++ ) {
        const p = soretedParams[i];
        sortedArgs[i] = paramToArg[p];
    }

    let nextBody = func.body;
    if( finalArgs.length > 0 ) {
        if( finalArgs.length === 1 ) {
            nextBody = new IRApp(
                nextBody,
                finalArgs[0]
            );
        }
        else {
            nextBody = new IRCase(
                new IRConstr( 0, finalArgs ),
                [ nextBody ]
            );
        }
    }
    let newTerm = nextBody;
    for( let i = groups.length - 1; i >= 0; i-- )
    {
        const group = groups[i];
        if( group.length === 1 ) {
            newTerm = new IRApp(
                new IRFunc( group, newTerm ),
                paramToArg[ group[0] ]
            );
        }
        else if( group.length <= 0 ) continue;
        else {
            newTerm = new IRCase(
                new IRConstr( 0, group.map( p => paramToArg[p] ) ),
                [ new IRFunc( group, newTerm ) ]
            );
        }
    }

    if( parent ) _modifyChildFromTo( parent, root, newTerm );
    else root = newTerm;

    return {
        newRoot: !parent ? root : undefined,
        args: sortedArgs,
        nextBody
    };
}