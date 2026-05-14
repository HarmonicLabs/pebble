import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { FuncExpr } from "../../../../ast/nodes/expr/functions/FuncExpr";
import { ArrowKind } from "../../../../ast/nodes/expr/functions/ArrowKind";
import { TestStmt } from "../../../../ast/nodes/statements/TestStmt";
import { AstFuncType, AstVoidType } from "../../../../ast/nodes/types/AstNativeTypeExpr";
import { CommonFlags } from "../../../../common";
import { PEBBLE_INTERNAL_IDENTIFIER_PREFIX } from "../../../internalVar";
import { TirTestStmt } from "../../../tir/statements/TirTestStmt";
import { TypedProgram } from "../../../tir/program/TypedProgram";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileFuncExpr } from "../exprs/_compileFuncExpr";

/**
 * Compiles a `test name( params? ) { body }` declaration.
 *
 * Synthesises a `function <tirFuncName>( params ): void { body }` and
 * runs it through `_compileFuncExpr` so type-checking, scoping and
 * later TIR-to-UPLC compilation work exactly like a user-defined function.
 *
 * Registers the resulting `TirFuncExpr` in `program.functions` and pushes
 * a `TirTestStmt` referencing it onto `program.tests`.
 *
 * @returns `true` on success (test registered), `false` on failure (diagnostic emitted).
 */
export function _compileTestStmt(
    ctx: AstCompilationCtx,
    stmt: TestStmt,
    srcUid: string,
    sourceFile: string,
): boolean
{
    const program: TypedProgram = ctx.program;
    const astName = stmt.testName.text;
    const tirFuncName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "test_" + astName + "_" + srcUid;

    const sig = new AstFuncType(
        stmt.params,
        new AstVoidType( stmt.testName.range ),
        stmt.range
    );

    const astFuncExpr = new FuncExpr(
        new Identifier( tirFuncName, stmt.testName.range ),
        CommonFlags.None,
        [], // typeParams
        sig,
        stmt.body,
        ArrowKind.None,
        stmt.range
    );

    const tirFuncExpr = _compileFuncExpr(
        ctx,
        astFuncExpr,
        undefined, // expectedFuncType
        false // isMethod
    );
    if( !tirFuncExpr ) return false;

    program.functions.set( tirFuncName, tirFuncExpr );

    program.tests.push(
        new TirTestStmt(
            astName,
            tirFuncName,
            sourceFile,
            stmt.range
        )
    );
    return true;
}
