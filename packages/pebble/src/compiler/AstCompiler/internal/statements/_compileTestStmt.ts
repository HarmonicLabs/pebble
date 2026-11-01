import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { FuncExpr } from "../../../../ast/nodes/expr/functions/FuncExpr";
import { ArrowKind } from "../../../../ast/nodes/expr/functions/ArrowKind";
import { CallExpr } from "../../../../ast/nodes/expr/functions/CallExpr";
import { PebbleExpr } from "../../../../ast/nodes/expr/PebbleExpr";
import { TestStmt } from "../../../../ast/nodes/statements/TestStmt";
import { TestParam } from "../../../../ast/nodes/statements/TestParam";
import { BlockStmt } from "../../../../ast/nodes/statements/BlockStmt";
import { ReturnStmt } from "../../../../ast/nodes/statements/ReturnStmt";
import { AstFuncType, AstIntType, AstVoidType } from "../../../../ast/nodes/types/AstNativeTypeExpr";
import { CommonFlags } from "../../../../common";
import { SimpleVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/SimpleVarDecl";
import { PEBBLE_INTERNAL_IDENTIFIER_PREFIX } from "../../../internalVar";
import { TirTestStmt, FuzzerInfo } from "../../../tir/statements/TirTestStmt";
import { TypedProgram } from "../../../tir/program/TypedProgram";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileExpr } from "../exprs/_compileExpr";
import { _compileFuncExpr } from "../exprs/_compileFuncExpr";
import { TirFuncExpr } from "../../../tir/expressions/TirFuncExpr";
import { TirFuncT } from "../../../tir/types/TirNativeType/native/function";
import { int_t } from "../../../tir/program/stdScope/stdScope";
import { TirType } from "../../../tir/types/TirType";
import { canAssignTo } from "../../../tir/types/utils/canAssignTo";
import { getUnaliased } from "../../../tir/types/utils/getUnaliased";
import { defaultFuzzerUnsupportedReason, viaResultUnsupportedReason } from "../../../test/fuzz/typedFuzzers";

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
        const tirParamType = tirFuncExpr.params[idx]?.type;
        if( !tirParamType )
        {
            return {
                kind: "unsupported",
                reason: `parameter '${astParam.name.text}' has no resolved type`
            } as FuzzerInfo;
        }

        if( astParam.viaExpr )
        {
            return _compileViaFuzzer(
                ctx, astParam, idx, tirParamType,
                astName, srcUid
            );
        }

        const reason = defaultFuzzerUnsupportedReason( tirParamType );
        if( reason === undefined )
        return { kind: "typed", type: tirParamType } as FuzzerInfo;

        return {
            kind: "unsupported",
            reason: `parameter '${astParam.name.text}': ${reason}; specify one with 'via <expr>'`
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

/**
 * Compiles a `via <expr>` fuzzer into a Pebble-side entry point
 * `function <fuzzName>( seed: int ): <paramType> { ... }` registered in
 * `program.functions`, so the test runner can compile and CEK-evaluate it
 * with a fresh seed each iteration.
 *
 * Accepted `via` expression shapes:
 * - a function `( seed: int ) => T` — called with the iteration seed;
 * - a plain value of type `T` — a degenerate constant fuzzer
 *   (every iteration receives the same value), e.g. `via 0`.
 */
function _compileViaFuzzer(
    ctx: AstCompilationCtx,
    astParam: TestParam,
    paramIdx: number,
    tirParamType: TirType,
    testName: string,
    srcUid: string,
): FuzzerInfo
{
    const program: TypedProgram = ctx.program;
    const viaExpr = astParam.viaExpr!;

    const resultReason = viaResultUnsupportedReason( tirParamType );
    if( resultReason !== undefined )
    {
        return {
            kind: "unsupported",
            reason: `parameter '${astParam.name.text}': ${resultReason}`
        };
    }

    // Type-probe: compile the via expression once to learn its type, then
    // synthesize the wrapper AST accordingly. The probe result is discarded
    // (the wrapper re-compiles the same AST in the wrapper scope).
    const probe = _compileExpr( ctx, viaExpr, undefined );
    if( !probe )
    {
        // _compileExpr already emitted the located diagnostic
        return {
            kind: "unsupported",
            reason: `parameter '${astParam.name.text}': the 'via' expression failed to compile`
        };
    }

    const probeType = getUnaliased( probe.type ) ?? probe.type;
    let isCallForm: boolean;
    if(
        probeType instanceof TirFuncT
        && probeType.argTypes.length === 1
        && canAssignTo( int_t, probeType.argTypes[0] )
        && canAssignTo( probeType.returnType, tirParamType )
    ) isCallForm = true;
    else if( canAssignTo( probe.type, tirParamType ) ) isCallForm = false;
    else
    {
        return {
            kind: "unsupported",
            reason: (
                `parameter '${astParam.name.text}': the 'via' expression has type ` +
                `'${probe.type.toString()}'; expected '( seed: int ) => ` +
                `${tirParamType.toString()}' or a plain '${tirParamType.toString()}' value`
            )
        };
    }

    const fuzzFuncName =
        PEBBLE_INTERNAL_IDENTIFIER_PREFIX
        + "test_fuzz_" + testName + "_" + paramIdx.toString() + "_" + srcUid;
    const seedName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "seed";
    const range = viaExpr.range;

    const seedParam = new SimpleVarDecl(
        new Identifier( seedName, range ),
        new AstIntType( range ),
        undefined, // initExpr
        CommonFlags.Const,
        range
    );

    const bodyExpr: PebbleExpr = isCallForm
        ? new CallExpr(
            viaExpr,
            undefined, // genericTypeArgs
            [ new Identifier( seedName, range ) ],
            range
        )
        : viaExpr;

    const fuzzAstFuncExpr = new FuncExpr(
        new Identifier( fuzzFuncName, range ),
        CommonFlags.None,
        [], // typeParams
        new AstFuncType( [ seedParam ], astParam.type, range ),
        new BlockStmt( [ new ReturnStmt( bodyExpr, range ) ], range ),
        ArrowKind.None,
        range
    );

    const fuzzTirFuncExpr = _compileFuncExpr(
        ctx,
        fuzzAstFuncExpr,
        undefined, // expectedFuncType
        false // isMethod
    );
    if( !fuzzTirFuncExpr || !( fuzzTirFuncExpr instanceof TirFuncExpr ) )
    {
        return {
            kind: "unsupported",
            reason: `parameter '${astParam.name.text}': the synthesized 'via' fuzzer failed to compile`
        };
    }

    program.functions.set( fuzzFuncName, fuzzTirFuncExpr );

    return { kind: "via", tirFuncName: fuzzFuncName };
}
