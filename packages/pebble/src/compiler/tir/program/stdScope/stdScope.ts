import { AstFuncName, TirFuncName } from "../../../AstCompiler/scope/AstScope";
import { TirNativeType } from "../../types/TirNativeType/TirNativeType";
import { TirAliasType } from "../../types/TirAliasType";
import { TirDataStructType, TirSoPStructType, TirStructConstr, TirStructField, TirStructType } from "../../types/TirStructType";
import { TypedProgram } from "../TypedProgram";
import { TirType } from "../../types/TirType";
import { TirBoolT } from "../../types/TirNativeType/native/bool";
import { TirBytesT } from "../../types/TirNativeType/native/bytes";
import { TirDataT } from "../../types/TirNativeType/native/data";
import { TirIntT } from "../../types/TirNativeType/native/int";
import { TirLinearMapT } from "../../types/TirNativeType/native/linearMap";
import { TirListT } from "../../types/TirNativeType/native/list";
import { TirArrayT } from "../../types/TirNativeType/native/array";
import { TirValueT } from "../../types/TirNativeType/native/value";
import { TirDataOptT } from "../../types/TirNativeType/native/Optional/data";
import { TirSopOptT } from "../../types/TirNativeType/native/Optional/sop";
import { TirStringT } from "../../types/TirNativeType/native/string";
import { TirVoidT } from "../../types/TirNativeType/native/void";
import { PEBBLE_INTERNAL_IDENTIFIER_PREFIX } from "../../../internalVar";
import { TirFuncExpr } from "../../expressions/TirFuncExpr";
import { TirSimpleVarDecl } from "../../statements/TirVarDecl/TirSimpleVarDecl";
import { SourceRange } from "../../../../ast/Source/SourceRange";
import { TirBlockStmt } from "../../statements/TirBlockStmt";
import { TirReturnStmt } from "../../statements/TirReturnStmt";
import { TirInlineClosedIR } from "../../expressions/TirInlineClosedIR";
import { TirFuncT } from "../../types/TirNativeType";
import { IRNative } from "../../../../IR/IRNodes/IRNative";
import { IRNativeTag } from "../../../../IR/IRNodes/IRNative/IRNativeTag";
import { IRFunc } from "../../../../IR/IRNodes/IRFunc";
import { IRVar } from "../../../../IR/IRNodes/IRVar";
import { IRConstr } from "../../../../IR/IRNodes/IRConstr";
import { _ir_apps } from "../../../../IR/IRNodes/IRApp";
import { IRConst } from "../../../../IR/IRNodes/IRConst";
import { IRTerm } from "../../../../IR/IRTerm";
import { _ir_lazyIfThenElse } from "../../../../IR/tree_utils/_ir_lazyIfThenElse";

export const void_t = new TirVoidT();
export const int_t = new TirIntT();
export const string_t = new TirStringT();
export const bytes_t = new TirBytesT();
export const bool_t = new TirBoolT();
export const data_t = new TirDataT();

export const valueMapLovelacesName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "sortedValueLovelaces";
export const valueMapAmountOfName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "amountOfValue";
// Native Value (ConstTyTag.value); methods route to the value builtins.
export const valueLovelacesName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueLovelaces";
export const valueAmountOfName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueAmountOf";
export const valueInsertCoinName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueInsertCoin";
export const valueUnionName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueUnion";
export const valueContainsName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueContains";
export const valueScaleName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueScale";
export const valueToDataName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueToData";
/** the `std.value.zero` program constant (the empty native Value) */
export const valueZeroConstName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueZero";
export const getCredentialHashFuncName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "getCredentialHash";
// Value arithmetic (milestone 2 stdlib expansion)
export const valueNegateName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueNegate";
export const valueEqualsName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueEquals";
export const valueSubtractName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueSubtract";
export const valueIsZeroName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueIsZero";
export const valueGeqName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueGeq";
export const valueLeqName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueLeq";
export const valueSingletonName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueSingleton";
export const valueAmountOfAssetName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "valueAmountOfAsset";
export const assetClassConstructorName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "assetClassConstructor";
// script-context helpers (milestone 2 stdlib expansion)
export const txSignedByName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "txSignedBy";
export const txFindInputName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "txFindInput";
export const txOutputsToCredentialName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "txOutputsToCredential";
export const txInputsFromCredentialName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "txInputsFromCredential";
export const txValuePaidToName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "txValuePaidTo";
export const txOutInlineDatumName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "txOutInlineDatum";
export const intervalLowerBoundFiniteName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "intervalLowerBoundFinite";
export const intervalUpperBoundFiniteName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "intervalUpperBoundFinite";
export const intervalContainsName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "intervalContains";
export const intervalIsEntirelyAfterName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "intervalIsEntirelyAfter";
export const intervalIsEntirelyBeforeName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "intervalIsEntirelyBefore";
// list helpers registered as program functions (milestone 2 stdlib expansion)
export const listSumName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "listSum";

export function populateStdScope( program: TypedProgram ): void
{
    const stdScope = program.stdScope;

    function _defineStdUnambigous( t: TirType )
    {
        const name = t.toTirTypeKey();
        program.types.set( name, t );
        stdScope.defineUnambigousType( name, name, true, new Map() );
    }

    _defineStdUnambigous( void_t );
    _defineStdUnambigous( bool_t );
    // `bool` is a common spelling; accept it as an alias for `boolean`.
    stdScope.defineUnambigousType( "bool", bool_t.toTirTypeKey(), true, new Map() );
    _defineStdUnambigous( int_t );
    _defineStdUnambigous( bytes_t );
    _defineStdUnambigous( string_t );
    _defineStdUnambigous( data_t );
    // Register native Value (ConstTyTag.value) in program.types so the prelude
    // alias can wrap it. The user-facing `Value` name is defined in the
    // prelude scope (with methods routed to the value builtins).
    {
        const value_native_t = new TirValueT();
        program.types.set( value_native_t.toTirTypeKey(), value_native_t );
    }

    const array_name = TirArrayT.toTirTypeKey();
    program.defineGenericType(
        array_name,
        1,
        ([ arg ]) => new TirArrayT( arg )
    );
    stdScope.defineType(
        array_name,
        {
            sopTirName: array_name,
            dataTirName: array_name,
            allTirNames: new Set([
                array_name
            ]),
            methodsNames: new Map(),
            isGeneric: true
        }
    );

    const opt_data_name = TirDataOptT.toTirTypeKey();
    program.defineGenericType(
        opt_data_name,
        1,
        ([ arg ]) => new TirDataOptT( arg )
    );
    const opt_sop_name = TirSopOptT.toTirTypeKey();
    program.defineGenericType(
        opt_sop_name,
        1,
        ([ arg ]) => new TirSopOptT( arg )
    );

    const ast_opt_name = "Optional";
    stdScope.defineType(
        ast_opt_name,
        {
            sopTirName: opt_sop_name,
            dataTirName: opt_data_name,
            allTirNames: new Set([
                opt_data_name,
                opt_sop_name,
            ]),
            methodsNames: new Map(),
            isGeneric: true
        }
    );

    const list_name = TirListT.toTirTypeKey();
    program.defineGenericType(
        list_name,
        1,
        ([ arg ]) => new TirListT( arg )
    );
    stdScope.defineType(
        list_name,
        {
            sopTirName: list_name,
            dataTirName: list_name,
            allTirNames: new Set([
                list_name
            ]),
            methodsNames: new Map(),
            isGeneric: true
        }
    );

    const linearMap_name = TirLinearMapT.toTirTypeKey();
    program.defineGenericType(
        linearMap_name,
        2,
        ([ arg1, arg2 ]) => new TirLinearMapT( arg1, arg2 )
    );
    stdScope.defineType(
        linearMap_name,
        {
            sopTirName: linearMap_name,
            dataTirName: linearMap_name,
            allTirNames: new Set([
                linearMap_name
            ]),
            methodsNames: new Map(),
            isGeneric: true
        }
    );
    // AST-facing name: the tir key is "list_pair_data", but user code writes
    // `LinearMap<K, V>` in type position (struct fields, aliases, annotations)
    stdScope.defineType(
        "LinearMap",
        {
            sopTirName: linearMap_name,
            dataTirName: linearMap_name,
            allTirNames: new Set([
                linearMap_name
            ]),
            methodsNames: new Map(),
            isGeneric: true
        }
    );

    stdScope.readonly();
}

