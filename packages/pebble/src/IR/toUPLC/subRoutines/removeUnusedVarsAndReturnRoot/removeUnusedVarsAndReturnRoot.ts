import { _ir_apps, IRFunc, IRHoisted, IRLetted } from "../../../IRNodes";
import { IRSelfCall } from "../../../IRNodes/IRSelfCall";
import { IRVar } from "../../../IRNodes/IRVar";
import { IRTerm } from "../../../IRTerm";
import { _modifyChildFromTo } from "../../_internal/_modifyChildFromTo";
import { getApplicationTerms } from "../../utils/getApplicationTerms";
import { RemoveUnusedVarsCtx } from "./RemoveUnusedVarsCtx";
import { substituteInTracePoints } from "../../../sourceMap/irTraces";

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

    // the arguments do not always match the parameters one to one:
    // - more arguments than parameters: `func` returns a function, which gets the rest
    //   (`[[(λa. λb. body) A] B]`); those arguments stay, after the ones kept here
    // - fewer: `func` is applied to its first parameters only, and is still a function of the
    //   others, used or not; only a parameter that has an argument can go
    const originalParams = func.params.slice();
    const nApplied = Math.min( originalParams.length, args.length );
    const keptArgs: IRTerm[] = [];
    const removedParams: symbol[] = [];
    for( let i = 0; i < nApplied; i++ ) {
        const p = originalParams[i];
        if( unusedVars.includes( p ) ) {
            removedParams.push( p );
            // removed traces may still read it: they compute it from its argument
            substituteInTracePoints( func.body, p, args[i] );
        }
        else keptArgs.push( args[i] );
    }
    const extraArgs = args.slice( nApplied );

    // remove vars here
    filterParamsInplace( func.params, removedParams );
    // (the hash of a function says how many parameters it has)
    func.markHashAsInvalid();

    for( const funcArg of keptArgs ) {
        // arguments passed have the same context of the function called
        _removeUnusedVars( funcArg, ctx );
    }
    for( const funcArg of extraArgs ) {
        // so do the arguments of the function it returns
        _removeUnusedVars( funcArg, ctx );
    }

    // all parameters removed: the body, applied to the arguments of the function it is
    const fn = func.params.length > 0 ? func : func.body;
    const allArgs = keptArgs.concat( extraArgs );
    const newTerm = allArgs.length > 0
        ? _ir_apps( fn, ...(allArgs as [IRTerm, ...IRTerm[]]) )
        : fn;

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