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
import { IRFunc } from "../../../../IR/IRNodes/IRFunc";
import { IRVar } from "../../../../IR/IRNodes/IRVar";
import { _ir_apps } from "../../../../IR/IRNodes/IRApp";

export const void_t = new TirVoidT();
export const int_t = new TirIntT();
export const string_t = new TirStringT();
export const bytes_t = new TirBytesT();
export const bool_t = new TirBoolT();
export const data_t = new TirDataT();

export const valueLovelacesName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "sortedValueLovelaces";
export const valueAmountOfName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "amountOfValue";

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
    _defineStdUnambigous( int_t );
    _defineStdUnambigous( bytes_t );
    _defineStdUnambigous( string_t );
    _defineStdUnambigous( data_t );

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
        const { sop, data } = mkSingleConstructorStruct( name, fields );
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
    const getCredentialHashFuncName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + "getCredentialHash";
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
    // type Value = LinearMap<PolicyId, LinearMap<TokenName, int>>
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
    const value_t = _defineUnambigousAlias(
        "Value",
        map_policyId_map_tokenName_int_t,
        new Map([
            [
                "lovelaces",
                valueLovelacesName
            ],
            [
                "amountOf",
                valueAmountOfName
            ],
        ])
    );
    preludeScope.program.functions.set(
        valueLovelacesName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t ], int_t ),
            ( ctx ) => IRNative._sortedValueLovelaces,
            SourceRange.unknown
        )
    );
    // Value.amountOf( policy: PolicyId, name: bytes ): int
    // The IR native _amountOfValue is curried as: (isPolicy)(value)(isTokenName) => int
    // where isPolicy and isTokenName are equality-check predicates.
    // This wrapper adapts (self, policy, tokenName) => _amountOfValue(p => equalsByteString(p, policy))(self)(tn => equalsByteString(tn, tokenName))
    preludeScope.program.functions.set(
        valueAmountOfName,
        new TirInlineClosedIR(
            new TirFuncT([ value_t, policyId_t, bytes_t ], int_t ),
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

    /* // TODO
    untagged struct FlatValueEntry {
        policy: PolicyId,
        name: bytes,
        amount: int
    }

    type FlatValue = List<FlatValueEntry>;

    type Value implements {
        amountOf( policy: PolicyId, name: bytes ): int
        {
            return native.valueAmountOf( this, policy, name );
        }
        lovelaces(): int
        {
            return this.amountOf( #, # );
        }
        flatten(): FlatValue
        {
            return native.flattenValue( this );
        }
    }

    type FlatValue implements {
        unflatten(): Value
        {
            return native.unflattenValue( this );
        }
    }
    */
    
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
        }, onlyData
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
        }, onlyData
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
        }, onlyData
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

    // preludeScope.readonly();
}