import { _ir_apps, IRFunc, IRHoisted, IRLetted } from "../../../IRNodes";
import { IRSelfCall } from "../../../IRNodes/IRSelfCall";
import { IRVar } from "../../../IRNodes/IRVar";
import { IRTerm } from "../../../IRTerm";
import { _modifyChildFromTo } from "../../_internal/_modifyChildFromTo";
import { getApplicationTerms } from "../../utils/getApplicationTerms";
import { RemoveUnusedVarsCtx } from "./RemoveUnusedVarsCtx";

export function removeUnusedVarsAndReturnRoot( term: IRTerm ): IRTerm
{
    // we need to go bottom up
    // ONLY REMOVE UNUSED VARS IF NOT UNIT
    // (in which case we need to keep it for eventual side effects (asserts and traces))

    return _removeUnusedVars( term, RemoveUnusedVarsCtx.root() );
}

function _removeUnusedVars( term: IRTerm, ctx: RemoveUnusedVarsCtx ): IRTerm
{
    if( term instanceof IRVar ) {
        // increment used
        ctx.incrementVarUse( term.name );
        return term;
    }

    const applicationTerms = getApplicationTerms( term );
    
    if( !applicationTerms )
    {
        const childrens = term.children();
        const nextCtx = term instanceof IRFunc
            ? ctx.newChild( term.params )
            : ctx;
        for( const c of childrens ) {
            _removeUnusedVars( c, nextCtx );
        }
        return term;
    }

    const { func, args } = applicationTerms;

    if(!( func instanceof IRFunc )) {
        for( const child of term.children() ) {
            // same as parent ctx
            _removeUnusedVars( child, ctx );
        }
        return term;
    }

    const funcCtx = ctx.newChild( func.params );
    func.body = _removeUnusedVars( func.body, funcCtx );

    const unusedVars = funcCtx.getUnusedVars();
    // if all variables are used, keep as is
    if( unusedVars.length <= 0 )
    {
        for( const funcArg of args ) {
            // arguments passed have the same context of the function called
            _removeUnusedVars( funcArg, ctx );
        }
        return term;
    }

    const originalParams = func.params.slice();
    const filteredArgs: IRTerm[] = [];
    for( let i = 0; i < originalParams.length; i++ ) {
        const p = originalParams[i];
        if( !unusedVars.includes( p ) ) filteredArgs.push( args[i] );
    }

    // remove vars here
    filterParamsInplace( func.params, unusedVars );

    for( const funcArg of filteredArgs ) {
        // arguments passed have the same context of the function called
        _removeUnusedVars( funcArg, ctx );
    }

    const someArgsWereUsed = filteredArgs.length > 0;
    const newTerm = someArgsWereUsed
        ? _ir_apps( func, ...(filteredArgs as [IRTerm, ...IRTerm[]]) )
        : func.body; // all unused, remove function, just keep the body

    const parent = term.parent;
    if( parent ) _modifyChildFromTo( parent, term, newTerm );
    
    return newTerm;
}

function filterParamsInplace( params: symbol[], unusedVars: symbol[] ): void
{
    let writeIdx = 0;
    for( let readIdx = 0; readIdx < params.length; readIdx++ )
    {
        const p = params[ readIdx ];
        if( !unusedVars.includes( p ) ) {
            params[ writeIdx ] = p;
            writeIdx++;
        }
    }
    params.length = writeIdx;
}