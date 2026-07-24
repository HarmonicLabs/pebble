import { AssignmentStmt, isExplicitAssignmentStmt, ExplicitAssignmentStmt, SimpleAssignmentStmt, AddAssignmentStmt, SubAssignmentStmt, ExpAssignmentStmt, MultAssignmentStmt, DivAssignmentStmt, ModuloAssignmentStmt, ShiftLeftAssignmentStmt, ShiftRightAssignmentStmt, BitwiseAndAssignmentStmt, BitwiseXorAssignmentStmt, BitwiseOrAssignmentStmt, LogicalAndAssignmentStmt, LogicalOrAssignmentStmt } from "../../../../ast/nodes/statements/AssignmentStmt";
import { DecrStmt } from "../../../../ast/nodes/statements/DecrStmt";
import { IncrStmt } from "../../../../ast/nodes/statements/IncrStmt";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirAddExpr, TirSubExpr, TirExponentiationExpr, TirMultExpr, TirDivExpr, TirModuloExpr, TirShiftLeftExpr, TirShiftRightExpr, TirBitwiseAndExpr, TirBitwiseXorExpr, TirBitwiseOrExpr, TirLogicalAndExpr, TirLogicalOrExpr } from "../../../tir/expressions/binary/TirBinaryExpr";
import { TirLitIntExpr } from "../../../tir/expressions/litteral/TirLitIntExpr";
import { TirExpr } from "../../../tir/expressions/TirExpr";
import { TirVariableAccessExpr } from "../../../tir/expressions/TirVariableAccessExpr";
import { TirAssignmentStmt } from "../../../tir/statements/TirAssignmentStmt";
import { TirType } from "../../../tir/types/TirType";
import { canAssignTo } from "../../../tir/types/utils/canAssignTo";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileExpr } from "../exprs/_compileExpr";

