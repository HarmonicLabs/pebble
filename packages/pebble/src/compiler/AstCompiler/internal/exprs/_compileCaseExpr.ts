import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { SourceRange } from "../../../../ast/Source/SourceRange";
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
import { canAssignTo, getStructType, joinTypes } from "../../../tir/types/utils/canAssignTo";
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

    // BUG 29: with a type hint present each arm was already checked against
    // it; WITHOUT a hint the whole expression used to silently take arm 0's
    // type and never check the rest. Join the arm types instead, so
    // incompatible arms (e.g. an `int` arm and a `bytes` arm) are rejected.
    let returnType: TirType | undefined;
    if( typeHint )
    {
        returnType = typeHint;
    }
    else
    {
        returnType = joinTypes( cases.map( c => c.body.type ) );
        if( !returnType && cases.length > 0 ) return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            cases[1]?.body.range ?? cases[0].body.range,
            ( cases[1] ?? cases[0] ).body.type.toString(),
            cases[0].body.type.toString()
        );
    }
    if( !returnType ) return ctx.error(
        DiagnosticCode.Cannot_infer_return_type_Try_to_make_the_type_explicit,
        expr.range
    );

    // BUG 28: a `case` EXPRESSION with no wildcard must cover every
    // constructor of the scrutinee, exactly as the `match` STATEMENT already
    // requires (see `_compileMatchStmt`). Without this an uncovered variant
    // compiles clean and traps on chain ("constructor tag N out of range").
    if( !expr.wildcardCase )
    {
        const allCtorNames = _scrutineeCtorNames( matchExpr.type );
        if( allCtorNames )
        {
            const covered = new Set( cases.map( c => c.pattern.constrName ) );
            const missing = allCtorNames.filter( n => !covered.has( n ) );
            if( missing.length > 0 ) return ctx.error(
                DiagnosticCode.Match_cases_are_not_exhaustive,
                expr.range
            );
        }
    }

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

    // Nested deconstruct patterns (`when W{ i: A{ x } }`) now PARSE, but the
    // arm-body codegen does not bind the inner variables (it would crash with
    // "variable not found"). Emit one clear diagnostic pointing at the
    // supported workaround instead (audit BUG 33): destructure the field,
    // then `case`/`match` on it.
    const nestedRange = _nestedPatternRange( matcher.pattern );
    if( nestedRange ) return ctx.error(
        DiagnosticCode.Not_implemented_0,
        nestedRange,
        "nested patterns are not supported yet; bind the field (e.g. `W{ i }`) "
        + "then `case`/`match` on it"
    );

    // each arm gets its own child scope so that the pattern binders are
    // scoped to the arm and do NOT leak into the enclosing block (which would
    // make two mutually-exclusive arms reusing a binder name collide as
    // "duplicate identifier").
    const armCtx = ctx.newBranchChildScope();

    const pattern = _compileVarDecl( armCtx, matcher.pattern, patternType );
    if( !pattern ) return undefined;

    if( pattern instanceof TirSimpleVarDecl ) return ctx.error(
        DiagnosticCode._case_expression_must_decontructed_the_inspected_value,
        matcher.pattern.range
    );

    if( !canAssignTo( pattern.type, patternType ) ) return ctx.error(
        DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        matcher.pattern.range, pattern.type.toString(), patternType.toString()
    );

    let bodyCtx = armCtx;
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
                bodyCtx = armCtx.newBranchChildScope();
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

/**
 * Range of the first NESTED deconstruct field in a `case`/`match` arm
 * pattern (a field whose binding is itself a `{...}` pattern), or
 * `undefined` if the pattern only binds plain names. Nested patterns parse
 * but are not yet supported by arm-body codegen (audit BUG 33).
 */
export function _nestedPatternRange( pattern: unknown ): SourceRange | undefined
{
    if(!( pattern instanceof AstNamedDeconstructVarDecl )) return undefined;
    for( const [ , varDecl ] of pattern.fields )
    {
        if(!( varDecl instanceof AstSimpleVarDecl )) return varDecl.range;
    }
    return undefined;
}

/**
 * Constructor (or enum-member) names of a `case` scrutinee, for the
 * exhaustiveness check. `undefined` when the type is not a
 * struct/enum/optional — arm compilation already errors on those.
 */
function _scrutineeCtorNames( type: TirType ): string[] | undefined
{
    const structT = getStructType( type );
    if( structT ) return structT.constructors.map( c => c.name );
    const enumT = getEnumType( type );
    if( enumT ) return enumT.members.slice();
    return undefined;
}