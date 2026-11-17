import { EqualExpr } from "../../../../../ast/nodes/expr/binary/BinaryExpr";
import { TirEqualExpr } from "../../../../tir/expressions/binary/TirBinaryExpr";
import { TirType } from "../../../../tir/types/TirType";
import { AstCompilationCtx } from "../../../AstCompilationCtx";
import { _compileEqualityOperands } from "./_compileEqualityOperands";

export function _compileEqualExpr(
    ctx: AstCompilationCtx,
    expr: EqualExpr,
    typeHint: TirType | undefined
): TirEqualExpr | undefined
{
    const operands = _compileEqualityOperands( ctx, expr, typeHint );
    if( !operands ) return undefined;
    const [ left, right ] = operands;

    return new TirEqualExpr(
        left,
        right,
        // implicit bool type,
        expr.range
    );
}
