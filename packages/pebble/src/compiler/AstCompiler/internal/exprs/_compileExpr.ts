import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { isBinaryExpr } from "../../../../ast/nodes/expr/binary/BinaryExpr";
import { CaseExpr } from "../../../../ast/nodes/expr/CaseExpr";
import { ElemAccessExpr } from "../../../../ast/nodes/expr/ElemAccessExpr";
import { CallExpr } from "../../../../ast/nodes/expr/functions/CallExpr";
import { FuncExpr } from "../../../../ast/nodes/expr/functions/FuncExpr";
import { IsExpr } from "../../../../ast/nodes/expr/IsExpr";
import { isLitteralExpr } from "../../../../ast/nodes/expr/litteral/LitteralExpr";
import { ParentesizedExpr } from "../../../../ast/nodes/expr/ParentesizedExpr";
import { PebbleExpr } from "../../../../ast/nodes/expr/PebbleExpr";
import { isPropAccessExpr } from "../../../../ast/nodes/expr/PropAccessExpr";
import { TernaryExpr } from "../../../../ast/nodes/expr/TernaryExpr";
import { TypeConversionExpr } from "../../../../ast/nodes/expr/TypeConversionExpr";
import { NonNullExpr } from "../../../../ast/nodes/expr/unary/NonNullExpr";
import { isUnaryPrefixExpr } from "../../../../ast/nodes/expr/unary/UnaryPrefixExpr";
import { isTirExpr, TirExpr } from "../../../tir/expressions/TirExpr";
import { TirType } from "../../../tir/types/TirType";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileBinaryExpr } from "./_compileBinaryExpr";
import { _compileCallExpr } from "./_compileCallExpr";
import { _compileCaseExpr } from "./_compileCaseExpr";
import { _compileElemAccessExpr } from "./_compileElemAccessExpr";
import { _compileFuncExpr } from "./_compileFuncExpr";
import { _compileIsExpr } from "./_compileIsExpr";
import { _compileLitteralExpr } from "./_compileLitteralExpr";
import { _compileNonNullExpr } from "./_compileNonNullExpr";
import { _compilePropAccessExpr } from "./_compilePropAccessExpr";
import { _compileTernaryExpr } from "./_compileTernaryExpr";
import { _compileTypeConversionExpr } from "./_compileTypeConversionExpr";
import { _compileUnaryPrefixExpr } from "./_compileUnaryPrefixExpr";
import { _compileVarAccessExpr } from "./_compileVarAccessExpr";

/**
 * here we just translate to TIR
 * 
 * WE DO NOT OPTIMIZE
 * 
 * optimizaitons are part of the TIR -> TermIR compilation
**/
export function _compileExpr(
    ctx: AstCompilationCtx,
    expr: PebbleExpr,
    /**
     * this is just a type **hint**
     * it is only used as last resource to
     * disambiguate the type of an expression.
     * 
     * it is **NOT guaranteed** that the returned expression will be assignable to this type
     * 
     * if that is the case, it needs to be checked OUTSIDE this function
    **/
    typeHint: TirType | undefined
): TirExpr | undefined
{
    // already compiled (TODO: how did we get here?)
    if( isTirExpr( expr ) ) return expr;

    if( expr instanceof Identifier ) return _compileVarAccessExpr( ctx, expr, typeHint );
    if( isUnaryPrefixExpr( expr ) ) return _compileUnaryPrefixExpr( ctx, expr, typeHint );
    if( expr instanceof NonNullExpr ) return _compileNonNullExpr( ctx, expr, typeHint );
    if( expr instanceof ParentesizedExpr ) return _compileExpr( ctx, expr.expr, typeHint );
    if( expr instanceof FuncExpr ) return _compileFuncExpr( ctx, expr, typeHint );
    if( expr instanceof CallExpr ) return _compileCallExpr( ctx, expr, typeHint );
    if( expr instanceof CaseExpr ) return _compileCaseExpr( ctx, expr, typeHint );
    if( expr instanceof TypeConversionExpr ) return _compileTypeConversionExpr( ctx, expr, typeHint );
    if( expr instanceof NonNullExpr ) return _compileNonNullExpr( ctx, expr, typeHint );
    if( expr instanceof IsExpr ) return _compileIsExpr( ctx, expr, typeHint );
    if( expr instanceof ElemAccessExpr ) return _compileElemAccessExpr( ctx, expr, typeHint );
    if( expr instanceof TernaryExpr ) return _compileTernaryExpr( ctx, expr, typeHint );
    if( isPropAccessExpr( expr ) ) return _compilePropAccessExpr( ctx, expr, typeHint );
    if( isBinaryExpr( expr ) ) return _compileBinaryExpr( ctx, expr, typeHint );
    //*/

    if(
        isLitteralExpr( expr )
    ) return _compileLitteralExpr( ctx, expr, typeHint );

    const tsEnsureExhautstiveCheck: never = expr;
    console.error( expr );
    throw new Error("unreachable::AstCompiler::_compileExpr");
}