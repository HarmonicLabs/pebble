import { isObject } from "@harmoniclabs/obj-utils";
import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { isBinaryExpr } from "../../../../ast/nodes/expr/binary/BinaryExpr";
import { CaseExpr } from "../../../../ast/nodes/expr/CaseExpr";
import { ElemAccessExpr } from "../../../../ast/nodes/expr/ElemAccessExpr";
import { CallExpr } from "../../../../ast/nodes/expr/functions/CallExpr";
import { FuncExpr } from "../../../../ast/nodes/expr/functions/FuncExpr";
import { LitArrExpr } from "../../../../ast/nodes/expr/litteral/LitArrExpr";
import { LitContextExpr } from "../../../../ast/nodes/expr/litteral/LitContextExpr";
import { LitFailExpr } from "../../../../ast/nodes/expr/litteral/LitFailExpr";
import { LitFalseExpr } from "../../../../ast/nodes/expr/litteral/LitFalseExpr";
import { LitHexBytesExpr } from "../../../../ast/nodes/expr/litteral/LitHexBytesExpr";
import { LitIntExpr } from "../../../../ast/nodes/expr/litteral/LitIntExpr";
import { LitNamedObjExpr } from "../../../../ast/nodes/expr/litteral/LitNamedObjExpr";
import { LitObjExpr } from "../../../../ast/nodes/expr/litteral/LitObjExpr";
import { LitStrExpr } from "../../../../ast/nodes/expr/litteral/LitStrExpr";
import { isLitteralExpr } from "../../../../ast/nodes/expr/litteral/LitteralExpr";
import { LitThisExpr } from "../../../../ast/nodes/expr/litteral/LitThisExpr";
import { LitTrueExpr } from "../../../../ast/nodes/expr/litteral/LitTrueExpr";
import { LitUndefExpr } from "../../../../ast/nodes/expr/litteral/LitUndefExpr";
import { LitVoidExpr } from "../../../../ast/nodes/expr/litteral/LitVoidExpr";
import { ParentesizedExpr } from "../../../../ast/nodes/expr/ParentesizedExpr";
import { PebbleExpr } from "../../../../ast/nodes/expr/PebbleExpr";
import { isPropAccessExpr } from "../../../../ast/nodes/expr/PropAccessExpr";
import { TernaryExpr } from "../../../../ast/nodes/expr/TernaryExpr";
import { TypeConversionExpr } from "../../../../ast/nodes/expr/TypeConversionExpr";
import { isUnaryPrefixExpr } from "../../../../ast/nodes/expr/unary/UnaryPrefixExpr";
import { AssertStmt } from "../../../../ast/nodes/statements/AssertStmt";
import { isAssignmentStmt, isExplicitAssignmentStmt, isImplicitAssignmentStmt } from "../../../../ast/nodes/statements/AssignmentStmt";
import { BlockStmt } from "../../../../ast/nodes/statements/BlockStmt";
import { BreakStmt } from "../../../../ast/nodes/statements/BreakStmt";
import { ContinueStmt } from "../../../../ast/nodes/statements/ContinueStmt";
import { ContractDecl } from "../../../../ast/nodes/statements/declarations/ContractDecl";
import { FuncDecl } from "../../../../ast/nodes/statements/declarations/FuncDecl";
import { StructConstrDecl, StructDecl, StructDeclAstFlags } from "../../../../ast/nodes/statements/declarations/StructDecl";
import { NamedDeconstructVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/NamedDeconstructVarDecl";
import { SimpleVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/SimpleVarDecl";
import { SingleDeconstructVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/SingleDeconstructVarDecl";
import { isVarDecl, VarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/VarDecl";
import { EmptyStmt } from "../../../../ast/nodes/statements/EmptyStmt";
import { FailStmt } from "../../../../ast/nodes/statements/FailStmt";
import { ForOfStmt } from "../../../../ast/nodes/statements/ForOfStmt";
import { ForStmt } from "../../../../ast/nodes/statements/ForStmt";
import { IfStmt } from "../../../../ast/nodes/statements/IfStmt";
import { MatchStmtCase, MatchStmt, MatchStmtElseCase } from "../../../../ast/nodes/statements/MatchStmt";
import { BodyStmt } from "../../../../ast/nodes/statements/PebbleStmt";
import { ReturnStmt } from "../../../../ast/nodes/statements/ReturnStmt";
import { UsingStmt } from "../../../../ast/nodes/statements/UsingStmt";
import { VarStmt } from "../../../../ast/nodes/statements/VarStmt";
import { WhileStmt } from "../../../../ast/nodes/statements/WhileStmt";
import { SourceRange } from "../../../../ast/Source/SourceRange";
import { CommonFlags } from "../../../../common";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { getUniqueInternalName } from "../../../internalVar";
import { TirDataStructType, TirStructConstr, TirStructField } from "../../../tir/types/TirStructType";
import { AstCompiler } from "../../AstCompiler";
import { AstNamedTypeExpr } from "../../../../ast/nodes/types/AstNamedTypeExpr";
import { NonNullExpr } from "../../../../ast/nodes/expr/unary/NonNullExpr";

/**
 * 
 * only returns the body of the main function
 * 
 * function arguments (parameters and script context) must be handled outside
 */
export function _deriveContractBody(
    compiler: AstCompiler,
    contractDecl: ContractDecl,
    paramsInternalNamesMap: Map<string, string>,
    scriptContextName: string
): BlockStmt | undefined
{
    const contractRange = contractDecl.range;

    // no methods is always fail
    if(
        contractDecl.spendMethods.length === 0
        && contractDecl.mintMethods.length === 0
        && contractDecl.certifyMethods.length === 0
        && contractDecl.withdrawMethods.length === 0
        && contractDecl.proposeMethods.length === 0
        && contractDecl.voteMethods.length === 0
    ) return new BlockStmt([
        new FailStmt( undefined, contractRange )
    ], contractRange);

    // contract body alwyas looks like:
    //
    // ```
    // func main( ...params, ctx: ScriptContext ) : void {
    //     const { tx, purpose, redeemer } = ctx;
    // 
    //     match( purpose ) {
    //         when Spend{}: { ... }
    //         when Mint{}: { ... }
    //         when Withdraw{}: { ... }
    //         when Certify{}: { ... }
    //         when Propose{}: { ... }
    //         when Vote{}: { ... }
    //         else fail;
    //     }
    // 
    //     fail; // unreachable
    // }
    // ```
    // 
    // so we only have 3 statements in the body
    const bodyStmts: BodyStmt[] = [];

    const txUniqueName = getUniqueInternalName("tx");
    const purposeUniqueName = getUniqueInternalName("purpose");
    const redeemerUniqueName = getUniqueInternalName("redeemer");

    bodyStmts.push(
        new VarStmt(
            [new SingleDeconstructVarDecl(
                // fields
                new Map<Identifier, VarDecl>([
                    [
                        new Identifier( "tx", contractRange ),
                        SimpleVarDecl.onlyNameConst( txUniqueName, contractRange )
                    ],
                    [
                        new Identifier( "purpose", contractRange ),
                        SimpleVarDecl.onlyNameConst( purposeUniqueName, contractRange )
                    ],
                    [
                        new Identifier( "redeemer", contractRange ),
                        SimpleVarDecl.onlyNameConst( redeemerUniqueName, contractRange )
                    ],
                ]),
                undefined, // rest
                undefined, // type (inferred from initExpr)
                new Identifier( scriptContextName, contractRange ), // initExpr
                CommonFlags.Const,
                contractRange
            )],
            contractRange
        )
    );

    /*
    const { data: scriptInfo_t } = defineMultiConstructorStruct(
        "ScriptInfo", {
            Mint: {
                policy: policyId_t
            },
            Spend: {
                ref: txOutRef_t,
                optionalDatum: opt_data_t
            },
            Withdraw: {
                credential: credential_t
            },
            Certificate: {
                certificateIndex: int_t,
                certificate: credential_t
            },
            Vote: {
                voter: voter_t
            },
            Propose: {
                proposalIndex: int_t,
                proposal: proposalProcedure_t
            }
        }, onlyData
    );
     */
    const purposeMatchCases: MatchStmtCase[] = [];
    if( contractDecl.spendMethods.length > 0 ) {
        const spendingRefUniqueName = getUniqueInternalName("spendingRef");
        const optionalDatumUniqueName = getUniqueInternalName("optionalDatum");
        const fields: Map<Identifier, SimpleVarDecl> = new Map([
            [
                new Identifier( "ref", contractRange ),
                SimpleVarDecl.onlyNameConst( spendingRefUniqueName, contractRange )
            ],
            [
                new Identifier( "optionalDatum", contractRange ),
                SimpleVarDecl.onlyNameConst( optionalDatumUniqueName, contractRange )
            ],
        ]);

        const bodyStmts = _getMatchedPurposeBlockStatements(
            compiler,
            contractDecl.spendMethods,
            paramsInternalNamesMap,
            // contextVarsMapping
            Object.freeze({
                tx: txUniqueName,
                purposeData: purposeUniqueName,
                redeemerData: redeemerUniqueName,
                spendingRef: spendingRefUniqueName,
                optionalDatum: optionalDatumUniqueName,
            }),
            "SpendRedeemer",
            contractRange,
        );
        if( !Array.isArray( bodyStmts ) ) return undefined;

        purposeMatchCases.push(
            new MatchStmtCase(
                new NamedDeconstructVarDecl(
                    new Identifier( "Spend", contractRange ),
                    fields,
                    undefined, // rest
                    undefined, // type (inferred from initExpr)
                    undefined, // initExpr
                    CommonFlags.Const,
                    contractRange
                ),
                new BlockStmt(
                    bodyStmts,
                    contractRange
                ),
                contractRange
            )
        );
    }
    if( contractDecl.mintMethods.length > 0 ) {
        const policyUniqueName = getUniqueInternalName("policy");
        const fields: Map<Identifier, SimpleVarDecl> = new Map([
            [
                new Identifier( "policy", contractRange ),
                SimpleVarDecl.onlyNameConst( policyUniqueName, contractRange )
            ],
        ]);

        const bodyStmts = _getMatchedPurposeBlockStatements(
            compiler,
            contractDecl.mintMethods,
            paramsInternalNamesMap,
            // contextVarsMapping
            Object.freeze({
                tx: txUniqueName,
                purposeData: purposeUniqueName,
                redeemerData: redeemerUniqueName,
                policy: policyUniqueName,
            }),
            "MintRedeemer",
            contractRange,
        );
        if( !Array.isArray( bodyStmts ) ) return undefined;

        purposeMatchCases.push(
            new MatchStmtCase(
                new NamedDeconstructVarDecl(
                    new Identifier( "Mint", contractRange ),
                    fields,
                    undefined, // rest
                    undefined, // type (inferred from initExpr)
                    undefined, // initExpr
                    CommonFlags.Const,
                    contractRange
                ),
                new BlockStmt(
                    bodyStmts,
                    contractRange
                ),
                contractRange
            )
        )
    }
    if( contractDecl.withdrawMethods.length > 0 ) {
        const credentialUniqueName = getUniqueInternalName("credential");
        const fields: Map<Identifier, SimpleVarDecl> = new Map([
            [
                new Identifier( "credential", contractRange ),
                SimpleVarDecl.onlyNameConst( credentialUniqueName, contractRange )
            ],
        ]);

        const bodyStmts = _getMatchedPurposeBlockStatements(
            compiler,
            contractDecl.withdrawMethods,
            paramsInternalNamesMap,
            // contextVarsMapping
            Object.freeze({
                tx: txUniqueName,
                purposeData: purposeUniqueName,
                redeemerData: redeemerUniqueName,
                policy: credentialUniqueName,
            }),
            "WithdrawRedeemer",
            contractRange,
        );
        if( !Array.isArray( bodyStmts ) ) return undefined;

        purposeMatchCases.push(
            new MatchStmtCase(
                new NamedDeconstructVarDecl(
                    new Identifier( "Withdraw", contractRange ),
                    fields,
                    undefined, // rest
                    undefined, // type (inferred from initExpr)
                    undefined, // initExpr
                    CommonFlags.Const,
                    contractRange
                ),
                new BlockStmt(
                    bodyStmts,
                    contractRange
                ),
                contractRange
            )
        )
    }
    if( contractDecl.certifyMethods.length > 0 ) {
        const indexUniqueName = getUniqueInternalName("certificateIndex");
        const certificateUniqueName = getUniqueInternalName("certificate");
        const fields: Map<Identifier, SimpleVarDecl> = new Map([
            [
                new Identifier( "certificateIndex", contractRange ),
                SimpleVarDecl.onlyNameConst( indexUniqueName, contractRange )
            ],
            [
                new Identifier( "certificate", contractRange ),
                SimpleVarDecl.onlyNameConst( certificateUniqueName, contractRange )
            ],
        ]);

        const bodyStmts = _getMatchedPurposeBlockStatements(
            compiler,
            contractDecl.certifyMethods,
            paramsInternalNamesMap,
            // contextVarsMapping
            Object.freeze({
                tx: txUniqueName,
                purposeData: purposeUniqueName,
                redeemerData: redeemerUniqueName,
                certificateIndex: indexUniqueName,
                certificate: certificateUniqueName,
            }),
            "CertifyRedeemer",
            contractRange,
        );
        if( !Array.isArray( bodyStmts ) ) return undefined;

        purposeMatchCases.push(
            new MatchStmtCase(
                new NamedDeconstructVarDecl(
                    new Identifier( "Certificate", contractRange ),
                    fields,
                    undefined, // rest
                    undefined, // type (inferred from initExpr)
                    undefined, // initExpr
                    CommonFlags.Const,
                    contractRange
                ),
                new BlockStmt(
                    bodyStmts,
                    contractRange
                ),
                contractRange
            )
        );
    }
    if( contractDecl.proposeMethods.length > 0 ) {
        const indexUniqueName = getUniqueInternalName("proposalIndex");
        const proposalUniqueName = getUniqueInternalName("proposal");
        const fields: Map<Identifier, SimpleVarDecl> = new Map([
            [
                new Identifier( "proposalIndex", contractRange ),
                SimpleVarDecl.onlyNameConst( indexUniqueName, contractRange )
            ],
            [
                new Identifier( "proposal", contractRange ),
                SimpleVarDecl.onlyNameConst( proposalUniqueName, contractRange )
            ],
        ]);

        const bodyStmts = _getMatchedPurposeBlockStatements(
            compiler,
            contractDecl.proposeMethods,
            paramsInternalNamesMap,
            // contextVarsMapping
            Object.freeze({
                tx: txUniqueName,
                purposeData: purposeUniqueName,
                redeemerData: redeemerUniqueName,
                proposalIndex: indexUniqueName,
                proposal: proposalUniqueName,
            }),
            "ProposeRedeemer",
            contractRange,
        );
        if( !Array.isArray( bodyStmts ) ) return undefined;

        purposeMatchCases.push(
            new MatchStmtCase(
                new NamedDeconstructVarDecl(
                    new Identifier( "Propose", contractRange ),
                    fields,
                    undefined, // rest
                    undefined, // type (inferred from initExpr)
                    undefined, // initExpr
                    CommonFlags.Const,
                    contractRange
                ),
                new BlockStmt(
                    bodyStmts,
                    contractRange
                ),
                contractRange
            )
        );
    }
    if( contractDecl.voteMethods.length > 0 ) {
        const voterUniqueName = getUniqueInternalName("voter");
        const fields: Map<Identifier, SimpleVarDecl> = new Map([
            [
                new Identifier( "voter", contractRange ),
                SimpleVarDecl.onlyNameConst( voterUniqueName, contractRange )
            ],
        ]);
        const bodyStmts = _getMatchedPurposeBlockStatements(
            compiler,
            contractDecl.voteMethods,
            paramsInternalNamesMap,
            // contextVarsMapping
            Object.freeze({
                tx: txUniqueName,
                purposeData: purposeUniqueName,
                redeemerData: redeemerUniqueName,
                voter: voterUniqueName,
            }),
            "VoteRedeemer",
            contractRange,
        );
        if( !Array.isArray( bodyStmts ) ) return undefined;

        purposeMatchCases.push(
            new MatchStmtCase(
                new NamedDeconstructVarDecl(
                    new Identifier( "Vote", contractRange ),
                    fields,
                    undefined, // rest
                    undefined, // type (inferred from initExpr)
                    undefined, // initExpr
                    CommonFlags.Const,
                    contractRange
                ),
                new BlockStmt(
                    bodyStmts,
                    contractRange
                ),
                contractRange
            )
        );
    }

    bodyStmts.push(
        new MatchStmt(
            new Identifier( purposeUniqueName, contractRange ),
            purposeMatchCases,
            new MatchStmtElseCase(
                new FailStmt( undefined, contractRange ),
                contractRange
            ),
            contractRange
        )
    );

    bodyStmts.push( new FailStmt( undefined, contractRange ) ); // unreachable in theory (else case)
    return new BlockStmt( bodyStmts, contractRange );
}

function _getMatchedPurposeBlockStatements(
    compiler: AstCompiler,
    methods: FuncDecl[],
    paramsInternalNamesMap: Map<string, string>,
    contextVarsMapping: RenamedVariables,
    baseRedeemerName: string,
    contractRange: SourceRange,
    // txUniqueName: string,
    // purposeUniqueName: string,
    // redeemerUniqueName: string,
    // spendingRefUniqueName: string,
    // optionalDatumUniqueName: string,
): BodyStmt[] | undefined
{
    // usually 0 methods is checked before calling
    // but just in case it is not, we handle it here
    if( methods.length === 0 ) return [
        new FailStmt( undefined, contractRange )
    ];

    const redeemerTypeDef = _deriveRedeemerTypeDef(
        baseRedeemerName, // "SpendRedeemer",
        methods,
        contractRange
    );
    compiler.registerInternalTypeDecl( redeemerTypeDef );

    // if only one method, we can inline it
    if( methods.length === 1 ) {
        const method = methods[0];
        const stmts = _getRedeemerMethodBlockStatemets(
            compiler,
            method,
            redeemerTypeDef,
            paramsInternalNamesMap,
            contextVarsMapping
        );
        if( !Array.isArray( stmts ) ) return undefined;
        
        return stmts;
    }

    // multiple methods, need to match redeemer
    const redeemerMatchCases: MatchStmtCase[] = [];
    for( const method of methods ) {
        const stmts = _getRedeemerMethodBlockStatemets(
            compiler,
            method,
            redeemerTypeDef,
            paramsInternalNamesMap,
            contextVarsMapping
        );
        if( !Array.isArray( stmts ) ) return undefined;

        redeemerMatchCases.push(
            new MatchStmtCase(
                new NamedDeconstructVarDecl(
                    new Identifier( method.expr.name.text, method.expr.name.range ),
                    new Map<Identifier, VarDecl>(
                        redeemerTypeDef.constrs.find( c => c.name.text === method.expr.name.text )!.fields.map(( fieldDef, i ) => {
                            const param = method.expr.signature.params[i];
                            const range = param.range;

                            return [
                                new Identifier( fieldDef.name.text, range ),
                                param
                            ];
                        })
                    ),
                    undefined, // rest
                    undefined, // type (inferred from initExpr)
                    undefined, // initExpr
                    CommonFlags.Const,
                    method.expr.name.range
                ),
                new BlockStmt(
                    stmts,
                    contractRange
                ),
                method.expr.range
            )
        );
    }

    return [
        new MatchStmt(
            new TypeConversionExpr(
                new Identifier( contextVarsMapping.redeemerData, contractRange ),
                new AstNamedTypeExpr(
                    new Identifier( redeemerTypeDef.name.text, contractRange ),
                    [], // typeArgs
                    contractRange
                )
            ),
            redeemerMatchCases,
            new MatchStmtElseCase(
                new FailStmt( undefined, contractRange ),
                contractRange
            ),
            contractRange
        ),
        new FailStmt( undefined, contractRange ) // unreachable in theory (else case)
    ];
}

type RenamedVariables = Record<string, string>;

function _getRedeemerMethodBlockStatemets(
    compiler: AstCompiler,
    method: FuncDecl,
    redeemerTypeDef: StructDecl,
    paramsInternalNamesMap: Map<string, string>,
    contextVarsMapping: RenamedVariables,
    /**
     * remember destructured context fields that have been renamed
     */
    renamedVariables: RenamedVariables = {}
): BodyStmt[] | undefined
{
    const redeemerTypeName = redeemerTypeDef.name.text;
    const methodExpr = method.expr;

    const redeemerTypeConstr = redeemerTypeDef.constrs.find( constr => constr.name.text === method.expr.name.text );
    if( !redeemerTypeConstr )
    throw new Error(`unreachable Internal Error: missing redeemer constructor ${method.expr.name.text}`);

    if( redeemerTypeConstr.fields.length !== methodExpr.signature.params.length )
    throw new Error(`unreachable Internal Error: redeemer constructor ${method.expr.name.text} fields length missmatch with method parameters length`);

    const result = _getMatchedRedeemerBlockStatements(
        compiler,
        methodExpr.bodyBlockStmt().stmts,
        paramsInternalNamesMap,
        contextVarsMapping,
        renamedVariables
    );
    if( !Array.isArray( result ) ) return undefined;

    // prepend redeemer fields destructuring if single method for this purpose
    if(
        redeemerTypeDef.constrs.length === 1
        && methodExpr.signature.params.length > 0
    ) {
        const fields = new Map<Identifier, VarDecl>(
            redeemerTypeConstr.fields.map(( fieldDef, i ) => {
                const param = methodExpr.signature.params[i];
                const range = param.range;
    
                return [
                    new Identifier( fieldDef.name.text, range ),
                    param
                ];
            })
        );

        result.unshift(
            new NamedDeconstructVarDecl(
                method.expr.name,
                fields,
                undefined, // rest
                undefined, // type (inferred from initExpr)
                new TypeConversionExpr(
                    new Identifier( contextVarsMapping.redeemerData, method.range ),
                    new AstNamedTypeExpr(
                        new Identifier( redeemerTypeName, method.range ),
                        [], // typeArgs
                        method.range
                    )
                ), // initExpr
                CommonFlags.Const,
                method.range
            )
        );
    };

    // always add implicit return void (unit) at the end of a method
    result.push(
        new ReturnStmt(
            new LitVoidExpr( methodExpr.range.atEnd() ),
            methodExpr.range.atEnd()
        )
    );
    return result;
}

function _getMatchedRedeemerBlockStatements(
    compiler: AstCompiler,
    stmts: BodyStmt[],
    paramsInternalNamesMap: Map<string, string>,
    contextVarsMapping: RenamedVariables | undefined,
    renamedVariables: RenamedVariables
): BodyStmt[] | undefined
{
    const result = stmts.slice();

    for( let i = 0; i < result.length; i++ ) {
        let stmt = result[i];

        if( isVarDecl( stmt ) ) stmt = new VarStmt([ stmt ], stmt.range );
        if( stmt instanceof VarStmt ) {
            if( stmt.declarations.length !== 1 ) {
                for( const varDecl of stmt.declarations ) {
                    if( varDecl.initExpr ) varDecl.initExpr = _exprReplaceParamsAndAssertNoLitContext(
                        compiler,
                        varDecl.initExpr,
                        paramsInternalNamesMap,
                        renamedVariables
                    );
                }
                continue;
            } 
            const varDecl = stmt.declarations[0];

            if(!( varDecl.initExpr instanceof LitContextExpr )) {
                // normal var decl
                if( varDecl.initExpr ) varDecl.initExpr = _exprReplaceParamsAndAssertNoLitContext(
                    compiler,
                    varDecl.initExpr,
                    paramsInternalNamesMap,
                    renamedVariables
                );
                continue;
            }

            // varDecl.initExpr is a LitContextExpr
            // handle context destructuring

            if(!( varDecl instanceof SingleDeconstructVarDecl ))
            return compiler.error(
                DiagnosticCode._context_can_only_be_destructured_as_an_unnamed_object,
                varDecl.range
            );
            if( !varDecl.isConst() )
            return compiler.error(
                DiagnosticCode._context_can_only_be_destructured_in_a_constant_declaration,
                varDecl.range
            );

            /**
             * statements to push instead of the context destructuring
             * (nested fields destructured)
             **/
            const newStmts: BodyStmt[] = [];
            
            const destructuredFieldsIds: string[] = [];
            // introduce destructured variables as renamed variables
            for( let [ fieldIdentifier, fieldVarDecl ] of varDecl.fields ) {
                if(!( contextVarsMapping && isObject( contextVarsMapping ) ))
                {
                    return compiler.error(
                        DiagnosticCode._context_can_only_be_accessed_in_a_contract_method,
                        fieldIdentifier.range
                    );
                }
                const realVarName = contextVarsMapping[ fieldIdentifier.text ];
                if( !realVarName && typeof realVarName !== "string" ) {
                    return compiler.error(
                        DiagnosticCode._0_is_not_aviable_in_this_contract_method_context,
                        fieldIdentifier.range, fieldIdentifier.text
                    );
                }

                if( destructuredFieldsIds.includes( fieldIdentifier.text ) ) {
                    return compiler.error(
                        DiagnosticCode.Duplicate_identifier_0,
                        fieldVarDecl.range, fieldIdentifier.text
                    );
                }
                destructuredFieldsIds.push( fieldIdentifier.text );

                if(!( fieldVarDecl instanceof SimpleVarDecl ))
                {
                    const uniqueName = getUniqueInternalName( fieldIdentifier.text );
                    // move nested field destructuring outside of this destructuring
                    fieldVarDecl.initExpr = new Identifier( uniqueName, fieldIdentifier.range );
                    fieldVarDecl.flags |= CommonFlags.Const;
                    newStmts.push( fieldVarDecl );
                    // replace destructured field with a simple renaming of the field
                    fieldVarDecl = SimpleVarDecl.onlyNameConst( uniqueName, fieldIdentifier.range );
                }

                const introducedVarName = fieldVarDecl.name.text;

                if( renamedVariables[ introducedVarName ] )
                return compiler.error(
                    DiagnosticCode.Duplicate_identifier_0,
                    fieldVarDecl.range, fieldIdentifier.text
                );

                // when reading `introducedVarName`, it will be replaced with `realVarName`
                renamedVariables[ introducedVarName ] = realVarName;
            }

            // remove the context destrucuturing statement from the result
            // push new ones if any
            result.splice(i, 1, ...newStmts);
            i--;

            continue;
        } // if( stmt instanceof VarStmt )

        if(
            stmt instanceof BreakStmt
            || stmt instanceof ContinueStmt
            || stmt instanceof EmptyStmt
            || stmt instanceof UsingStmt
        ) continue;

        if( isImplicitAssignmentStmt( stmt ) ) continue;
        if( isExplicitAssignmentStmt( stmt ) ) {
            const newAssingedExpr = _exprReplaceParamsAndAssertNoLitContext(
                compiler,
                stmt.assignedExpr,
                paramsInternalNamesMap,
                renamedVariables
            );
            if( !newAssingedExpr ) return undefined;
            stmt.assignedExpr = newAssingedExpr;
            continue;
        }

        if( stmt instanceof BlockStmt ) {
            const nextBodyStmts = _getMatchedRedeemerBlockStatements(
                compiler,
                stmt.stmts,
                paramsInternalNamesMap,
                contextVarsMapping,
                renamedVariables
            );
            if( !Array.isArray( nextBodyStmts ) ) return undefined;
            stmt.stmts = nextBodyStmts;
            continue;
        }

        if( stmt instanceof ReturnStmt ) {
            if( !stmt.value ) continue;
            const newReturnExpr = _exprReplaceParamsAndAssertNoLitContext(
                compiler,
                stmt.value,
                paramsInternalNamesMap,
                renamedVariables
            );
            if( !newReturnExpr ) return undefined;
            stmt.value = newReturnExpr;
            continue;
        }

        if( stmt instanceof IfStmt ) {
            const nextContidionExpr = _exprReplaceParamsAndAssertNoLitContext(
                compiler,
                stmt.condition,
                paramsInternalNamesMap,
                renamedVariables
            );
            if( !nextContidionExpr ) return undefined;
            stmt.condition = nextContidionExpr;

            const nextThenStmts = _getMatchedRedeemerBlockStatements(
                compiler,
                stmt.thenBranchBlock().stmts,
                paramsInternalNamesMap,
                contextVarsMapping,
                renamedVariables
            );
            if( !Array.isArray( nextThenStmts ) ) return undefined;
            stmt.thenBranch = new BlockStmt( nextThenStmts, stmt.thenBranch.range );

            if( stmt.elseBranch ) {
                const nextElseStmts = _getMatchedRedeemerBlockStatements(
                    compiler,
                    stmt.elseBranchBlock()!.stmts,
                    paramsInternalNamesMap,
                    contextVarsMapping,
                    renamedVariables
                );
                if( !Array.isArray( nextElseStmts ) ) return undefined;
                stmt.elseBranch = new BlockStmt( nextElseStmts, stmt.elseBranch.range );
            }
            continue;
        }

        if( stmt instanceof MatchStmt ) {
            const nextMatchExpr = _exprReplaceParamsAndAssertNoLitContext(
                compiler,
                stmt.matchExpr,
                paramsInternalNamesMap,
                renamedVariables
            );
            if( !nextMatchExpr ) return undefined;
            stmt.matchExpr = nextMatchExpr;

            for( let i = 0; i < stmt.cases.length; i++ ) {
                const c = stmt.cases[i];

                const nextCaseBody = _getMatchedRedeemerBlockStatements(
                    compiler,
                    c.bodyBlockStmt().stmts,
                    paramsInternalNamesMap,
                    contextVarsMapping,
                    renamedVariables
                );
                if( !Array.isArray( nextCaseBody ) ) return undefined;
                c.body = new BlockStmt( nextCaseBody, c.body.range );
            }

            if( stmt.elseCase ) {
                const nextElseBody = _getMatchedRedeemerBlockStatements(
                    compiler,
                    stmt.elseCase.bodyBlockStmt().stmts,
                    paramsInternalNamesMap,
                    contextVarsMapping,
                    renamedVariables
                );
                if( !Array.isArray( nextElseBody ) ) return undefined;
                stmt.elseCase.body = new BlockStmt( nextElseBody, stmt.elseCase.body.range );
            }
            continue;
        }

        if( stmt instanceof FailStmt ) {
            if( !stmt.value ) continue;
            const newFailExpr = _exprReplaceParamsAndAssertNoLitContext(
                compiler,
                stmt.value,
                paramsInternalNamesMap,
                renamedVariables
            );
            if( !newFailExpr ) return undefined;
            stmt.value = newFailExpr;
            continue;
        }

        if( stmt instanceof AssertStmt ) {
            const newConditionExpr = _exprReplaceParamsAndAssertNoLitContext(
                compiler,
                stmt.condition,
                paramsInternalNamesMap,
                renamedVariables
            );
            if( !newConditionExpr ) return undefined;
            stmt.condition = newConditionExpr;

            if( stmt.elseExpr ) {
                const newElseExpr = _exprReplaceParamsAndAssertNoLitContext(
                    compiler,
                    stmt.elseExpr,
                    paramsInternalNamesMap,
                    renamedVariables
                );
                if( !newElseExpr ) return undefined;
                stmt.elseExpr = newElseExpr;
            }
            continue;
        }

        if( stmt instanceof ForStmt ) {
            if( stmt.init ) {
                const nextInitStmts = _getMatchedRedeemerBlockStatements(
                    compiler,
                    [ stmt.init ],
                    paramsInternalNamesMap,
                    contextVarsMapping,
                    renamedVariables
                );
                if(!(
                    Array.isArray( nextInitStmts )
                    && nextInitStmts.length === 1
                )) return undefined;
                const nextInit = nextInitStmts[0];
                if(!( nextInit instanceof VarStmt ))
                throw new Error("unreachable::_getMatchedRedeemerBlockStatements::ForStmt::init");
                stmt.init = nextInit;
            }
            if( stmt.condition ) {
                const newConditionExpr = _exprReplaceParamsAndAssertNoLitContext(
                    compiler,
                    stmt.condition,
                    paramsInternalNamesMap,
                    renamedVariables
                );
                if( !newConditionExpr ) return undefined;
                stmt.condition = newConditionExpr;
            }
            for( let i = 0; i < stmt.updates.length; i++ ) {
                const updateStmt = stmt.updates[i];
                const nextUpdateStmts = _getMatchedRedeemerBlockStatements(
                    compiler,
                    [ updateStmt ],
                    paramsInternalNamesMap,
                    contextVarsMapping,
                    renamedVariables
                );
                if(!(
                    Array.isArray( nextUpdateStmts )
                    && nextUpdateStmts.length === 1
                )) return undefined;
                const nextUpdateStmt = nextUpdateStmts[0];
                if(!( isImplicitAssignmentStmt( nextUpdateStmt ) || isExplicitAssignmentStmt( nextUpdateStmt ) ))
                throw new Error("unreachable::_getMatchedRedeemerBlockStatements::ForStmt::update");
                stmt.updates[i] = nextUpdateStmt;
            }

            const nextBodyStmts = _getMatchedRedeemerBlockStatements(
                compiler,
                stmt.bodyBlock().stmts,
                paramsInternalNamesMap,
                contextVarsMapping,
                renamedVariables
            );
            if( !Array.isArray( nextBodyStmts ) ) return undefined;
            stmt.body = new BlockStmt( nextBodyStmts, stmt.body.range );
            continue;
        }

        if( stmt instanceof ForOfStmt ) {
            const newIterableExpr = _exprReplaceParamsAndAssertNoLitContext(
                compiler,
                stmt.iterable,
                paramsInternalNamesMap,
                renamedVariables
            );
            if( !newIterableExpr ) return undefined;
            stmt.iterable = newIterableExpr;

            const nextBodyStmts = _getMatchedRedeemerBlockStatements(
                compiler,
                stmt.bodyBlock().stmts,
                paramsInternalNamesMap,
                contextVarsMapping,
                renamedVariables
            );
            if( !Array.isArray( nextBodyStmts ) ) return undefined;
            stmt.body = new BlockStmt( nextBodyStmts, stmt.body.range );
            continue;
        }
        if( stmt instanceof WhileStmt ) {
            const newConditionExpr = _exprReplaceParamsAndAssertNoLitContext(
                compiler,
                stmt.condition,
                paramsInternalNamesMap,
                renamedVariables
            );
            if( !newConditionExpr ) return undefined;
            stmt.condition = newConditionExpr;

            const nextBodyStmts = _getMatchedRedeemerBlockStatements(
                compiler,
                stmt.bodyBlock().stmts,
                paramsInternalNamesMap,
                contextVarsMapping,
                renamedVariables
            );
            if( !Array.isArray( nextBodyStmts ) ) return undefined;
            stmt.body = new BlockStmt( nextBodyStmts, stmt.body.range );
            continue;
        }

        const tsEnsureExhaustiveCheck: never = stmt;
        console.error( stmt );
        throw new Error("unreachable::_getMatchedRedeemerBlockStatements::stmt::"); 
    }

    return result;
}

function _exprReplaceParamsAndAssertNoLitContext(
    compiler: AstCompiler,
    expr: PebbleExpr,
    paramsInternalNamesMap: Map<string, string>,
    renamedVariables: RenamedVariables,
): PebbleExpr | undefined
{
    if( expr instanceof LitContextExpr )
    return compiler.error(
        DiagnosticCode._context_can_only_be_destructured_as_an_unnamed_object,
        expr.range
    );
    if( isPropAccessExpr( expr ) && expr.object instanceof LitThisExpr )
    {
        const paramName = expr.prop.text;
        const internalName = paramsInternalNamesMap.get( paramName );
        if( !internalName )
        return compiler.error(
            DiagnosticCode._0_is_not_a_contract_parameter,
            expr.prop.range, paramName
        );

        return new Identifier( internalName, expr.range );
    }
    if( expr instanceof LitThisExpr )
    return compiler.error(
        DiagnosticCode._this_in_a_contract_context_can_only_be_used_to_read_parameters_in_a_contract_method,
        expr.range
    );
    if( expr instanceof Identifier ) {
        const renamed = renamedVariables[ expr.text ];
        if( renamed ) return new Identifier( renamed, expr.range );
        return expr;
    }
    if(
        isUnaryPrefixExpr( expr )
        || expr instanceof NonNullExpr
    ) {
        const newOperand = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.operand,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newOperand ) return undefined;
        expr.operand = newOperand;
        return expr;
    }
    if(
        // isLitteralExpr( expr )
        expr instanceof LitVoidExpr
        || expr instanceof LitUndefExpr
        || expr instanceof LitTrueExpr
        || expr instanceof LitFalseExpr
        || expr instanceof LitThisExpr
        || expr instanceof LitContextExpr
        || expr instanceof LitArrExpr
        || expr instanceof LitObjExpr
        || expr instanceof LitNamedObjExpr
        || expr instanceof LitStrExpr
        || expr instanceof LitIntExpr
        || expr instanceof LitHexBytesExpr
        || expr instanceof LitFailExpr
    ) return expr;
    if( isBinaryExpr( expr ) ) {
        const newLeft = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.left,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newLeft ) return undefined;
        expr.left = newLeft;

        const newRight = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.right,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newRight ) return undefined;
        expr.right = newRight;

        return expr;
    }
    if( expr instanceof ParentesizedExpr ) {
        const newInner = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.expr,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newInner ) return undefined;
        expr.expr = newInner;
        return expr;
    }
    if( expr instanceof TypeConversionExpr ) {
        const newInner = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.expr,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newInner ) return undefined;
        expr.expr = newInner;
        return expr;
    }
    if( isPropAccessExpr( expr ) ) {
        const newObject = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.object,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newObject ) return undefined;
        expr.object = newObject;
        return expr;
    }
    if( expr instanceof ElemAccessExpr ) {
        const newObj = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.arrLikeExpr,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newObj ) return undefined;
        expr.arrLikeExpr = newObj;

        const newIndex = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.indexExpr,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newIndex ) return undefined;
        expr.indexExpr = newIndex;

        return expr;
    }
    if( expr instanceof TernaryExpr ) {
        const newCondition = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.condition,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newCondition ) return undefined;
        expr.condition = newCondition;

        const newIfTrue = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.ifTrue,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newIfTrue ) return undefined;
        expr.ifTrue = newIfTrue;

        const newIfFalse = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.ifFalse,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newIfFalse ) return undefined;
        expr.ifFalse = newIfFalse;

        return expr;
    }
    if( expr instanceof CaseExpr ) {
        const newTestExpr = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.matchExpr,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newTestExpr ) return undefined;
        expr.matchExpr = newTestExpr;

        for( let i = 0; i < expr.cases.length; i++ ) {
            const c = expr.cases[i];

            const newCaseBody = _exprReplaceParamsAndAssertNoLitContext(
                compiler,
                c.body,
                paramsInternalNamesMap,
                renamedVariables
            );
            if( !newCaseBody ) return undefined;
            c.body = newCaseBody;
        }

        if( expr.wildcardCase ) {
            const newWildcardBody = _exprReplaceParamsAndAssertNoLitContext(
                compiler,
                expr.wildcardCase.body,
                paramsInternalNamesMap,
                renamedVariables
            );
            if( !newWildcardBody ) return undefined;
            expr.wildcardCase.body = newWildcardBody;
        }

        return expr;
    }

    if( expr instanceof CallExpr ) {
        const newCallee = _exprReplaceParamsAndAssertNoLitContext(
            compiler,
            expr.funcExpr,
            paramsInternalNamesMap,
            renamedVariables
        );
        if( !newCallee ) return undefined;
        expr.funcExpr = newCallee;

        for( let i = 0; i < expr.args.length; i++ ) {
            const arg = expr.args[i];
            const newArg = _exprReplaceParamsAndAssertNoLitContext(
                compiler,
                arg,
                paramsInternalNamesMap,
                renamedVariables
            );
            if( !newArg ) return undefined;
            expr.args[i] = newArg;
        }

        return expr;
    }

    if( expr instanceof FuncExpr ) {

        const sigParams = expr.signature.params;
        for( const param of sigParams ) {
            if( param.initExpr ) param.initExpr = _exprReplaceParamsAndAssertNoLitContext(
                compiler,
                param.initExpr,
                paramsInternalNamesMap,
                renamedVariables
            );
        }

        const nextBodyStmts = _getMatchedRedeemerBlockStatements(
            compiler,
            expr.bodyBlockStmt().stmts,
            paramsInternalNamesMap,
            undefined, // contextVarsMapping,
            renamedVariables
        );
        if( !Array.isArray( nextBodyStmts ) ) return undefined;
        expr.body = new BlockStmt(
            nextBodyStmts,
            expr.body.range
        );

        return expr;
    }

    const tsEnsureExhaustiveCheck: never = expr;
    console.error(expr);
    throw new Error("unreachable::_exprReplaceParamsAndAssertNoLitContext");
}