export function _compileAssignmentStmt(
    ctx: AstCompilationCtx,
    stmt: AssignmentStmt
): [ TirAssignmentStmt ] | undefined
{
    const int_t = ctx.program.stdTypes.int;
    
    if(
        stmt instanceof IncrStmt
        || stmt instanceof DecrStmt
    )
    {
        const resolvedValue = ctx.scope.resolveValue( stmt.varIdentifier.text );
        if( !resolvedValue ) return ctx.error(
            DiagnosticCode._0_is_not_defined,
            stmt.varIdentifier.range, stmt.varIdentifier.text
        );
        const { variableInfos, isDefinedOutsideFuncScope } =  resolvedValue;
        if( resolvedValue.crossesFunctionBoundary ) return ctx.error(
            DiagnosticCode.Lambdas_can_only_capture_const_bindings_0_is_a_mutable_let_Copy_it_into_a_const_before_the_lambda,
            stmt.varIdentifier.range, stmt.varIdentifier.text
        );
        const varType = variableInfos.type;
        if( !canAssignTo( varType, int_t ) ) return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            stmt.varIdentifier.range, varType.toString(), int_t.toString()
        );
        const varAccessExpr = new TirVariableAccessExpr(
            resolvedValue,
            stmt.varIdentifier.range,
        );
        return ([ new TirAssignmentStmt(
            varAccessExpr.clone() as TirVariableAccessExpr,
            stmt instanceof IncrStmt ?
                new TirAddExpr(
                    varAccessExpr.clone(),
                    new TirLitIntExpr( BigInt( 1 ), stmt.range ),
                    stmt.range
                ) :
                new TirSubExpr(
                    varAccessExpr.clone(),
                    new TirLitIntExpr( BigInt( 1 ), stmt.range ),
                    stmt.range
                ),
            stmt.range
        ) ]);
    }
    if( isExplicitAssignmentStmt( stmt ) )
    {
        const tirStmt = _compileExplicitAssignmentStmt( ctx, stmt );
        if( !tirStmt ) return undefined;
        return [ tirStmt ];
    }
    else
    {
        // const tsEnsureExhautstiveCheck: never = stmt;
        console.error( stmt );
        throw new Error("unreachable::AstCompiler::_compileForUpdateStmts");
    }
}
export function _compileExplicitAssignmentStmt(
    ctx: AstCompilationCtx,
    stmt: ExplicitAssignmentStmt
): TirAssignmentStmt | undefined
{
    const int_t = ctx.program.stdTypes.int;
    const bytes_t = ctx.program.stdTypes.bytes;
    const bool_t = ctx.program.stdTypes.bool;

    const scope = ctx.scope;
    const resovleResult = scope.resolveValue( stmt.varIdentifier.text );
    if( !resovleResult ) return ctx.error(
        DiagnosticCode._0_is_not_defined,
        stmt.range, stmt.varIdentifier.text
    );
    const { variableInfos, isDefinedOutsideFuncScope } = resovleResult;
    if( variableInfos.isConstant ) return ctx.error(
        DiagnosticCode.Cannot_assign_to_0_because_it_is_a_constant,
        stmt.varIdentifier.range, stmt.varIdentifier.text
    );
    // a closure cannot write to a variable of an enclosing function
    if( resovleResult.crossesFunctionBoundary ) return ctx.error(
        DiagnosticCode.Lambdas_can_only_capture_const_bindings_0_is_a_mutable_let_Copy_it_into_a_const_before_the_lambda,
        stmt.varIdentifier.range, stmt.varIdentifier.text
    );
    const varType = variableInfos.type;
    
    const varAccessExpr = new TirVariableAccessExpr(
        resovleResult,
        stmt.varIdentifier.range
    );

    let expr: TirExpr | undefined = undefined;
    if( stmt instanceof SimpleAssignmentStmt )
    {
        expr = _compileExpr( ctx, stmt.assignedExpr, varType );
        if( !expr ) return undefined;
        if( !canAssignTo( expr.type, varType ) ) return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            stmt.range, expr.type.toString(), varType.toString()
        );
    }
    else if( stmt instanceof AddAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, int_t );
        if( !expr ) return undefined;
        expr = new TirAddExpr(
            varAccessExpr.clone(),
            expr.clone(),
            stmt.range
        );
    }
    else if( stmt instanceof SubAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, int_t );
        if( !expr ) return undefined;
        expr = new TirSubExpr(
            varAccessExpr.clone(),
            expr.clone(),
            stmt.range
        );
    }
    else if( stmt instanceof ExpAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, int_t );
        if( !expr ) return undefined;
        expr = new TirExponentiationExpr(
            varAccessExpr,
            expr,
            stmt.range
        );
    }
    else if( stmt instanceof MultAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, int_t );
        if( !expr ) return undefined;
        expr = new TirMultExpr(
            varAccessExpr,
            expr,
            stmt.range
        );
    }
    else if( stmt instanceof DivAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, int_t );
        if( !expr ) return undefined;
        expr = new TirDivExpr(
            varAccessExpr,
            expr,
            stmt.range
        );
    }
    else if( stmt instanceof ModuloAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, int_t );
        if( !expr ) return undefined;
        expr = new TirModuloExpr(
            varAccessExpr,
            expr,
            stmt.range
        );
    }
    else if( stmt instanceof ShiftLeftAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, bytes_t );
        if( !expr ) return undefined;
        expr = new TirShiftLeftExpr(
            varAccessExpr,
            expr,
            stmt.range
        );
    }
    else if( stmt instanceof ShiftRightAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, bytes_t );
        if( !expr ) return undefined;
        expr = new TirShiftRightExpr(
            varAccessExpr,
            expr,
            stmt.range
        );
    }
    else if( stmt instanceof BitwiseAndAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, bytes_t );
        if( !expr ) return undefined;
        expr = new TirBitwiseAndExpr(
            varAccessExpr,
            expr,
            stmt.range
        );
    }
    else if( stmt instanceof BitwiseXorAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, bytes_t );
        if( !expr ) return undefined;
        expr = new TirBitwiseXorExpr(
            varAccessExpr,
            expr,
            stmt.range
        );
    }
    else if( stmt instanceof BitwiseOrAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, bytes_t );
        if( !expr ) return undefined;
        expr = new TirBitwiseOrExpr(
            varAccessExpr,
            expr,
            stmt.range
        );
    }
    else if( stmt instanceof LogicalAndAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, bool_t );
        if( !expr ) return undefined;
        expr = new TirLogicalAndExpr(
            varAccessExpr,
            expr,
            stmt.range
        );
    }
    else if( stmt instanceof LogicalOrAssignmentStmt )
    {
        expr = __getBinOpAssignmentLeftArg( ctx, stmt, varType, bool_t );
        if( !expr ) return undefined;
        expr = new TirLogicalOrExpr(
            varAccessExpr,
            expr,
            stmt.range
        );
    }
    else {
        const tsEnsureExhautstiveCheck: never = stmt;
        console.error( stmt );
        throw new Error("unreachable::AstCompiler::_compileExplicitAssignmentStmt");
    }

    return new TirAssignmentStmt(
        varAccessExpr.clone() as TirVariableAccessExpr,
        expr,
        stmt.range
    );
}
export function __getBinOpAssignmentLeftArg(
    ctx: AstCompilationCtx,
    stmt: ExplicitAssignmentStmt,
    varType: TirType,
    exprType: TirType
): TirExpr | undefined
{
    if( !canAssignTo( varType, exprType ) ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        stmt.varIdentifier.range, varType.toString(), exprType.toString()
    );
    const expr = _compileExpr( ctx, stmt.assignedExpr, exprType );
    if( !expr ) return undefined;
    if( !canAssignTo( expr.type, exprType ) ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        stmt.range, expr.type.toString(), exprType.toString()
    );
    return expr;
}