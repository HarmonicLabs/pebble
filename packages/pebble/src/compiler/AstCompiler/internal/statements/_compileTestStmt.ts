import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { FuncExpr } from "../../../../ast/nodes/expr/functions/FuncExpr";
import { ArrowKind } from "../../../../ast/nodes/expr/functions/ArrowKind";
import { TestStmt } from "../../../../ast/nodes/statements/TestStmt";
import { AstFuncType, AstVoidType } from "../../../../ast/nodes/types/AstNativeTypeExpr";
import { CommonFlags } from "../../../../common";
import { SimpleVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/SimpleVarDecl";
import { PEBBLE_INTERNAL_IDENTIFIER_PREFIX } from "../../../internalVar";
import { TirTestStmt, FuzzerInfo } from "../../../tir/statements/TirTestStmt";
import { TypedProgram } from "../../../tir/program/TypedProgram";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileFuncExpr } from "../exprs/_compileFuncExpr";
import { TirIntT } from "../../../tir/types/TirNativeType/native/int";
import { TirBoolT } from "../../../tir/types/TirNativeType/native/bool";
import { getUnaliased } from "../../../tir/types/utils/getUnaliased";

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

    // Lower each TestParam to a SimpleVarDecl for the synthesized FuncExpr.
    // `viaExpr` is consumed later (fuzzer resolution); the wrapper function
    // itself takes the same params a regular `function name( ... )` would.
    const lowerParams: SimpleVarDecl[] = stmt.params.map( p =>
        new SimpleVarDecl(
            p.name,
            p.type,
            undefined, // initExpr
            CommonFlags.Const,
            p.range
        )
    );

    const sig = new AstFuncType(
        lowerParams,
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

    // Resolve per-parameter fuzzer info. This walks both the source-level
    // `TestParam` array (which carries any `via` expressions) and the
    // resolved TIR param types (taken from the compiled function).
    const fuzzerInfos: FuzzerInfo[] = stmt.params.map( ( astParam, idx ) => {
        // Phase 1: `via` is parsed but execution of user-defined fuzzers
        // is not wired up. Type-checking the expression is also deferred
        // until the stdlib `std.test.fuzz` namespace ships.
        if( astParam.viaExpr )
        {
            return { kind: "via_not_implemented" } as FuzzerInfo;
        }

        const tirParamType = tirFuncExpr.params[idx]?.type;
        if( !tirParamType )
        {
            return {
                kind: "unsupported",
                reason: `parameter '${astParam.name.text}' has no resolved type`
            } as FuzzerInfo;
        }

        const unaliased = getUnaliased( tirParamType );
        if( unaliased instanceof TirIntT )
        return { kind: "primitive", primitive: "int" } as FuzzerInfo;
        if( unaliased instanceof TirBoolT )
        return { kind: "primitive", primitive: "bool" } as FuzzerInfo;

        return {
            kind: "unsupported",
            reason: `parameter '${astParam.name.text}' of type '${tirParamType.toString()}' has no default fuzzer; specify one with 'via <expr>' (note: user-defined fuzzers via 'via' are not yet executable)`
        } as FuzzerInfo;
    });

    program.tests.push(
        new TirTestStmt(
            astName,
            tirFuncName,
            sourceFile,
            stmt.range,
            fuzzerInfos
        )
    );
    return true;
}
