/**
 * Case-over-Const lowering pass.
 *
 * The UPLC `Case` term accepts a constant scrutinee and reinterprets it
 * as a tag-untagged constructor (bool → 0/1, int N → N, unit → 0,
 * pair → constr 0 [fst, snd], list → constr 1 [] for `[]` or
 * constr 0 [head, tail] for cons).
 *
 * This pass replaces canonical `strictIfThenElse(cond, then, else)`
 * sequences with the equivalent `IRCase(cond, [else, then])` form. The
 * machine resolves bool=false → constr 0, bool=true → constr 1.
 * This subsumes the strict boolean helpers (`_not`, `_strictAnd`,
 * `_strictOr`) whose hoisted bodies are themselves `strictIfThenElse`
 * triple-apps — they get lowered inside their hoisted definitions.
 *
 * It also replaces the LAZY pattern emitted by `_ir_lazyIfThenElse`:
 *
 *     IRForced( strictIfThenElse cond (delay t) (delay e) )
 *
 * — which is how `&&`, `||` and pebble `if/else` are encoded today —
 * with `IRCase(cond, [e, t])`. Branches under `Case` are naturally
 * lazy, so the surrounding `force`/`delay` indirection is dropped.
 *
 * It also prunes trailing IRError continuations: a missing branch is
 * semantically equivalent to an evaluation-failure branch, so dropping a
 * trailing `IRError` reduces script size while preserving meaning.
 *
 * NOTE: `getApplicationTerms` sees through both raw `IRApp` chains AND
 * the case-constr-app encoding produced earlier in `performUplc…`
 * (i.e. `IRCase(IRConstr(0, [args]), [func])`). We therefore check the
 * app-pattern *before* the IRCase trailing-error pruning so that a case
 * that's really a function call gets unwrapped first.
 */

import { _ir_apps, IRApp } from "../../IRNodes/IRApp";
import { IRCase } from "../../IRNodes/IRCase";
import { IRDelayed } from "../../IRNodes/IRDelayed";
import { IRError } from "../../IRNodes/IRError";
import { IRForced } from "../../IRNodes/IRForced";
import { IRHoisted } from "../../IRNodes/IRHoisted";
import { IRLetted } from "../../IRNodes/IRLetted";
import { IRNative } from "../../IRNodes/IRNative";
import { IRNativeTag } from "../../IRNodes/IRNative/IRNativeTag";
import { IRFunc } from "../../IRNodes/IRFunc";
import { IRTerm } from "../../IRTerm";
import { _modifyChildFromTo } from "../_internal/_modifyChildFromTo";
import { getApplicationTerms } from "../utils/getApplicationTerms";

/**
 * `_makeAllNegativeNativesHoisted` wraps every `IRNative` reference in
 * an `IRHoisted` (despite the name, it touches positive tags too), and
 * subsequent sharing passes may further wrap in `IRLetted`. Unwrap so
 * the pattern detector can see the underlying native tag.
 */
function unwrapToNative( t: IRTerm ): IRTerm
{
    while( t instanceof IRHoisted ) t = (t as IRHoisted).hoisted;
    while( t instanceof IRLetted )  t = (t as IRLetted).value;
    return t;
}

