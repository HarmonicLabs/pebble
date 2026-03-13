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
import { getNRequiredForces, UPLCBuiltinTag } from "@harmoniclabs/uplc";

// type StackEntry = [ term: IRTerm, dbn: number ];
type StackEntry = IRTerm;

export function ensureProperlyForcedBuiltinsAndReturnRoot(
    root: IRTerm
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

    const stack: StackEntry[] = [ root ];
    let t: IRTerm = root

    while( t = stack.pop()! )
    {
        if( t instanceof IRNative ) {
            const expectedForces = getNRequiredForces( t.tag as any as UPLCBuiltinTag );
            if( expectedForces <= 0 ) continue;

            let newNode = t as IRTerm;
            let nDirectForces = 0;
            // save the original parent before walking up through existing forces
            // and before creating new IRForced wrappers (whose constructors
            // overwrite the child's parent pointer)
            const originalParent = t.parent;
            while( t.parent instanceof IRForced ) {
                nDirectForces++;
                t = t.parent;
            }
            if( nDirectForces === expectedForces ) continue;

            // when nDirectForces > 0, t has walked up to the topmost IRForced;
            // save its parent before wrapping overwrites parent pointers
            const replaceInParent = nDirectForces > 0 ? t.parent : originalParent;

            for( let i = 0; i < expectedForces - nDirectForces; i++ ) {
                newNode = new IRForced( newNode );
            }
            if( replaceInParent ) _modifyChildFromTo(
                replaceInParent,
                t,
                newNode
            );
            else root = newNode;
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

    while( true )
    {
        applicaitonTerms = getApplicationTerms( func.body );
        if( !applicaitonTerms ) break;
        if(!( applicaitonTerms.func instanceof IRFunc ) ) break;
        func = applicaitonTerms.func;

        params.push( ...func.params );
        args.push( ...applicaitonTerms.args );

        if( params.length !== args.length ) break;
    }

    const len = Math.min( params.length, args.length );
    const finalParams = params.slice( len );
    const finalArgs = args.slice( len );
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