import { NotEqualExpr } from "../../../../../ast/nodes/expr/binary/BinaryExpr";
import { TirNotEqualExpr } from "../../../../tir/expressions/binary/TirBinaryExpr";
import { TirType } from "../../../../tir/types/TirType";
import { AstCompilationCtx } from "../../../AstCompilationCtx";
import { _compileEqualityOperands } from "./_compileEqualityOperands";

export function _compileNotEqualExpr(
    ctx: AstCompilationCtx,
    expr: NotEqualExpr,
    typeHint: TirType | undefined
): TirNotEqualExpr | undefined
{
    const operands = _compileEqualityOperands( ctx, expr, typeHint );
    if( !operands ) return undefined;
    const [ left, right ] = operands;

    return new TirNotEqualExpr(
        left,
        right,
        // implicit bool type,
        expr.range
    );
}
