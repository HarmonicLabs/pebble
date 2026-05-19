import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { ParentesizedExpr } from "../../../../ast/nodes/expr/ParentesizedExpr";
import { PebbleExpr } from "../../../../ast/nodes/expr/PebbleExpr";
import { ArrayLikeDeconstr } from "../../../../ast/nodes/statements/declarations/VarDecl/ArrayLikeDeconstr";
import { NamedDeconstructVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/NamedDeconstructVarDecl";
import { SimpleVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/SimpleVarDecl";
import { SingleDeconstructVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/SingleDeconstructVarDecl";
import { MatchStmt, MatchStmtCase } from "../../../../ast/nodes/statements/MatchStmt";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirMatchStmt, TirMatchStmtCase, TirMatchStmtWildcardCase } from "../../../tir/statements/TirMatchStmt";
import { TirNamedDeconstructVarDecl } from "../../../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirDataT } from "../../../tir/types/TirNativeType/native/data";
import { TirDataOptT } from "../../../tir/types/TirNativeType/native/Optional/data";
import { TirSopOptT } from "../../../tir/types/TirNativeType/native/Optional/sop";
import { isTirStructType, TirDataStructType, TirSoPStructType } from "../../../tir/types/TirStructType";
import { TirEnumType } from "../../../tir/types/TirEnumType";
import { getDeconstructableType, DeconstructableTirType } from "../../../tir/types/utils/getDeconstructableType";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { wrapManyStatements } from "../../utils/wrapManyStatementsOrReturnSame";
import { _compileExpr } from "../exprs/_compileExpr";
import { _compileStatement } from "./_compileStatement";
import { _compileArrayLikeDeconstr, _compileNamedDeconstructVarDecl, _compileSingleDeconstructVarDecl, _compileVarDecl } from "./_compileVarStmt";

function unwrapToIdentifierName( expr: PebbleExpr ): string | undefined
{
    while( expr instanceof ParentesizedExpr ) expr = expr.expr;
    return expr instanceof Identifier ? expr.text : undefined;
}

export function _compileMatchStmt(
    ctx: AstCompilationCtx,
    stmt: MatchStmt
): [ TirMatchStmt ] | undefined
{
    if( !ctx.functionCtx ) return ctx.error(
        DiagnosticCode.A_match_statement_can_only_be_used_within_a_function_body,
        stmt.range
    );

    const matchExpr = _compileExpr( ctx, stmt.matchExpr, undefined );
    if( !matchExpr ) return undefined;

    const matchExprType = matchExpr.type;
    const deconstructableType = getDeconstructableType( matchExprType );
    if( !deconstructableType ) return ctx.error(
        DiagnosticCode.A_value_of_type_0_cannot_be_deconstructed,
        stmt.matchExpr.range, matchExprType.toString()
    );

    // TODO: add support for all deconstructable types
    if( !isTirStructType( deconstructableType ) && !( deconstructableType instanceof TirEnumType ) )
    {
        return ctx.error(
            DiagnosticCode.Not_implemented_0,
            stmt.matchExpr.range,
            "only structs and enums supported for now, sorry!"
        );
    }

    const ctorNames = deconstructableType instanceof TirEnumType
        ? deconstructableType.members.slice()
        : deconstructableType.constructors.map( c => c.name );
    const totalCtors = ctorNames.length;
    const missingCtors = ctorNames.slice();

    if( stmt.cases.length === 0 ) return ctx.error(
        DiagnosticCode.A_match_statement_must_have_at_least_one_case,
        stmt.range
    );

    const matchedVarName = unwrapToIdentifierName( stmt.matchExpr );

    const cases: TirMatchStmtCase[] = [];
    const constrNamesAlreadySpecified: string[] = [];
    for( const matchCase of stmt.cases )
    {
        const branch = _compileTirMatchStmtCase(
            ctx,
            matchCase,
            deconstructableType,
            constrNamesAlreadySpecified,
            matchedVarName
        );
        if( !branch ) return undefined;
        
        /*
        if( branch instanceof TirMatchStmtWildcardCase )
        {
            wildcardCase = branch;
            break; // wildcard case catches any branch specified after it
        }
        //*/
        const indexOfCtor = missingCtors.indexOf( branch.pattern.constrName );
        if( indexOfCtor === -1 )
        {
            return ctx.error(
                DiagnosticCode.Unknown_0_constructor_1,
                branch.pattern.range, deconstructableType.toString(), branch.pattern.constrName
            );
        }
        missingCtors.splice( indexOfCtor, 1 );
        cases.push( branch );
    }

    let wildcardCase: TirMatchStmtWildcardCase | undefined = undefined;
    if( stmt.elseCase )
    {
        const matchCase = stmt.elseCase;
        const branchCtx = ctx.newBranchChildScope();
        const branchBody = wrapManyStatements(
            _compileStatement(
                branchCtx,
                matchCase.body
            ),
            matchCase.body.range
        );
        if( !branchBody ) return undefined;
        wildcardCase = new TirMatchStmtWildcardCase(
            branchBody,
            matchCase.range
        );
    }

    if( !wildcardCase && cases.length < totalCtors )
    {
        return ctx.error(
            DiagnosticCode.Match_cases_are_not_exhaustive,
            stmt.range
        );
    }

    return [ new TirMatchStmt(
        matchExpr,
        cases,
        wildcardCase,
        stmt.range
    ) ];
}
export function _compileTirMatchStmtCase(
    ctx: AstCompilationCtx,
    matchCase: MatchStmtCase,
    deconstructableType: DeconstructableTirType,
    constrNamesAlreadySpecified: string[],
    matchedVarName?: string
): TirMatchStmtCase | undefined
{
    /*
    const pattern = _compileVarDecl( ctx, matchCase.pattern, deconstructableType );
    if( !pattern ) return undefined;
    //*/
    const pattern = matchCase.pattern;

    if( pattern instanceof SimpleVarDecl ) {
        // bare-name pattern: only valid for enum scrutinees (`when Apple: ...`)
        if( deconstructableType instanceof TirEnumType )
        {
            const memberName = pattern.name.text;
            const memberIdx = deconstructableType.indexOf( memberName );
            if( memberIdx < 0 ) return ctx.error(
                DiagnosticCode.Unknown_0_constructor_1,
                pattern.name.range, deconstructableType.toString(), memberName
            );
            if( constrNamesAlreadySpecified.includes( memberName ) )
            return ctx.error(
                DiagnosticCode.Constructor_0_was_already_specified,
                pattern.name.range, memberName
            );
            constrNamesAlreadySpecified.push( memberName );

            const branchCtx = ctx.newBranchChildScope();
            const branchBody = wrapManyStatements(
                _compileStatement( branchCtx, matchCase.body ),
                matchCase.body.range
            );
            if( !branchBody ) return undefined;

            return new TirMatchStmtCase(
                new TirNamedDeconstructVarDecl(
                    memberName,
                    new Map(),
                    undefined,
                    deconstructableType,
                    undefined,
                    true,
                    pattern.name.range,
                    pattern.name.range
                ),
                branchBody,
                matchCase.range
            );
        }
        return ctx.error(
            DiagnosticCode.The_argument_of_a_match_statement_branch_must_be_deconstructed,
            matchCase.pattern.range
        );
    }
    else if( pattern instanceof NamedDeconstructVarDecl ) {
        const deconstructedCtorIdentifier = pattern.name;
        const deconstructedCtorName = deconstructedCtorIdentifier.text;

        if( constrNamesAlreadySpecified.includes( deconstructedCtorName ) )
        return ctx.error(
            DiagnosticCode.Constructor_0_was_already_specified,
            deconstructedCtorIdentifier.range, deconstructedCtorName
        );
        constrNamesAlreadySpecified.push( deconstructedCtorName );

        if( deconstructableType instanceof TirEnumType )
        {
            const memberIdx = deconstructableType.indexOf( deconstructedCtorName );
            if( memberIdx < 0 ) return ctx.error(
                DiagnosticCode.Unknown_0_constructor_1,
                pattern.name.range, deconstructableType.toString(), deconstructedCtorName
            );
            if( pattern.fields.size > 0 || pattern.rest ) return ctx.error(
                DiagnosticCode.Enum_member_pattern_cannot_have_fields,
                pattern.range
            );

            const branchCtx = ctx.newBranchChildScope();
            const branchBody = wrapManyStatements(
                _compileStatement( branchCtx, matchCase.body ),
                matchCase.body.range
            );
            if( !branchBody ) return undefined;

            return new TirMatchStmtCase(
                new TirNamedDeconstructVarDecl(
                    deconstructedCtorName,
                    new Map(),
                    undefined,
                    deconstructableType,
                    undefined,
                    true,
                    pattern.range,
                    pattern.name.range
                ),
                branchBody,
                matchCase.range
            );
        }

        if(
            deconstructableType instanceof TirSoPStructType
            || deconstructableType instanceof TirDataStructType
        )
        {
            const localIdx = deconstructableType.constructors.findIndex(
                c => c.name === deconstructedCtorName
            );
            if( localIdx < 0 ) return ctx.error(
                DiagnosticCode.Unknown_0_constructor_1,
                pattern.name.range, deconstructableType.toString(), deconstructedCtorName
            );

            const branchCtx = ctx.newBranchChildScope();

            // narrow the matched variable (if it's a plain identifier) to the matched constructor
            if( matchedVarName )
            {
                const parentIdx = deconstructableType.parentCtorIdx( localIdx );
                branchCtx.scope.narrowVariable(
                    matchedVarName,
                    deconstructableType.narrowTo( [ parentIdx ] )
                );
            }

            const branchArg = _compileNamedDeconstructVarDecl(
                branchCtx,
                pattern,
                deconstructableType
            );
            if( !branchArg ) return undefined;
            const branchBody = wrapManyStatements(
                _compileStatement(
                    branchCtx,
                    matchCase.body
                ),
                matchCase.body.range
            );
            if( !branchBody ) return undefined;

            return new TirMatchStmtCase(
                branchArg,
                branchBody,
                matchCase.range
            );
        }
        else if(
            deconstructableType instanceof TirSopOptT
            || deconstructableType instanceof TirDataOptT
        )
        {
            if(!(
                   deconstructedCtorName === "Some"     // { value, ...rest }
                || deconstructedCtorName === "None"     // { ...rest }
            )) return ctx.error(
                DiagnosticCode.Unknown_0_constructor_1,
                pattern.name.range, "Optional", deconstructedCtorName
            );

            const branchCtx = ctx.newBranchChildScope();

            const branchArg = _compileNamedDeconstructVarDecl(
                branchCtx,
                pattern,
                deconstructableType
            );
            if( !branchArg ) return undefined;
            const branchBody = wrapManyStatements(
                _compileStatement(
                    branchCtx,
                    matchCase.body
                ),
                matchCase.body.range
            );
            if( !branchBody ) return undefined;

            return new TirMatchStmtCase(
                branchArg,
                branchBody,
                matchCase.range
            );
        } 
        else if( deconstructableType instanceof TirDataT )
        {
            if(!(
                   deconstructedCtorName === "Constr"   // { index, fields, ...rest }
                || deconstructedCtorName === "Map"      // { map, ...rest }
                || deconstructedCtorName === "List"     // { list, ...rest }
                || deconstructedCtorName === "B"        // { bytes, ...rest }
                || deconstructedCtorName === "I"        // { int, ...rest }
            )) return ctx.error(
                DiagnosticCode.Unknown_0_constructor_1,
                pattern.name.range, "data", deconstructedCtorName
            );

            const branchCtx = ctx.newBranchChildScope();

            const branchArg = _compileNamedDeconstructVarDecl(
                branchCtx,
                pattern,
                deconstructableType
            );
            if( !branchArg ) return undefined;
            const branchBody = wrapManyStatements(
                _compileStatement(
                    branchCtx,
                    matchCase.body
                ),
                matchCase.body.range
            );
            if( !branchBody ) return undefined;

            return new TirMatchStmtCase(
                branchArg,
                branchBody,
                matchCase.range
            );
        }
        // else if( deconstructableType instanceof TirListT )
        // else if( deconstructableType instanceof TirLinearMapT )
        else return ctx.error(
            DiagnosticCode.A_value_of_type_0_cannot_be_deconstructed_by_named_object,
            matchCase.pattern.range, deconstructableType.toString()
        )
    }
    else if( pattern instanceof SingleDeconstructVarDecl )
    {
        if( !isTirStructType( deconstructableType ) )
        return ctx.error(
            DiagnosticCode.A_value_of_type_0_cannot_be_deconstructed_as_unnamed_object,
            matchCase.pattern.range, deconstructableType.toString()
        );

        if( deconstructableType.constructors.length !== 1 )
        return ctx.error(
            DiagnosticCode.A_value_of_type_0_has_multiple_constructors,
            matchCase.pattern.range, deconstructableType.toString()
        );

        const branchCtx = ctx.newBranchChildScope();

        const branchArg = _compileSingleDeconstructVarDecl(
            branchCtx,
            pattern,
            deconstructableType
        );
        if( !branchArg ) return undefined;
        if(!( branchArg instanceof TirNamedDeconstructVarDecl )) {
            return ctx.error(
                DiagnosticCode.Not_implemented_0,
                matchCase.pattern.range, 
                "only structs supported for now, sorry!"
            );
        }

        const branchBody = wrapManyStatements(
            _compileStatement(
                branchCtx,
                matchCase.body
            ),
            matchCase.body.range
        );
        if( !branchBody ) return undefined;

        return new TirMatchStmtCase(
            branchArg,
            branchBody,
            matchCase.range
        );
    }
    else if( pattern instanceof ArrayLikeDeconstr )
    {
        return ctx.error(
            DiagnosticCode.Not_implemented_0,
            pattern.range, 
            "only structs supported for now, sorry!"
        );

        /*
        if(!(
            deconstructableType instanceof TirListT
            || deconstructableType instanceof TirLinearMapT
        )) return ctx.error(
            DiagnosticCode.A_value_of_type_0_cannot_be_deconstructed_as_an_array,
            matchCase.pattern.range, deconstructableType.toString()
        );

        const branchCtx = ctx.newBranchChildScope();

        const branchArg = _compileArrayLikeDeconstr(
            branchCtx,
            pattern,
            deconstructableType
        );
        if( !branchArg ) return undefined;
        const branchBody = wrapManyStatements(
            _compileStatement(
                branchCtx,
                matchCase.body
            ),
            matchCase.body.range
        );
        if( !branchBody ) return undefined;

        return new TirMatchStmtCase(
            branchArg,
            branchBody,
            matchCase.range
        );
        //*/
    }

    throw new Error("unreachable::AstCompiler::_compileTirMatchStmtCase");
}