export function populatePreludeScope( program: TypedProgram ): void
{
    const preludeScope = program.preludeScope;
    // empty string will be never generated as uid,
    // so it is fine to use it for prelude
    const preludeFileUid = "";

    const bytes_t = program.types.get( TirBytesT.toTirTypeKey() );
    const int_t = program.types.get( TirIntT.toTirTypeKey() );
    const data_t = program.types.get( TirDataT.toTirTypeKey() );
    const bool_t = program.types.get( TirBoolT.toTirTypeKey() );
    if(!(
        bytes_t
        && int_t
        && data_t
        && bool_t
    )) throw new Error("stdScope uninitialized");

    const map_int_data_t = program.getAppliedGeneric(
        TirLinearMapT.toTirTypeKey(),
        [ int_t.toConcreteTirTypeName(), data_t.toConcreteTirTypeName() ]
    );
    if(!(
        map_int_data_t
    )) throw new Error("stdScope uninitialized");

    function _defineUnambigousAlias(
        name: string,
        tirType: TirType,
        methodsNames: Map<AstFuncName, TirFuncName> = new Map()
    )
    {
        const t = new TirAliasType(
            name,
            preludeFileUid,
            tirType,
            methodsNames
        );
        const tir_key = t.toTirTypeKey();
        program.types.set( tir_key, t );
        preludeScope.defineUnambigousType(
            name,
            tir_key,
            t.hasDataEncoding(),
            methodsNames
        );
        return t;
    }

    const hash32_t = _defineUnambigousAlias( "Hash32", bytes_t );
    const hash28_t = _defineUnambigousAlias( "Hash28", bytes_t );
    const policyId_t = _defineUnambigousAlias( "PolicyId", hash28_t );
    const tokenName_t = _defineUnambigousAlias( "TokenName", bytes_t );
    const pubKeyHash_t = _defineUnambigousAlias( "PubKeyHash", hash28_t );
    const scriptHash_t = _defineUnambigousAlias( "ScriptHash", hash28_t );
    const txHash_t = _defineUnambigousAlias( "TxHash", hash32_t );
    
    function mkSingleConstructorStruct(
        name: string,
        fields: { [x: string]: TirType },
        methodNames: Map<AstFuncName, TirFuncName> = new Map()
    ): { sop: TirSoPStructType, data: TirDataStructType }
    {
        const sop = new TirSoPStructType(
            name,
            preludeFileUid,
            [
                new TirStructConstr(
                    name,
                    Object.keys( fields ).map( name =>
                        new TirStructField(name, fields[name])
                    )
                )
            ],
            methodNames
        );
        const data = new TirDataStructType(
            name,
            preludeFileUid,
            [
                new TirStructConstr(
                    name,
                    Object.keys( fields ).map( name => 
                        new TirStructField(name, fields[name])
                    )
                )
            ],
            methodNames
        );
        return { sop, data };
    }
    interface DefineStructOpts {
        data: boolean;
        sop: boolean;
    }
    function defineSingleConstructorStruct(
        name: string,
        fields: { [x: string]: TirType },
        opts: DefineStructOpts,
        methodsNames: Map<AstFuncName, TirFuncName> = new Map()
    ): { sop: TirSoPStructType, data: TirDataStructType }
    {
        // forward methodsNames into the TYPE constructors too: method-call
        // dispatch reads `TirStructType.methodNamesPtr` (expressifyVars),
        // not only the scope-level table
        const { sop, data } = mkSingleConstructorStruct( name, fields, methodsNames );
        const sop_key = sop.toTirTypeKey();
        const data_key = data.toTirTypeKey();
        if( opts.sop ) program.types.set( sop_key, sop );
        if( opts.data ) program.types.set( data_key, data );
        preludeScope.defineType(
            name,
            {
                sopTirName: sop_key,
                dataTirName: opts.data ? data_key : undefined,
                allTirNames: new Set([
                    sop_key,
                    opts.data ? data_key : undefined
                ].filter( x => typeof x === "string" )) as Set<string>,
                methodsNames,
                isGeneric: false
            }
        );
        return { sop, data };
    }
    
    function mkMultiConstructorStruct(
        name: string,
        constrs: { [x: string]: { [x: string]: TirNativeType } },
        methodNames: Map<AstFuncName, TirFuncName> = new Map()
    ): { sop: TirSoPStructType, data: TirDataStructType }
    {
        const sop = new TirSoPStructType(
            name,
            preludeFileUid,
            Object.keys( constrs ).map( constrName => 
                new TirStructConstr(
                    constrName,
                    Object.keys( constrs[constrName] ).map( name => 
                        new TirStructField(name, constrs[constrName][name])
                    )
                )
            ),
            methodNames
        );
        const data = new TirDataStructType(
            name,
            preludeFileUid,
            Object.keys( constrs ).map( constrName => 
                new TirStructConstr(
                    constrName,
                    Object.keys( constrs[constrName] ).map( name => 
                        new TirStructField(name, constrs[constrName][name])
                    )
                )
            ),
            methodNames
        );
        return { sop, data };
    }
    function defineMultiConstructorStruct(
        name: string,
        constrs: { [x: string]: { [x: string]: TirNativeType } },
        opts: DefineStructOpts,
        methodsNames: Map<AstFuncName, TirFuncName> = new Map()
    ): { sop: TirSoPStructType, data: TirDataStructType }
    {
        const { sop, data } = mkMultiConstructorStruct( name, constrs, methodsNames );
        const sop_key = sop.toTirTypeKey();
        const data_key = data.toTirTypeKey();
        if( opts.sop ) program.types.set( sop_key, sop );
        if( opts.data ) program.types.set( data_key, data );
        preludeScope.defineType(
            name,
            {
                sopTirName: sop_key,
                dataTirName: opts.data ? data_key : undefined,
                allTirNames: new Set([
                    sop_key,
                    opts.data ? data_key : undefined
                ].filter( x => typeof x === "string" )) as Set<string>,
                methodsNames,
                isGeneric: false
            }
        );
        return { sop, data };
    }

    const onlyData = {
        sop: false,
        data: true
    };

    const { data: txOutRef_t } = defineSingleConstructorStruct(
        "TxOutRef", {
            id: txHash_t,
            index: int_t
        }, onlyData
    );
    const { data: credential_t } = defineMultiConstructorStruct(
        "Credential", {
            PubKey: {
                hash: pubKeyHash_t
            },
            Script: {
                hash: scriptHash_t
            }
        },
        onlyData,
        new Map([
            [
                "hash",
                getCredentialHashFuncName
            ],
        ])
    );
    preludeScope.program.functions.set(
        getCredentialHashFuncName,
        new TirInlineClosedIR(
            new TirFuncT([ credential_t ], hash28_t ),
            ( ctx ) => IRNative._getCredentialsHash,
            SourceRange.unknown
        )
    );
    
    const changeParams_t = _defineUnambigousAlias( "ChangedParameters", map_int_data_t );
    const { data: rational_t } = defineSingleConstructorStruct(
        "Rational", {
            numerator: int_t,
            denominator: int_t
        }, onlyData
    );
    const { data: protocolVersion_t } = defineSingleConstructorStruct(
        "ProtocolVersion", {
            major: int_t,
            minor: int_t
        }, onlyData
    );
    // struct ConstitutionInfo {
    //     consitutionScriptHash: Optional<ScriptHash>
    // }
    const opt_scriptHash_t = program.getAppliedGeneric(
        TirDataOptT.toTirTypeKey(),
        [ scriptHash_t ]
    );
    if(!opt_scriptHash_t) throw new Error("expected opt_scriptHash_t");

    const { data: constitutionInfo_t } = defineSingleConstructorStruct(
        "ConstitutionInfo", {
            consitutionScriptHash: opt_scriptHash_t
        }, onlyData
    );
    // struct GovAction {
    //     ParameterChange {
    //         govActionId: Optional<TxOutRef>,
    //         changedParameters: ChangedParameters,
    //         constitutionScriptHash: Optional<ScriptHash>
    //     }
    //     HardForkInitiation {
    //         govActionId: Optional<TxOutRef>,
    //         nextProtocolVersion: ProtocolVersion
    //     }
    //     TreasuryWithdrawals {
    //         withdrawals: LinearMap<Credential, int>
    //         constitutionScriptHash: Optional<ScriptHash>
    //     }
    //     NoConfidence {
    //         govActionId: Optional<TxOutRef>
    //     }
    //     UpdateCommittee {
    //         govActionId: Optional<TxOutRef>,
    //         removed: List<Credential>,
    //         newMembers: LinearMap<Credential, int>,
    //         newQuorum: Rational
    //     }
    //     NewConstitution {
    //         govActionId: Optional<TxOutRef>,
    //         info: ConstitutionInfo
    //     }
    //     InfoAction {}
    // }
    const opt_txOutRef_t = program.getAppliedGeneric(
        TirDataOptT.toTirTypeKey(),
        [ txOutRef_t ]
    );
    if(!opt_txOutRef_t) throw new Error("expected opt_txOutRef_t");
    const map_cred_int_t = program.getAppliedGeneric(
        TirLinearMapT.toTirTypeKey(),
        [ credential_t, int_t ]
    );
    if(!map_cred_int_t) throw new Error("expected map_cred_int_t");
    const list_cred_t = program.getAppliedGeneric(
        TirListT.toTirTypeKey(),
        [ credential_t ]
    );
    if(!list_cred_t) throw new Error("expected list_cred_t");
    const { data: govAction_t } = defineMultiConstructorStruct(
        "GovAction", {
            ParameterChange: {
                govActionId: opt_txOutRef_t,
                changedParameters: map_int_data_t,
                constitutionScriptHash: opt_scriptHash_t
            },
            HardForkInitiation: {
                govActionId: opt_txOutRef_t,
                nextProtocolVersion: protocolVersion_t
            },
            TreasuryWithdrawals: {
                withdrawals: map_cred_int_t,
                constitutionScriptHash: opt_scriptHash_t
            },
            NoConfidence: {
                govActionId: opt_txOutRef_t
            },
            UpdateCommittee: {
                govActionId: opt_txOutRef_t,
                removed: list_cred_t,
                newMembers: map_cred_int_t,
                newQuorum: rational_t
            },
            NewConstitution: {
                govActionId: opt_txOutRef_t,
                info: constitutionInfo_t
            },
            InfoAction: {}
        }, onlyData
    );
    // struct ProposalProcedure {
    //     deposit: int,
    //     credential: Credential,
    //     action: GovAction
    // }
    const { data: proposalProcedure_t } = defineSingleConstructorStruct(
        "ProposalProcedure", {
            deposit: int_t,
            credential: credential_t,
            action: govAction_t
        }, onlyData
    );
    // struct Voter {
    //     Committee {
    //         credential: Credential
    //     }
    //     DRep {
    //         credential: Credential
    //     }
    //     StakePool {
    //         credential: PubKeyHash
    //     }
    // }
    const { data: voter_t } = defineMultiConstructorStruct(
        "Voter", {
            Committee: {
                credential: credential_t
            },
            DRep: {
                credential: credential_t
            },
            StakePool: {
                pubKeyHash: pubKeyHash_t
            }
        }, onlyData
    );
    // struct ScriptPurpose {
    //     Mint { policy: PolicyId }
    //     Spend {
    //         ref: TxOutRef,
    //     }
    //     Withdraw {
    //         credential: Credential
    //     }
    //     Certificate {
    //         index: int,
    //         certificate: Certificate
    //     }
    //     Vote {
    //         voter: Voter
    //     }
    //     Propose {
    //         index: int,
    //         proposal: ProposalProcedure
    //     }
    // }
    const { data: scriptPurpose_t } = defineMultiConstructorStruct(
        "ScriptPurpose", {
            Mint: {
                policy: policyId_t
            },
            Spend: {
                ref: txOutRef_t
            },
            Withdraw: {
                credential: credential_t
            },
            Certificate: {
                index: int_t,
                certificate: credential_t
            },
            Vote: {
                voter: voter_t
            },
            Propose: {
                index: int_t,
                proposal: proposalProcedure_t
            }
        }, onlyData
    );

    // struct Vote {
    //     No {}
    //     Yes {}
    //     Abstain {}
    // }
    const { data: vote_t } = defineMultiConstructorStruct(
        "Vote", {
            No: {},
            Yes: {},
            Abstain: {}
        }, onlyData
    );
    // struct Delegatee {
    //     StakePool { poolKeyHash: PubKeyHash }
    //     DRep { drep: Credential }
    //     PoolAndDRep {
    //         poolKeyHash: PubKeyHash,
    //         drep: Credential
    //     }
    // }
    const { data: delegatee_t } = defineMultiConstructorStruct(
        "Delegatee", {
            StakePool: {
                poolKeyHash: pubKeyHash_t
            },
            DRep: {
                drep: credential_t
            },
            PoolAndDRep: {
                poolKeyHash: pubKeyHash_t,
                drep: credential_t
            }
        }, onlyData
    );
    // struct Certificate {
    //     StakeRegistration {
    //         stakeKey: Credential,
    //         deposit: Optional<int>
    //     }
    //     StakeDeRegistration {
    //         stakeKey: Credential,
    //         refund: Optional<int>
    //     }
    //     Delegation {
    //         delegator: Credential,
    //         delegatee: Delegatee
    //     }
    //     RegistrationAndDelegation {
    //         delegator: Credential,
    //         delegatee: Delegatee,
    //         lovelacesDeposit: int
    //     }
    //     DRepRegistration {
    //         drep: Credential,
    //         lovelacesDeposit: int
    //     }
    //     DRepUpdate {
    //         drep: Credential
    //     }
    //     DRepDeRegistration {
    //         drep: Credential,
    //         refund: int
    //     }
    //     PoolRegistration {
    //         poolId: PubKeyHash,
    //         poolVRF: PubKeyHash
    //     }
    //     PoolRetire {
    //         poolId: PubKeyHash,
    //         epoch: int
    //     }
    //     CommitteeHotAuthorization {
    //         cold: Credential,
    //         hot: Credential
    //     }
    //     CommitteeResignation {
    //         cold: Credential
    //     }
    // }
    const opt_int_t = program.getAppliedGeneric(
        TirDataOptT.toTirTypeKey(),
        [ int_t ]
    )
    if(!opt_int_t) throw new Error("expected opt_int_t");
    const { data: certificate_t } = defineMultiConstructorStruct(
        "Certificate", {
            StakeRegistration: {
                stakeKey: credential_t,
                deposit: opt_int_t
            },
            StakeDeRegistration: {
                stakeKey: credential_t,
                refund: opt_int_t
            },
            Delegation: {
                delegator: credential_t,
                delegatee: delegatee_t
            },
            RegistrationAndDelegation: {
                delegator: credential_t,
                delegatee: delegatee_t,
                lovelacesDeposit: int_t
            },
            DRepRegistration: {
                drep: credential_t,
                lovelacesDeposit: int_t
            },
            DRepUpdate: {
                drep: credential_t
            },
            DRepDeRegistration: {
                drep: credential_t,
                refund: int_t
            },
            PoolRegistration: {
                poolId: pubKeyHash_t,
                poolVRF: bytes_t
            },
            PoolRetire: {
                poolId: pubKeyHash_t,
                epoch: int_t
            },
            CommitteeHotAuthorization: {
                cold: credential_t,
                hot: credential_t
            },
            CommitteeResignation: { cold: credential_t }
        }, onlyData
    );
    // struct ScriptInfo {
    //     Mint { policy: PolicyId }
    //     Spend {
    //         ref: TxOutRef,
    //         datum: Optional<data>
    //     }
    //     Withdraw {
    //         credential: Credential
    //     }
    //     Certificate {
    //         index: int,
    //         certificate: Certificate
    //     }
    //     Vote {
    //         voter: Voter
    //     }
    //     Propose {
    //         index: int,
    //         proposal: ProposalProcedure
    //     }
    // }
    const opt_data_t = program.getAppliedGeneric(
        TirDataOptT.toTirTypeKey(),
        [ data_t ]
    );
    if(!opt_data_t) throw new Error("expected opt_data_t");
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
                certificate: certificate_t
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
    // struct StakeCredential {
    //     Credential { credential: Credential }
    //     Ptr {
    //        a: int,
    //        b: int,
    //        c: int
    //     }
    // }
    const { data: stakeCredential_t } = defineMultiConstructorStruct(
        "StakeCredential", {
            Credential: {
                credential: credential_t
            },
            Ptr: {
                a: int_t,
                b: int_t,
                c: int_t
            }
        }, onlyData
    );
    // struct Address {
    //     payment: Credential,
    //     stake: Optional<Credential>
    // }
    const opt_stakeCredential_t = program.getAppliedGeneric(
        TirDataOptT.toTirTypeKey(),
        [ stakeCredential_t ]
    );
    if(!opt_stakeCredential_t) throw new Error("expected opt_stakeCredential_t");
    const { data: address_t } = defineSingleConstructorStruct(
        "Address", {
            payment: credential_t,
            stake: opt_stakeCredential_t
        }, onlyData
    );
    // type ValueMap = LinearMap<PolicyId, LinearMap<TokenName, int>>
    const map_tokenName_int_t = program.getAppliedGeneric(
        TirLinearMapT.toTirTypeKey(),
        [ tokenName_t, int_t ]
    );
    if(!map_tokenName_int_t) throw new Error("expected map_tokenName_int_t");
    const map_policyId_map_tokenName_int_t = program.getAppliedGeneric(
        TirLinearMapT.toTirTypeKey(),
        [ policyId_t, map_tokenName_int_t ]
    );
    if(!map_policyId_map_tokenName_int_t) throw new Error("expected map_policyId_map_tokenName_int_t");
    const valueMap_t = _defineUnambigousAlias(
        "ValueMap",
        map_policyId_map_tokenName_int_t,
        new Map([
            [
                "lovelaces",
                valueMapLovelacesName
            ],
            [
                "amountOf",
                valueMapAmountOfName
            ],
        ])
    );
    preludeScope.program.functions.set(
        valueMapLovelacesName,
        new TirInlineClosedIR(
            new TirFuncT([ valueMap_t ], int_t ),
            ( ctx ) => IRNative._sortedValueLovelaces,
            SourceRange.unknown
        )
    );
    // ValueMap.amountOf( policy: PolicyId, name: bytes ): int
    // The IR native _amountOfValue is curried as: (isPolicy)(value)(isTokenName) => int
    // where isPolicy and isTokenName are equality-check predicates.
    // This wrapper adapts (self, policy, tokenName) => _amountOfValue(p => equalsByteString(p, policy))(self)(tn => equalsByteString(tn, tokenName))
    preludeScope.program.functions.set(
        valueMapAmountOfName,
        new TirInlineClosedIR(
            new TirFuncT([ valueMap_t, policyId_t, bytes_t ], int_t ),
            ( ctx ) => {
                const self = Symbol("amtOf_self");
                const policy = Symbol("amtOf_policy");
                const tokenName = Symbol("amtOf_tokenName");
                const p = Symbol("amtOf_p");
                const tn = Symbol("amtOf_tn");
                return new IRFunc(
                    [ self, policy, tokenName ],
                    _ir_apps(
                        _ir_apps(
                            _ir_apps(
                                IRNative._amountOfValue,
                                // isPolicy predicate: \p -> equalsByteString(p, policy)
                                _ir_apps(
                                    IRNative.equalsByteString,
                                    new IRVar( policy )
                                )
                            ),
                            // value (self)
                            new IRVar( self )
                        ),
                        // isTokenName predicate: \tn -> equalsByteString(tn, tokenName)
                        _ir_apps(
                            IRNative.equalsByteString,
                            new IRVar( tokenName )
                        )
                    )
                );
            },
            SourceRange.unknown
        )
    );

    // Native `Value` (ConstTyTag.value). Methods route to the value builtins.
    const value_native_t = program.types.get( TirValueT.toTirTypeKey() );
    if(!value_native_t) throw new Error("expected native Value type registered");
    const value_t = _defineUnambigousAlias(
        "Value",
        value_native_t,
        new Map([
            [ "lovelaces", valueLovelacesName ],
            [ "amountOf",  valueAmountOfName  ],
            [ "insert",    valueInsertCoinName ],
            [ "union",     valueUnionName    ],
            [ "contains",  valueContainsName ],
            [ "scale",     valueScaleName    ],
            [ "toData",    valueToDataName   ],
            [ "negate",    valueNegateName   ],
            [ "equals",    valueEqualsName   ],
            [ "subtract",  valueSubtractName ],
            [ "isZero",    valueIsZeroName   ],
            [ "geq",       valueGeqName      ],
            [ "leq",       valueLeqName      ],
            [ "amountOfAsset", valueAmountOfAssetName ],
        ])
    );

    // `std.value.zero` — the EMPTY native Value.
    //
    // There is no UPLC constant of the builtin Value type (it is not even
    // caseable), so it must be BUILT at runtime out of an empty map:
    //
    //     unValueData( mapData( mkNilPairData( () ) ) )
    //
    // Registering it in `program.constants` is what makes it shared:
    // `expressify` turns every program constant into a `TirHoistedExpr`, and
    // `TirInlineClosedIR.toIR` wraps the term in an `IRHoisted` — so however
    // many times a contract mentions `std.value.zero`, the script builds it
    // ONCE, and scripts that never mention it don't contain it at all.
    //
    // Typed with the `Value` ALIAS (not the bare native type) so it carries
    // the method table above: `std.value.zero.lovelaces()` and friends work
    // like on any other Value. The namespace member itself is bound in
    // `populateStdNamespace` (which reads this constant back by name).
    program.constants.set(
        valueZeroConstName,
        new TirSimpleVarDecl(
            valueZeroConstName,
            value_t,
            new TirInlineClosedIR(
                value_t,
                () => _ir_apps(
                    IRNative.unValueData,
                    _ir_apps(
                        IRNative.mapData,
                        _ir_apps( IRNative.mkNilPairData, IRConst.unit )
                    )
                ),
                SourceRange.unknown
            ),
            true, // isConst
            SourceRange.unknown,
            undefined, // no type-annotation range
            "zero" // source name
        )
    );

    // Value.lovelaces(): int  -- lookupCoin "" "" self
    preludeScope.program.functions.set(
        valueLovelacesName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t ], int_t ),
            ( ctx ) => {
                const self = Symbol("value_lovelaces_self");
                return new IRFunc(
                    [ self ],
                    _ir_apps(
                        IRNative.lookupCoin,
                        IRConst.bytes( new Uint8Array(0) ),
                        IRConst.bytes( new Uint8Array(0) ),
                        new IRVar( self )
                    )
                );
            },
            SourceRange.unknown
        )
    );
    // Value.amountOf( policy, name ): int  -- lookupCoin policy name self
    preludeScope.program.functions.set(
        valueAmountOfName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t, policyId_t, bytes_t ], int_t ),
            ( ctx ) => {
                const self = Symbol("value_amountOf_self");
                const policy = Symbol("value_amountOf_policy");
                const tokenName = Symbol("value_amountOf_tokenName");
                return new IRFunc(
                    [ self, policy, tokenName ],
                    _ir_apps(
                        IRNative.lookupCoin,
                        new IRVar( policy ),
                        new IRVar( tokenName ),
                        new IRVar( self )
                    )
                );
            },
            SourceRange.unknown
        )
    );
    // Value.insert( policy, name, amount ): Value -- insertCoin policy name amount self
    preludeScope.program.functions.set(
        valueInsertCoinName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t, policyId_t, bytes_t, int_t ], value_t ),
            ( ctx ) => {
                const self = Symbol("value_insert_self");
                const policy = Symbol("value_insert_policy");
                const tokenName = Symbol("value_insert_tokenName");
                const amount = Symbol("value_insert_amount");
                return new IRFunc(
                    [ self, policy, tokenName, amount ],
                    _ir_apps(
                        IRNative.insertCoin,
                        new IRVar( policy ),
                        new IRVar( tokenName ),
                        new IRVar( amount ),
                        new IRVar( self )
                    )
                );
            },
            SourceRange.unknown
        )
    );
    // Value.union( other ): Value -- unionValue self other
    preludeScope.program.functions.set(
        valueUnionName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t, value_t ], value_t ),
            ( ctx ) => IRNative.unionValue,
            SourceRange.unknown
        )
    );
    // Value.contains( other ): bool -- valueContains self other
    preludeScope.program.functions.set(
        valueContainsName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t, value_t ], bool_t ),
            ( ctx ) => IRNative.valueContains,
            SourceRange.unknown
        )
    );
    // Value.scale( factor ): Value -- scaleValue factor self
    preludeScope.program.functions.set(
        valueScaleName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t, int_t ], value_t ),
            ( ctx ) => {
                const self = Symbol("value_scale_self");
                const factor = Symbol("value_scale_factor");
                return new IRFunc(
                    [ self, factor ],
                    _ir_apps(
                        IRNative.scaleValue,
                        new IRVar( factor ),
                        new IRVar( self )
                    )
                );
            },
            SourceRange.unknown
        )
    );
    // Value.toData(): data -- valueData self
    preludeScope.program.functions.set(
        valueToDataName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t ], data_t ),
            ( ctx ) => IRNative.valueData,
            SourceRange.unknown
        )
    );

    // ------------------------------------------------------------------
    // Value arithmetic (milestone 2 stdlib expansion)
    // ------------------------------------------------------------------
    /** the empty native Value, built at runtime (no UPLC Value constant exists) */
    const mkZeroValueIR = (): IRTerm => _ir_apps(
        IRNative.unValueData,
        _ir_apps(
            IRNative.mapData,
            _ir_apps( IRNative.mkNilPairData, IRConst.unit )
        )
    );

    // Value.negate(): Value -- scaleValue -1 self
    preludeScope.program.functions.set(
        valueNegateName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t ], value_t ),
            ( ctx ) => IRNative._negateValue,
            SourceRange.unknown
        )
    );
    // Value.equals( other ): bool -- structural equality via valueData
    preludeScope.program.functions.set(
        valueEqualsName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t, value_t ], bool_t ),
            ( ctx ) => IRNative._valueEq,
            SourceRange.unknown
        )
    );
    // Value.subtract( other ): Value -- unionValue self (negate other)
    preludeScope.program.functions.set(
        valueSubtractName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t, value_t ], value_t ),
            ( ctx ) => {
                const self = Symbol("value_subtract_self");
                const other = Symbol("value_subtract_other");
                return new IRFunc(
                    [ self, other ],
                    _ir_apps(
                        IRNative.unionValue,
                        new IRVar( self ),
                        _ir_apps( IRNative._negateValue, new IRVar( other ) )
                    )
                );
            },
            SourceRange.unknown
        )
    );
    // Value.isZero(): bool -- equals the empty Value
    preludeScope.program.functions.set(
        valueIsZeroName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t ], bool_t ),
            ( ctx ) => {
                const self = Symbol("value_isZero_self");
                return new IRFunc(
                    [ self ],
                    _ir_apps(
                        IRNative._valueEq,
                        new IRVar( self ),
                        mkZeroValueIR()
                    )
                );
            },
            SourceRange.unknown
        )
    );
    // Value.geq( other ): bool -- self contains at least `other`
    // (alias of `valueContains self other`; with negative amounts in play
    // prefer explicit subtraction)
    preludeScope.program.functions.set(
        valueGeqName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t, value_t ], bool_t ),
            ( ctx ) => IRNative.valueContains,
            SourceRange.unknown
        )
    );
    // Value.leq( other ): bool -- `other` contains at least self
    preludeScope.program.functions.set(
        valueLeqName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t, value_t ], bool_t ),
            ( ctx ) => {
                const self = Symbol("value_leq_self");
                const other = Symbol("value_leq_other");
                return new IRFunc(
                    [ self, other ],
                    _ir_apps(
                        IRNative.valueContains,
                        new IRVar( other ),
                        new IRVar( self )
                    )
                );
            },
            SourceRange.unknown
        )
    );
    // std.value.singleton( policy, name, amount ): Value
    // (namespace-level constructor, no `self`)
    preludeScope.program.functions.set(
        valueSingletonName,
        new TirInlineClosedIR(
            new TirFuncT([ policyId_t, tokenName_t, int_t ], value_t ),
            ( ctx ) => {
                const policy = Symbol("value_singleton_policy");
                const name = Symbol("value_singleton_name");
                const amount = Symbol("value_singleton_amount");
                return new IRFunc(
                    [ policy, name, amount ],
                    _ir_apps(
                        IRNative.insertCoin,
                        new IRVar( policy ),
                        new IRVar( name ),
                        new IRVar( amount ),
                        mkZeroValueIR()
                    )
                );
            },
            SourceRange.unknown
        )
    );

    // ------------------------------------------------------------------
    // POSIXTime alias + AssetClass (common datum/redeemer shapes)
    // ------------------------------------------------------------------
    _defineUnambigousAlias( "POSIXTime", int_t );

    // struct AssetClass { policy: PolicyId, name: TokenName }
    const { data: assetClass_t } = defineSingleConstructorStruct(
        "AssetClass", {
            policy: policyId_t,
            name: tokenName_t
        }, onlyData
    );

    // std.value.assetClass( policy, name ): AssetClass
    // -- constructor function (bare `AssetClass{ ... }` literals of prelude
    //    structs are not constructible from user code)
    preludeScope.program.functions.set(
        assetClassConstructorName,
        new TirInlineClosedIR(
            new TirFuncT([ policyId_t, tokenName_t ], assetClass_t ),
            ( ctx ) => {
                const policy = Symbol("assetClass_policy");
                const name = Symbol("assetClass_name");
                return new IRFunc(
                    [ policy, name ],
                    _ir_apps(
                        IRNative.constrData,
                        IRConst.int( 0 ),
                        _ir_apps(
                            IRNative.mkCons,
                            _ir_apps( IRNative.bData, new IRVar( policy ) ),
                            _ir_apps(
                                IRNative.mkCons,
                                _ir_apps( IRNative.bData, new IRVar( name ) ),
                                IRConst.listOf( data_t )([])
                            )
                        )
                    )
                );
            },
            SourceRange.unknown
        )
    );

    // Value.amountOfAsset( ac: AssetClass ): int
    // -- lookupCoin (unB policy) (unB name) self; AssetClass is a data
    //    struct so its fields are data-encoded bytes
    preludeScope.program.functions.set(
        valueAmountOfAssetName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t, assetClass_t ], int_t ),
            ( ctx ) => {
                const self = Symbol("value_amountOfAsset_self");
                const ac = Symbol("value_amountOfAsset_ac");
                const acFields = Symbol("value_amountOfAsset_fields");
                return new IRFunc(
                    [ self, ac ],
                    _ir_apps(
                        new IRFunc(
                            [ acFields ],
                            _ir_apps(
                                IRNative.lookupCoin,
                                _ir_apps( IRNative.unBData, _ir_apps( IRNative.headList, new IRVar( acFields ) ) ),
                                _ir_apps( IRNative.unBData, _ir_apps( IRNative.headList, _ir_apps( IRNative.tailList, new IRVar( acFields ) ) ) ),
                                new IRVar( self )
                            )
                        ),
                        _ir_apps(
                            IRNative.sndPair,
                            _ir_apps( IRNative.unConstrData, new IRVar( ac ) )
                        )
                    )
                );
            },
            SourceRange.unknown
        )
    );


    // struct OutputDatum {
    //     NoDatum {}
    //     DatumHash { hash: Hash32 }
    //     InlineDatum { datum: data }
    // }
    const { data: outputDatum_t } = defineMultiConstructorStruct(
        "OutputDatum", {
            NoDatum: {},
            DatumHash: {
                hash: hash32_t
            },
            InlineDatum: {
                datum: data_t
            }
        }, onlyData
    );

    const { data: txOut_t } = defineSingleConstructorStruct(
        "TxOut", {
            address: address_t,
            value: value_t,
            datum: outputDatum_t,
            referenceScript: opt_scriptHash_t
        }, onlyData,
        new Map([
            [ "inlineDatum", txOutInlineDatumName ],
        ])
    );
    // struct TxIn {
    //     txOutRef: TxOutRef,
    //     resolved: TxOut
    // }
    const { data: txIn_t } = defineSingleConstructorStruct(
        "TxIn", {
            ref: txOutRef_t,
            resolved: txOut_t
        }, onlyData
    );
    // struct ExtendedInteger {
    //     NegInf {}
    //     Finite { n: int }
    //     PosInf {}
    // }
    const { data: extendedInteger_t } = defineMultiConstructorStruct(
        "ExtendedInteger", {
            NegInf: {},
            Finite: {
                n: int_t
            },
            PosInf: {}
        }, onlyData
    );
    // struct IntervalBoundary {
    //     boundary: ExtendedInteger,
    //     isInclusive: boolean
    // }
    const { data: intervalBoundary_t } = defineSingleConstructorStruct(
        "IntervalBoundary", {
            boundary: extendedInteger_t,
            isInclusive: bool_t
        }, onlyData
    );
    // struct Interval {
    //     from: IntervalBoundary,
    //     to: IntervalBoundary,
    // }
    const { data: interval_t } = defineSingleConstructorStruct(
        "Interval", {
            from: intervalBoundary_t,
            to: intervalBoundary_t
        }, onlyData,
        new Map([
            [ "lowerBoundFinite",  intervalLowerBoundFiniteName ],
            [ "upperBoundFinite",  intervalUpperBoundFiniteName ],
            [ "contains",          intervalContainsName ],
            [ "isEntirelyAfter",   intervalIsEntirelyAfterName ],
            [ "isEntirelyBefore",  intervalIsEntirelyBeforeName ],
        ])
    );
    // struct Tx {
    //     inputs: List<TxIn>,
    //     refInputs: List<TxIn>,
    //     outputs: List<TxOut>,
    //     fee: int,
    //     mint: Value,
    //     certificates: List<Certificate>,
    //     withdrawals: LinearMap<Credential, int>,
    //     validityInterval: Interval,
    //     requiredSigners: List<PubKeyHash>,
    //     redeemers: LinearMap<ScriptPurpose, data>,
    //     datums: LinearMap<Hash32, data>,
    //     hash: TxHash,
    //     votes: LinearMap<Voter, LinearMap<TxOutRef, Vote>>,
    //     proposals: List<ProposalProcedure>,
    //     currentTreasury: Optional<int>,
    //     treasuryDonation: Optional<int>
    // }
    const list_txIn_t = program.getAppliedGeneric(
        TirListT.toTirTypeKey(),
        [ txIn_t ]
    );
    if(!list_txIn_t) throw new Error("expected list_txIn_t");
    const list_txOut_t = program.getAppliedGeneric(
        TirListT.toTirTypeKey(),
        [ txOut_t ]
    );
    if(!list_txOut_t) throw new Error("expected list_txOut_t");
    const list_certificate_t = program.getAppliedGeneric(
        TirListT.toTirTypeKey(),
        [ certificate_t ]
    );
    if(!list_certificate_t) throw new Error("expected list_certificate_t");
    const list_pubKeyHash_t = program.getAppliedGeneric(
        TirListT.toTirTypeKey(),
        [ pubKeyHash_t ]
    );
    if(!list_pubKeyHash_t) throw new Error("expected list_pubKeyHash_t");
    const map_scriptPurpose_data_t = program.getAppliedGeneric(
        TirLinearMapT.toTirTypeKey(),
        [ scriptPurpose_t, data_t ]
    );
    if(!map_scriptPurpose_data_t) throw new Error("expected map_scriptPurpose_data_t");
    const map_hash32_data_t = program.getAppliedGeneric(
        TirLinearMapT.toTirTypeKey(),
        [ hash32_t, data_t ]
    );
    if(!map_hash32_data_t) throw new Error("expected map_hash32_data_t");
    const map_txOutRef_vote_t = program.getAppliedGeneric(
        TirLinearMapT.toTirTypeKey(),
        [ txOutRef_t, vote_t ]
    );
    if(!map_txOutRef_vote_t) throw new Error("expected map_txOutRef_vote_t");
    const map_voter_map_txOutRef_vote_t = program.getAppliedGeneric(
        TirLinearMapT.toTirTypeKey(),
        [ voter_t, map_txOutRef_vote_t ]
    );
    if(!map_voter_map_txOutRef_vote_t) throw new Error("expected map_voter_map_txOutRef_vote_t");
    const list_proposalProcedure_t = program.getAppliedGeneric(
        TirListT.toTirTypeKey(),
        [ proposalProcedure_t ]
    );
    if(!list_proposalProcedure_t) throw new Error("expected list_proposalProcedure_t");
    const { data: tx_t } = defineSingleConstructorStruct(
        "Tx", {
            inputs: list_txIn_t,
            refInputs: list_txIn_t,
            outputs: list_txOut_t,
            fee: int_t,
            mint: value_t,
            certificates: list_certificate_t,
            withdrawals: map_cred_int_t,
            validityInterval: interval_t,
            requiredSigners: list_pubKeyHash_t,
            redeemers: map_scriptPurpose_data_t,
            datums: map_hash32_data_t,
            hash: txHash_t,
            votes: map_voter_map_txOutRef_vote_t,
            proposals: list_proposalProcedure_t,
            currentTreasury: opt_int_t,
            treasuryDonation: opt_int_t
        }, onlyData,
        new Map([
            [ "signedBy",             txSignedByName ],
            [ "findInput",            txFindInputName ],
            [ "outputsToCredential",  txOutputsToCredentialName ],
            [ "inputsFromCredential", txInputsFromCredentialName ],
            [ "valuePaidTo",          txValuePaidToName ],
        ])
    );
    // tagged data struct ScriptContext {
    //     tx: Tx,
    //     redeemer: data,
    //     purpose: ScriptInfo
    // }
    const { data: scriptContext_t } = defineSingleConstructorStruct(
        "ScriptContext", {
            tx: tx_t,
            redeemer: data_t,
            purpose: scriptInfo_t
        }, onlyData
    );

    // ------------------------------------------------------------------
    // Script-context helper methods (milestone 2 stdlib expansion).
    //
    // All of the receivers are data structs, so `self` arrives as a raw
    // `Data` value; fields are read with unConstrData/sndPair/dropList/
    // headList by POSITION. The field indices below MUST track the struct
    // definitions above.
    // ------------------------------------------------------------------

    /** `headList( dropList( idx, sndPair( unConstrData( structIR ) ) ) )` */
    function irStructField( structIR: IRTerm, idx: number ): IRTerm
    {
        const fieldsIR = _ir_apps(
            IRNative.sndPair,
            _ir_apps( IRNative.unConstrData, structIR )
        );
        return _ir_apps(
            IRNative.headList,
            idx === 0
                ? fieldsIR
                : _ir_apps( IRNative.dropList, IRConst.int( idx ), fieldsIR )
        );
    }

    // Tx field indices (struct definition above)
    const TX_FIELD_INPUTS = 0;
    const TX_FIELD_OUTPUTS = 2;
    const TX_FIELD_VALIDITY_INTERVAL = 7;
    const TX_FIELD_REQUIRED_SIGNERS = 8;
    // TxOut: address = 0, value = 1, datum = 2
    // TxIn: ref = 0, resolved = 1
    // Address: payment = 0
    // Interval: from = 0, to = 1; IntervalBoundary: boundary = 0, isInclusive = 1
    // ExtendedInteger ctor tags: NegInf = 0, Finite = 1, PosInf = 2
    // OutputDatum ctor tags: NoDatum = 0, DatumHash = 1, InlineDatum = 2

    // Tx.signedBy( pkh: PubKeyHash ): bool
    // -- some( \d -> equalsData( d, bData pkh ), unListData( tx.requiredSigners ) )
    preludeScope.program.functions.set(
        txSignedByName,
        new TirInlineClosedIR(
            new TirFuncT([ tx_t, pubKeyHash_t ], bool_t ),
            ( ctx ) => {
                const self = Symbol("tx_signedBy_self");
                const pkh = Symbol("tx_signedBy_pkh");
                const signer = Symbol("tx_signedBy_signer");
                return new IRFunc(
                    [ self, pkh ],
                    _ir_apps(
                        IRNative._some,
                        new IRFunc(
                            [ signer ],
                            _ir_apps(
                                IRNative.equalsData,
                                new IRVar( signer ),
                                _ir_apps( IRNative.bData, new IRVar( pkh ) )
                            )
                        ),
                        _ir_apps(
                            IRNative.unListData,
                            irStructField( new IRVar( self ), TX_FIELD_REQUIRED_SIGNERS )
                        )
                    )
                );
            },
            SourceRange.unknown
        )
    );

    // Tx.findInput( ref: TxOutRef ): Optional<TxIn>
    // -- findSopOptional( \i -> equalsData( i.ref, ref ), unListData( tx.inputs ) )
    //    the SoP-Some payload stays the raw TxIn data (decode on extraction)
    {
        const sopOptTxIn_t = new TirSopOptT( txIn_t );
        preludeScope.program.functions.set(
            txFindInputName,
            new TirInlineClosedIR(
                new TirFuncT([ tx_t, txOutRef_t ], sopOptTxIn_t ),
                ( ctx ) => {
                    const self = Symbol("tx_findInput_self");
                    const ref = Symbol("tx_findInput_ref");
                    const txIn = Symbol("tx_findInput_txIn");
                    return new IRFunc(
                        [ self, ref ],
                        _ir_apps(
                            new IRNative( IRNativeTag._findSopOptional ),
                            new IRFunc(
                                [ txIn ],
                                _ir_apps(
                                    IRNative.equalsData,
                                    irStructField( new IRVar( txIn ), 0 ), // TxIn.ref
                                    new IRVar( ref ) // TxOutRef is a data struct: already raw data
                                )
                            ),
                            _ir_apps(
                                IRNative.unListData,
                                irStructField( new IRVar( self ), TX_FIELD_INPUTS )
                            )
                        )
                    );
                },
                SourceRange.unknown
            )
        );
    }

    // Tx.outputsToCredential( c: Credential ): List<TxOut>
    // -- filter( \o -> equalsData( o.address.payment, c ), unListData( tx.outputs ) )
    {
        const list_txOut_ret_t = new TirListT( txOut_t );
        preludeScope.program.functions.set(
            txOutputsToCredentialName,
            new TirInlineClosedIR(
                new TirFuncT([ tx_t, credential_t ], list_txOut_ret_t ),
                ( ctx ) => {
                    const self = Symbol("tx_outputsToCredential_self");
                    const cred = Symbol("tx_outputsToCredential_cred");
                    const out = Symbol("tx_outputsToCredential_out");
                    return new IRFunc(
                        [ self, cred ],
                        _ir_apps(
                            IRNative._filter,
                            new IRFunc(
                                [ out ],
                                _ir_apps(
                                    IRNative.equalsData,
                                    // TxOut.address (0) -> Address.payment (0)
                                    irStructField( irStructField( new IRVar( out ), 0 ), 0 ),
                                    new IRVar( cred )
                                )
                            ),
                            _ir_apps(
                                IRNative.unListData,
                                irStructField( new IRVar( self ), TX_FIELD_OUTPUTS )
                            )
                        )
                    );
                },
                SourceRange.unknown
            )
        );
    }

    // Tx.inputsFromCredential( c: Credential ): List<TxIn>
    // -- filter( \i -> equalsData( i.resolved.address.payment, c ), unListData( tx.inputs ) )
    {
        const list_txIn_ret_t = new TirListT( txIn_t );
        preludeScope.program.functions.set(
            txInputsFromCredentialName,
            new TirInlineClosedIR(
                new TirFuncT([ tx_t, credential_t ], list_txIn_ret_t ),
                ( ctx ) => {
                    const self = Symbol("tx_inputsFromCredential_self");
                    const cred = Symbol("tx_inputsFromCredential_cred");
                    const txIn = Symbol("tx_inputsFromCredential_txIn");
                    return new IRFunc(
                        [ self, cred ],
                        _ir_apps(
                            IRNative._filter,
                            new IRFunc(
                                [ txIn ],
                                _ir_apps(
                                    IRNative.equalsData,
                                    // TxIn.resolved (1) -> TxOut.address (0) -> Address.payment (0)
                                    irStructField( irStructField( irStructField( new IRVar( txIn ), 1 ), 0 ), 0 ),
                                    new IRVar( cred )
                                )
                            ),
                            _ir_apps(
                                IRNative.unListData,
                                irStructField( new IRVar( self ), TX_FIELD_INPUTS )
                            )
                        )
                    );
                },
                SourceRange.unknown
            )
        );
    }

    // Tx.valuePaidTo( addr: Address ): Value
    // -- foldr( \o acc -> o.address == addr ? acc + o.value : acc, zero, outputs )
    preludeScope.program.functions.set(
        txValuePaidToName,
        new TirInlineClosedIR(
            new TirFuncT([ tx_t, address_t ], value_t ),
            ( ctx ) => {
                const self = Symbol("tx_valuePaidTo_self");
                const addr = Symbol("tx_valuePaidTo_addr");
                const out = Symbol("tx_valuePaidTo_out");
                const acc = Symbol("tx_valuePaidTo_acc");
                return new IRFunc(
                    [ self, addr ],
                    _ir_apps(
                        IRNative._foldr,
                        new IRFunc(
                            [ out, acc ],
                            _ir_lazyIfThenElse(
                                _ir_apps(
                                    IRNative.equalsData,
                                    irStructField( new IRVar( out ), 0 ), // TxOut.address
                                    new IRVar( addr )
                                ),
                                // then: acc + o.value
                                _ir_apps(
                                    IRNative.unionValue,
                                    _ir_apps(
                                        IRNative.unValueData,
                                        irStructField( new IRVar( out ), 1 ) // TxOut.value
                                    ),
                                    new IRVar( acc )
                                ),
                                // else
                                new IRVar( acc )
                            )
                        ),
                        mkZeroValueIR(),
                        _ir_apps(
                            IRNative.unListData,
                            irStructField( new IRVar( self ), TX_FIELD_OUTPUTS )
                        )
                    )
                );
            },
            SourceRange.unknown
        )
    );

    // TxOut.inlineDatum(): Optional<data>
    // -- InlineDatum{ datum } => Some( datum ); anything else => None
    {
        const sopOptData_t = new TirSopOptT( data_t );
        preludeScope.program.functions.set(
            txOutInlineDatumName,
            new TirInlineClosedIR(
                new TirFuncT([ txOut_t ], sopOptData_t ),
                ( ctx ) => {
                    const self = Symbol("txOut_inlineDatum_self");
                    const odPair = Symbol("txOut_inlineDatum_odPair");
                    return new IRFunc(
                        [ self ],
                        _ir_apps(
                            new IRFunc(
                                [ odPair ],
                                _ir_lazyIfThenElse(
                                    _ir_apps(
                                        IRNative.equalsInteger,
                                        _ir_apps( IRNative.fstPair, new IRVar( odPair ) ),
                                        IRConst.int( 2 ) // OutputDatum.InlineDatum
                                    ),
                                    new IRConstr( 0, [ // Some{ datum } (raw data payload)
                                        _ir_apps(
                                            IRNative.headList,
                                            _ir_apps( IRNative.sndPair, new IRVar( odPair ) )
                                        )
                                    ]),
                                    new IRConstr( 1, [] ) // None
                                )
                            ),
                            _ir_apps(
                                IRNative.unConstrData,
                                irStructField( new IRVar( self ), 2 ) // TxOut.datum
                            )
                        )
                    );
                },
                SourceRange.unknown
            )
        );
    }

    // ------------------------------------------------------------------
    // Interval helpers.
    //
    // A boundary is IntervalBoundary{ boundary: ExtendedInteger, isInclusive }.
    // `mkBoundCheck` builds `\boundaryData t -> bool` deciding the
    // relation of the (possibly infinite) bound to the time `t`:
    //   - onNegInf / onPosInf are constant results;
    //   - the Finite case compares `n` to `t` with the strictness picked
    //     by `isInclusive`.
    // ------------------------------------------------------------------
    function mkBoundCheckIR(
        boundVar: symbol,
        tVar: symbol,
        onNegInf: boolean,
        onPosInf: boolean,
        /** (n, t, inclusive) -> bool, built from IR pieces */
        finiteCase: ( n: IRTerm, t: IRTerm, inclusive: IRTerm ) => IRTerm
    ): IRTerm
    {
        const extPair = Symbol("bound_extPair");
        // isInclusive: bool data (true = Constr 0, false = Constr 1)
        const inclusiveIR = _ir_apps(
            IRNative.equalsInteger,
            _ir_apps(
                IRNative.fstPair,
                _ir_apps(
                    IRNative.unConstrData,
                    irStructField( new IRVar( boundVar ), 1 )
                )
            ),
            IRConst.int( 0 )
        );
        return _ir_apps(
            new IRFunc(
                [ extPair ],
                _ir_lazyIfThenElse(
                    _ir_apps(
                        IRNative.equalsInteger,
                        _ir_apps( IRNative.fstPair, new IRVar( extPair ) ),
                        IRConst.int( 1 ) // Finite
                    ),
                    finiteCase(
                        _ir_apps(
                            IRNative.unIData,
                            _ir_apps(
                                IRNative.headList,
                                _ir_apps( IRNative.sndPair, new IRVar( extPair ) )
                            )
                        ),
                        new IRVar( tVar ),
                        inclusiveIR
                    ),
                    _ir_lazyIfThenElse(
                        _ir_apps(
                            IRNative.equalsInteger,
                            _ir_apps( IRNative.fstPair, new IRVar( extPair ) ),
                            IRConst.int( 0 ) // NegInf
                        ),
                        IRConst.bool( onNegInf ),
                        IRConst.bool( onPosInf )
                    )
                )
            ),
            _ir_apps(
                IRNative.unConstrData,
                irStructField( new IRVar( boundVar ), 0 )
            )
        );
    }

    // the function-scoped `int_t`/`bool_t` are `TirType | undefined`
    // (program.types lookups); narrowing does not reach nested function
    // declarations, so bind definite references for the helpers below
    const definite_int_t: TirType = int_t!;
    const definite_bool_t: TirType = bool_t!;

    /** extract a boundary sub-struct (`from` = 0 / `to` = 1) into a fresh IRFunc app */
    function mkIntervalBoundHelper(
        tirName: string,
        boundIdx: number,
        onNegInf: boolean,
        onPosInf: boolean,
        finiteCase: ( n: IRTerm, t: IRTerm, inclusive: IRTerm ) => IRTerm
    ): void
    {
        preludeScope.program.functions.set(
            tirName,
            new TirInlineClosedIR(
                new TirFuncT([ interval_t, definite_int_t ], definite_bool_t ),
                ( ctx ) => {
                    const self = Symbol("interval_self");
                    const t = Symbol("interval_t");
                    const bound = Symbol("interval_bound");
                    return new IRFunc(
                        [ self, t ],
                        _ir_apps(
                            new IRFunc(
                                [ bound ],
                                mkBoundCheckIR( bound, t, onNegInf, onPosInf, finiteCase )
                            ),
                            irStructField( new IRVar( self ), boundIdx )
                        )
                    );
                },
                SourceRange.unknown
            )
        );
    }

    // lazy inclusive/strict comparison: inclusive ? cmpIncl : cmpStrict
    const inclPick = ( inclusive: IRTerm, cmpIncl: IRTerm, cmpStrict: IRTerm ): IRTerm =>
        _ir_lazyIfThenElse( inclusive, cmpIncl, cmpStrict );

    // Interval.isEntirelyAfter( t ): the whole interval lies after `t`
    // -- reads the LOWER bound: Finite f => (inclusive ? f > t : f >= t)
    mkIntervalBoundHelper(
        intervalIsEntirelyAfterName, 0, /*NegInf*/ false, /*PosInf*/ true,
        ( n, t, inclusive ) => inclPick(
            inclusive,
            _ir_apps( IRNative.lessThanInteger, t, n ),      // t < f  ==  f > t
            _ir_apps( IRNative.lessThanEqualInteger, t, n )  // t <= f ==  f >= t
        )
    );
    // Interval.isEntirelyBefore( t ): the whole interval lies before `t`
    // -- reads the UPPER bound: Finite u => (inclusive ? u < t : u <= t)
    mkIntervalBoundHelper(
        intervalIsEntirelyBeforeName, 1, /*NegInf*/ true, /*PosInf*/ false,
        ( n, t, inclusive ) => inclPick(
            inclusive,
            _ir_apps( IRNative.lessThanInteger, n, t ),      // u < t
            _ir_apps( IRNative.lessThanEqualInteger, n, t )  // u <= t
        )
    );

    // Interval.lowerBoundFinite() / upperBoundFinite(): Optional<int>
    // -- Some( n ) when the bound is Finite{ n }, None on ±inf.
    //    (the Some payload stays iData — SoP optionals carry raw data)
    function mkBoundFiniteHelper( tirName: string, boundIdx: number ): void
    {
        const sopOptInt_t = new TirSopOptT( definite_int_t );
        preludeScope.program.functions.set(
            tirName,
            new TirInlineClosedIR(
                new TirFuncT([ interval_t ], sopOptInt_t ),
                ( ctx ) => {
                    const self = Symbol("interval_boundFinite_self");
                    const extPair = Symbol("interval_boundFinite_extPair");
                    return new IRFunc(
                        [ self ],
                        _ir_apps(
                            new IRFunc(
                                [ extPair ],
                                _ir_lazyIfThenElse(
                                    _ir_apps(
                                        IRNative.equalsInteger,
                                        _ir_apps( IRNative.fstPair, new IRVar( extPair ) ),
                                        IRConst.int( 1 ) // Finite
                                    ),
                                    new IRConstr( 0, [ // Some{ n } (iData payload)
                                        _ir_apps(
                                            IRNative.headList,
                                            _ir_apps( IRNative.sndPair, new IRVar( extPair ) )
                                        )
                                    ]),
                                    new IRConstr( 1, [] ) // None
                                )
                            ),
                            _ir_apps(
                                IRNative.unConstrData,
                                irStructField(
                                    irStructField( new IRVar( self ), boundIdx ),
                                    0 // IntervalBoundary.boundary
                                )
                            )
                        )
                    );
                },
                SourceRange.unknown
            )
        );
    }
    mkBoundFiniteHelper( intervalLowerBoundFiniteName, 0 );
    mkBoundFiniteHelper( intervalUpperBoundFiniteName, 1 );

    // Interval.contains( t ): bool
    // -- the lower bound admits `t` AND the upper bound admits `t`
    preludeScope.program.functions.set(
        intervalContainsName,
        new TirInlineClosedIR(
            new TirFuncT([ interval_t, int_t ], bool_t ),
            ( ctx ) => {
                const self = Symbol("interval_contains_self");
                const t = Symbol("interval_contains_t");
                const lowBound = Symbol("interval_contains_low");
                const highBound = Symbol("interval_contains_high");
                // lower admits t: NegInf => true; PosInf => false;
                //   Finite f => inclusive ? f <= t : f < t
                const lowOk = _ir_apps(
                    new IRFunc(
                        [ lowBound ],
                        mkBoundCheckIR(
                            lowBound, t, /*NegInf*/ true, /*PosInf*/ false,
                            ( n, tv, inclusive ) => inclPick(
                                inclusive,
                                _ir_apps( IRNative.lessThanEqualInteger, n, tv ),
                                _ir_apps( IRNative.lessThanInteger, n, tv )
                            )
                        )
                    ),
                    irStructField( new IRVar( self ), 0 )
                );
                // upper admits t: PosInf => true; NegInf => false;
                //   Finite u => inclusive ? t <= u : t < u
                const highOk = _ir_apps(
                    new IRFunc(
                        [ highBound ],
                        mkBoundCheckIR(
                            highBound, t, /*NegInf*/ false, /*PosInf*/ true,
                            ( n, tv, inclusive ) => inclPick(
                                inclusive,
                                _ir_apps( IRNative.lessThanEqualInteger, tv, n ),
                                _ir_apps( IRNative.lessThanInteger, tv, n )
                            )
                        )
                    ),
                    irStructField( new IRVar( self ), 1 )
                );
                return new IRFunc(
                    [ self, t ],
                    _ir_lazyIfThenElse( lowOk, highOk, IRConst.bool( false ) )
                );
            },
            SourceRange.unknown
        )
    );

    // std.list.sum( xs: List<int> ): int -- foldr addInteger 0 xs
    preludeScope.program.functions.set(
        listSumName,
        new TirInlineClosedIR(
            new TirFuncT([ new TirListT( int_t ) ], int_t ),
            ( ctx ) => {
                const xs = Symbol("list_sum_xs");
                return new IRFunc(
                    [ xs ],
                    _ir_apps(
                        IRNative._foldr,
                        IRNative.addInteger,
                        IRConst.int( 0 ),
                        new IRVar( xs )
                    )
                );
            },
            SourceRange.unknown
        )
    );

    // preludeScope.readonly();
}