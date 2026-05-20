/**
 * `case L of cons h t -> body | nil -> ...` already binds the list's head
 * and tail to `h` and `t` in the cons branch. If `body` then re-extracts
 * them via `headList(L)` / `tailList(L)`, those calls are redundant — the
 * values are already in scope. This pass walks every `IRCase` whose
 * scrutinee is a plain `IRVar(L)` and substitutes those head/tail calls
 * inside the cons branch with `IRVar(h)` / `IRVar(t)`.
 *
 * Concretely, this turns
 *
 *     case body_xs of
 *       cons body_xs_head body_xs_tail ->
 *         ... headList(body_xs) ... tailList(body_xs) ...
 *
 * into
 *
 *     case body_xs of
 *       cons body_xs_head body_xs_tail ->
 *         ... body_xs_head ... body_xs_tail ...
 *
 * which (combined with `removeUnusedVarsAndReturnRoot`) drops the
 * `(force headList) body_xs` / `(force tailList) body_xs` builtin
 * applications entirely when the originally-bound `h`/`t` were unused.
 *
 * Substitution stops at any nested `IRFunc`/`IRRecursive` whose params
 * shadow `L`, `h`, or `t` — those re-bindings would otherwise let us
 * silently substitute a stale outer scope.
 */

import { IRApp } from "../../IRNodes/IRApp";
import { IRCase } from "../../IRNodes/IRCase";
import { IRFunc } from "../../IRNodes/IRFunc";
import { IRHoisted } from "../../IRNodes/IRHoisted";
import { IRLetted } from "../../IRNodes/IRLetted";
import { IRNative } from "../../IRNodes/IRNative";
import { IRNativeTag } from "../../IRNodes/IRNative/IRNativeTag";
import { IRRecursive } from "../../IRNodes/IRRecursive";
import { IRTerm } from "../../IRTerm";
import { IRVar } from "../../IRNodes/IRVar";
import { _modifyChildFromTo } from "../_internal/_modifyChildFromTo";

function unwrap( t: IRTerm ): IRTerm
{
    while( t instanceof IRHoisted ) t = (t as IRHoisted).hoisted;
    while( t instanceof IRLetted ) t = (t as IRLetted).value;
    return t;
}

export function rewriteHeadTailInCaseConsAndReturnRoot( term: IRTerm ): IRTerm
{
    const stack: IRTerm[] = [ term ];
    while( stack.length > 0 )
    {
        const t = stack.pop()!;

        if( t instanceof IRCase )
        {
            const scrutinee = t.constrTerm;
            const consBranch = t.continuations[0];
            if(
                scrutinee instanceof IRVar
                && consBranch instanceof IRFunc
                && consBranch.params.length === 2
            ) {
                const listSym = scrutinee.name;
                const [ hSym, tSym ] = consBranch.params;
                substituteHeadTailInBody( consBranch.body, listSym, hSym, tSym );
            }
        }

        stack.push( ...t.children() );
    }
    return term;
}

function substituteHeadTailInBody(
    root: IRTerm,
    listSym: symbol,
    hSym: symbol,
    tSym: symbol,
): void
{
    const stack: IRTerm[] = [ root ];
    while( stack.length > 0 )
    {
        const t = stack.pop()!;

        // Stop at a fresh binding that would shadow any of the symbols
        // we're substituting for (extremely rare but cheap to guard).
        if( t instanceof IRFunc || t instanceof IRRecursive )
        {
            const params = t instanceof IRFunc ? t.params : [ (t as IRRecursive).name ];
            if(
                params.includes( listSym )
                || params.includes( hSym )
                || params.includes( tSym )
            ) continue;
        }

        if( t instanceof IRApp )
        {
            const fn = unwrap( t.fn );
            const arg = t.arg;
            if(
                fn instanceof IRNative
                && ( fn.tag === IRNativeTag.headList || fn.tag === IRNativeTag.tailList )
                && arg instanceof IRVar
                && arg.name === listSym
            ) {
                const newSym = fn.tag === IRNativeTag.headList ? hSym : tSym;
                const parent = t.parent;
                if( parent !== undefined ) {
                    _modifyChildFromTo( parent, t, new IRVar( newSym ) );
                }
                continue;
            }
        }

        stack.push( ...t.children() );
    }
}
