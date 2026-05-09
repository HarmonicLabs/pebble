import { TirExpr } from "../../tir/expressions/TirExpr";
import { TirIsExpr } from "../../tir/expressions/TirIsExpr";
import { TirParentesizedExpr } from "../../tir/expressions/TirParentesizedExpr";
import { TirUnaryExclamation } from "../../tir/expressions/unary/TirUnaryExclamation";
import { TirVariableAccessExpr } from "../../tir/expressions/TirVariableAccessExpr";
// NOTE: TirLogicalAndExpr / TirLogicalOrExpr come from TirBinaryExpr.ts which
// pulls in the IR -> UPLC compiler. Importing them here at the top would
// create a require-cycle (this file is loaded by `_compileAssertStmt.ts`
// during ast-compilation, before `compileIRToUPLC` finishes initializing).
// We detect them by constructor name instead.
import { TirDataStructType, TirSoPStructType, TirStructType } from "../../tir/types/TirStructType";
import { getStructType } from "../../tir/types/utils/canAssignTo";

export interface IsNarrowing {
    varName: string;
    /** indexes (in the parent struct's `constructors` array) still possible after the check */
    parentCtorIdxs: number[];
    /** original variable type (before narrowing); the parent struct, used to build the narrowed clone */
    parentStructType: TirStructType;
}

/**
 * Walk a boolean expression and collect flow-sensitive narrowings that
 * can be assumed true when the expression evaluates to `polarity`.
 *
 * Rules:
 *  - `x is C` ⇒ on TRUE: x narrows to {C}; on FALSE: x narrows to "all but C"
 *  - `!cond` ⇒ flip polarity and recurse
 *  - `a && b` ⇒ on TRUE: union of narrowings from a and b; on FALSE: nothing
 *  - `a || b` ⇒ on TRUE: nothing; on FALSE: union of FALSE-narrowings from a and b
 *  - parens are transparent
 *
 * Multiple narrowings on the same variable intersect (most restrictive wins).
 */
export function extractIsNarrowings(
    expr: TirExpr,
    polarity: boolean
): IsNarrowing[]
{
    const acc: IsNarrowing[] = [];
    collect( expr, polarity, acc );
    return mergeIntersect( acc );
}

function collect(
    expr: TirExpr,
    polarity: boolean,
    acc: IsNarrowing[]
): void
{
    if( expr instanceof TirParentesizedExpr )
    {
        collect( expr.expr, polarity, acc );
        return;
    }

    if( expr instanceof TirUnaryExclamation )
    {
        collect( expr.operand, !polarity, acc );
        return;
    }

    const ctorName = (expr as any)?.constructor?.name;

    if( ctorName === "TirLogicalAndExpr" )
    {
        if( polarity )
        {
            collect( (expr as any).left, true, acc );
            collect( (expr as any).right, true, acc );
        }
        // FALSE side of `&&` tells us nothing
        return;
    }

    if( ctorName === "TirLogicalOrExpr" )
    {
        if( !polarity )
        {
            collect( (expr as any).left, false, acc );
            collect( (expr as any).right, false, acc );
        }
        // TRUE side of `||` tells us nothing
        return;
    }

    if( expr instanceof TirIsExpr )
    {
        const inst = expr.instanceExpr;
        if( !( inst instanceof TirVariableAccessExpr ) ) return;

        const parentStructType = getStructType( inst.type );
        if( !parentStructType ) return;

        if( polarity )
        {
            acc.push({
                varName: inst.varName,
                parentCtorIdxs: [ expr.parentCtorIdx ],
                parentStructType
            });
        }
        else
        {
            // narrow to all OTHER parent constructor indexes still possible
            const baseIdxs = parentStructType.narrowedFromParentCtorIdxs
                ?? parentStructType.constructors.map( ( _, i ) => i );
            const remaining = baseIdxs.filter( idx => idx !== expr.parentCtorIdx );
            if( remaining.length === 0 ) return; // narrowed away entirely; type unchanged
            acc.push({
                varName: inst.varName,
                parentCtorIdxs: remaining,
                parentStructType
            });
        }
        return;
    }
}

/**
 * Merge multiple narrowings: per variable, take the intersection of
 * possible parent constructor indexes (most restrictive).
 */
function mergeIntersect( narrowings: IsNarrowing[] ): IsNarrowing[]
{
    const byVar = new Map<string, IsNarrowing>();
    for( const n of narrowings )
    {
        const existing = byVar.get( n.varName );
        if( !existing )
        {
            byVar.set( n.varName, { ...n, parentCtorIdxs: [ ...n.parentCtorIdxs ] });
            continue;
        }
        existing.parentCtorIdxs = existing.parentCtorIdxs.filter(
            idx => n.parentCtorIdxs.includes( idx )
        );
    }
    return [ ...byVar.values() ].filter( n => n.parentCtorIdxs.length > 0 );
}

/**
 * Apply a list of narrowings to the current scope of `ctx`.
 * Builds a narrowed clone of the parent struct and registers it
 * via `scope.narrowVariable`.
 */
import type { AstScope } from "../scope/AstScope";

export function applyNarrowingsToScope(
    scope: AstScope,
    narrowings: IsNarrowing[]
): void
{
    for( const n of narrowings )
    {
        if( !( n.parentStructType instanceof TirDataStructType )
            && !( n.parentStructType instanceof TirSoPStructType )
        ) continue;

        const narrowed = n.parentStructType.narrowTo( n.parentCtorIdxs );
        scope.narrowVariable( n.varName, narrowed );
    }
}