function _deriveRedeemerTypeDef(
    redeemerName: string,
    methods: FuncDecl[],
    contractRange: SourceRange,
): StructDecl
{
    let defFlags = StructDeclAstFlags.onlyDataEncoding;
    if( methods.length <= 1 ) defFlags |= StructDeclAstFlags.untaggedSingleConstructor;

    const uniqueName = getUniqueInternalName( redeemerName );
    return new StructDecl(
        new Identifier( uniqueName, contractRange ),
        [], // typeParams
        methods.map( m => {
            const methodParams = m.expr.signature.params;
            if(!methodParams.every( p =>
                p instanceof SimpleVarDecl && !p.initExpr && p.type
            )) throw new Error("Contract method parameters not simplified befor inferring redeemer definition.");

            return new StructConstrDecl(
                new Identifier( m.expr.name.text, m.expr.name.range ),
                methodParams as SimpleVarDecl[],
                contractRange
            );
        }), // contructors
        defFlags,
        contractRange
    );
    /*
    return new TirDataStructType(
        uniqueName,
        "", // fileUid
        methods.map( m =>
            new TirStructConstr(
                m.expr.name.text,
                m.expr.signature.params.map( p =>
                    new TirStructField(
                        p.name.text,
                        p.type!,
                    )
                )
            )
        ),
        new Map(), // no methods
        methods.length <= 1, // untagged if there is only one method
    );
    //*/
}