export function rewriteToCaseOverConstAndReturnRoot( term: IRTerm ): IRTerm
{
    const stack: IRTerm[] = [ term ];

    function modifyTermAndPushToReprocess( current: IRTerm, newTerm: IRTerm ): void
    {
        const parent = current.parent;
        if( parent ) {
            _modifyChildFromTo( parent, current, newTerm );
        } else {
            term = newTerm;
            term.parent = undefined;
        }
        stack.unshift( newTerm );
    }

    while( stack.length > 0 )
    {
        const current = stack.pop()!;

        // LAZY pattern emitted by `_ir_lazyIfThenElse`:
        //   force( strictIfThenElse cond (delay t) (delay e) )
        // Rewrite to a bare `case cond [e, t]` (Case branches are lazy).
        if( current instanceof IRForced )
        {
            const innerApp = getApplicationTerms( current.forced );
            const innerFunc = innerApp ? unwrapToNative( innerApp.func ) : undefined;
            if(
                innerApp
                && innerFunc instanceof IRNative
                && innerFunc.tag === IRNativeTag.strictIfThenElse
                && innerApp.args.length === 3
                && innerApp.args[1] instanceof IRDelayed
                && innerApp.args[2] instanceof IRDelayed
            ) {
                const cond     = innerApp.args[0]!;
                const tBranch  = ( innerApp.args[1] as IRDelayed ).delayed;
                const eBranch  = ( innerApp.args[2] as IRDelayed ).delayed;
                const newTerm  = new IRCase( cond, [ eBranch, tBranch ] );
                modifyTermAndPushToReprocess( current, newTerm );
                continue;
            }

            // `IRForced(IRCase(s, [b0, b1, …]))` where every branch is
            // either `IRDelayed(v)` or `IRFunc(params, IRDelayed(v))` can
            // be simplified by stripping the force/delay pair: case
            // branches are naturally lazy in UPLC `case`. The
            // wrap typically comes from `_ir_lazyIfThenElse` lowering an
            // `if/else` whose condition then got rewritten to a list-case
            // (e.g. `if(nullList(L)) ...`) — the outer force is left
            // dangling around the resulting IRCase.
            if( current.forced instanceof IRCase )
            {
                const caseTerm = current.forced;
                const conts = caseTerm.continuations;
                const stripped: ( IRTerm | undefined )[] = [];
                let allOk = true;
                for( let i = 0; i < conts.length; i++ )
                {
                    const c = conts[ i ]!;
                    if( c instanceof IRDelayed )
                    {
                        stripped.push( c.delayed );
                    }
                    else if(
                        c instanceof IRFunc
                        && c.body instanceof IRDelayed
                    ) {
                        stripped.push(
                            new IRFunc( c.params.slice(), c.body.delayed )
                        );
                    }
                    else
                    {
                        allOk = false;
                        break;
                    }
                }
                if( allOk )
                {
                    const newCase = new IRCase(
                        caseTerm.constrTerm.clone(),
                        stripped as IRTerm[],
                    );
                    modifyTermAndPushToReprocess( current, newCase );
                    continue;
                }
            }

            stack.unshift( ...current.children() );
            continue;
        }

        // Application-pattern rewrites (raw IRApp chain OR case-constr-app
        // encoding produced by `performUplcOptimizationsAndReturnRoot`).
        const appTerms = getApplicationTerms( current );
        if( appTerms )
        {
            const { func, args } = appTerms;
            const unwrappedFunc = unwrapToNative( func );

            // strictIfThenElse cond then else  →  case cond [else, then]
            if(
                unwrappedFunc instanceof IRNative
                && unwrappedFunc.tag === IRNativeTag.strictIfThenElse
                && args.length === 3
            ) {
                const [ cond, thenBranch, elseBranch ] = args;
                const newTerm = new IRCase(
                    cond,
                    [ elseBranch, thenBranch ]
                );
                modifyTermAndPushToReprocess( current, newTerm );
                continue;
            }

            // No app-pattern match — but if the node is itself an IRCase
            // (a case-constr-app encoding), we still want trailing-error
            // pruning on the original case, so don't `continue` yet.
            if( !( current instanceof IRCase ) )
            {
                stack.unshift( ...current.children() );
                continue;
            }
        }

        // Trailing-error pruning on any IRCase node we encounter.
        if( current instanceof IRCase )
        {
            const conts = current.continuations;
            let lastNonError = conts.length;
            while( lastNonError > 0 && conts[ lastNonError - 1 ] instanceof IRError ) {
                lastNonError--;
            }
            if( lastNonError < conts.length && lastNonError > 0 )
            {
                const pruned = new IRCase(
                    current.constrTerm.clone(),
                    Array.from(
                        { length: lastNonError },
                        ( _, i ) => conts[ i ]!.clone()
                    )
                );
                modifyTermAndPushToReprocess( current, pruned );
                continue;
            }
            stack.unshift( ...current.children() );
            continue;
        }

        stack.unshift( ...current.children() );
    }

    return term;
}
