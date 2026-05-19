import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { ParentesizedExpr } from "../../../../ast/nodes/expr/ParentesizedExpr";
import { PebbleExpr } from "../../../../ast/nodes/expr/PebbleExpr";
import { CaseExpr, CaseExprMatcher, CaseWildcardMatcher } from "../../../../ast/nodes/expr/CaseExpr";
import { NamedDeconstructVarDecl as AstNamedDeconstructVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/NamedDeconstructVarDecl";
import { SimpleVarDecl as AstSimpleVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/SimpleVarDecl";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirCaseExpr, TirCaseMatcher, TirWildcardCaseMatcher } from "../../../tir/expressions/TirCaseExpr";
import { TirNamedDeconstructVarDecl } from "../../../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSimpleVarDecl } from "../../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirDataStructType, TirSoPStructType } from "../../../tir/types/TirStructType";
import { TirEnumType, getEnumType } from "../../../tir/types/TirEnumType";
import { TirType } from "../../../tir/types/TirType";
import { canAssignTo, getStructType } from "../../../tir/types/utils/canAssignTo";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileVarDecl } from "../statements/_compileVarStmt";
import { _compileExpr } from "./_compileExpr";

export function _compileCaseExpr(
    ctx: AstCompilationCtx,
    expr: CaseExpr,
    typeHint: TirType | undefined
): TirCaseExpr | undefined
{
    const matchExpr = _compileExpr( ctx, expr.matchExpr, typeHint );
    if( !matchExpr ) return undefined;

    // if the matched expression is a plain variable, we can narrow its
    // type inside each arm body to the matched constructor.
    const matchedVarName = unwrapToIdentifierName( expr.matchExpr );

    const cases = expr.cases.map( branch =>
        _compileCaseExprMatcher(
            ctx,
            branch,
            matchExpr.type,
            typeHint,
            matchedVarName
        )
    ) as TirCaseMatcher[]; // we early return in case of undefined so this is safe
    if( cases.some( c => !c ) ) return undefined;

    const returnType = cases[0]?.body.type ?? typeHint;
    if( !returnType ) return ctx.error(
        DiagnosticCode.Cannot_infer_return_type_Try_to_make_the_type_explicit,
        expr.range
    );

    if( !expr.wildcardCase )
    return new TirCaseExpr(
        matchExpr,
        cases,
        undefined,
        returnType,
        expr.range
    );

    const wildcardCase = _compileCaseWildcardMatcher(
        ctx,
        expr.wildcardCase,
        returnType
    );
    if( !wildcardCase ) return undefined;

    return new TirCaseExpr(
        matchExpr,
        cases,
        wildcardCase,
        returnType,
        expr.range
    );
}

export function _compileCaseExprMatcher(
    ctx: AstCompilationCtx,
    matcher: CaseExprMatcher,
    patternType: TirType,
    returnTypeHint: TirType | undefined,
    matchedVarName?: string
): TirCaseMatcher | undefined
{
    const enumType = getEnumType( patternType );
    if( enumType )
    {
        const astPattern = matcher.pattern;
        let memberName: string | undefined;
        let patternRange = astPattern.range;
        let ctorNameRange = astPattern.range;

        if( astPattern instanceof AstSimpleVarDecl )
        {
            memberName = astPattern.name.text;
            patternRange = astPattern.name.range;
            ctorNameRange = astPattern.name.range;
        }
        else if( astPattern instanceof AstNamedDeconstructVarDecl )
        {
            if( astPattern.fields.size > 0 || astPattern.rest ) return ctx.error(
                DiagnosticCode.Enum_member_pattern_cannot_have_fields,
                astPattern.range
            );
            memberName = astPattern.name.text;
            ctorNameRange = astPattern.name.range;
        }
        else return ctx.error(
            DiagnosticCode._case_expression_must_decontructed_the_inspected_value,
            astPattern.range
        );

        if( enumType.indexOf( memberName ) < 0 ) return ctx.error(
            DiagnosticCode.Constructor_0_is_not_part_of_the_definition_of_1,
            ctorNameRange, memberName, enumType.toString()
        );

        const body = _compileExpr( ctx, matcher.body, returnTypeHint );
        if( !body ) return undefined;
        if( returnTypeHint && !canAssignTo( body.type, returnTypeHint ) ) return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            matcher.body.range, body.type.toString(), returnTypeHint.toString()
        );

        return new TirCaseMatcher(
            new TirNamedDeconstructVarDecl(
                memberName,
                new Map(),
                undefined,
                enumType,
                undefined,
                true,
                patternRange,
                ctorNameRange
            ),
            body,
            matcher.range
        );
    }

    const pattern = _compileVarDecl( ctx, matcher.pattern, patternType );
    if( !pattern ) return undefined;

    if( pattern instanceof TirSimpleVarDecl ) return ctx.error(
        DiagnosticCode._case_expression_must_decontructed_the_inspected_value,
        matcher.pattern.range
    );

    if( !canAssignTo( pattern.type, patternType ) ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        matcher.pattern.range, pattern.type.toString(), patternType.toString()
    );

    let bodyCtx = ctx;
    if( matchedVarName && pattern instanceof TirNamedDeconstructVarDecl )
    {
        const parentStruct = getStructType( patternType );
        if( parentStruct )
        {
            const localIdx = parentStruct.constructors.findIndex(
                c => c.name === pattern.constrName
            );
            if( localIdx >= 0 )
            {
                const parentIdx = parentStruct.parentCtorIdx( localIdx );
                bodyCtx = ctx.newBranchChildScope();
                if( parentStruct instanceof TirDataStructType
                    || parentStruct instanceof TirSoPStructType
                )
                {
                    bodyCtx.scope.narrowVariable(
                        matchedVarName,
                        parentStruct.narrowTo( [ parentIdx ] )
                    );
                }
            }
        }
    }

    const body = _compileExpr( bodyCtx, matcher.body, returnTypeHint );
    if( !body ) return undefined;
    if( returnTypeHint && !canAssignTo( body.type, returnTypeHint ) ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        matcher.body.range, body.type.toString(), returnTypeHint.toString()
    );

    if(!(
        pattern instanceof TirNamedDeconstructVarDecl
    )) return ctx.error(
        DiagnosticCode._case_expression_must_decontructed_the_inspected_value,
        matcher.pattern.range
    );

    return new TirCaseMatcher(
        pattern,
        body,
        matcher.range
    );
}

function _compileCaseWildcardMatcher(
    ctx: AstCompilationCtx,
    wildcardCase: CaseWildcardMatcher,
    returnTypeHint: TirType | undefined
): TirWildcardCaseMatcher | undefined
{
    const bodyExpr = _compileExpr( ctx, wildcardCase.body, returnTypeHint );
    if( !bodyExpr ) return undefined;

    return new TirWildcardCaseMatcher(
        bodyExpr,
        wildcardCase.range
    );
}

function unwrapToIdentifierName( expr: PebbleExpr ): string | undefined
{
    while( expr instanceof ParentesizedExpr ) expr = expr.expr;
    return expr instanceof Identifier ? expr.text : undefined;
}