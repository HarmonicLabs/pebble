/*
export const preludeTypesSrc = 
`export type Hash32 = bytes;
export type Hash28 = bytes;
export type PolicyId = Hash28;
export type TokenName = bytes;
export type PubKeyHash = Hash28;
export type ScriptHash = Hash28;
export type TxHash = Hash32;

export struct TxOutRef {
    id: TxHash,
    index: int,
}

export struct Credential {
    PubKey { hash: PubKeyHash }
    Script { hash: ScriptHash }
}

type Credential implements {
    hash(): bytes
    {
        // return case this
        //     is PubKey{ hash } => hash
        //     is Script{ hash } => hash;
        return builtin.unBData(
            builtin.unConstrData( this ).snd.head
        );
    }
}

export type ChangedParameters = LinearMap<int,data>;

export struct Rational {
    numerator: int,
    denominator: int
}

export struct ProtocolVersion {
    major: int,
    minor: int
}

export struct ConstitutionInfo {
    consitutionScriptHash: Optional<ScriptHash>
}

export struct GovAction {
    ParameterChange {
        govActionId: Optional<TxOutRef>,
        changedParameters: ChangedParameters,
        constitutionScriptHash: Optional<ScriptHash>
    }
    HardForkInitiation {
        govActionId: Optional<TxOutRef>,
        nextProtocolVersion: ProtocolVersion
    }
    TreasuryWithdrawals {
        withdrawals: LinearMap<Credential, int>
        constitutionScriptHash: Optional<ScriptHash>
    }
    NoConfidence {
        govActionId: Optional<TxOutRef>
    }
    UpdateCommittee {
        govActionId: Optional<TxOutRef>,
        removed: List<Credential>,
        newMembers: LinearMap<Credential, int>,
        newQuorum: Rational
    }
    NewConstitution {
        govActionId: Optional<TxOutRef>,
        info: ConstitutionInfo
    }
    InfoAction {}
}

export struct ProposalProcedure {
    deposit: int,
    credential: Credential,
    action: GovAction
}

export struct Voter {
    Committee {
        credential: Credential
    }
    DRep {
        credential: Credential
    }
    StakePool {
        pubKeyHash: PubKeyHash
    }
}

export struct ScriptPurpose {
    Mint { policy: PolicyId }
    Spend {
        ref: TxOutRef,
        optionalDatum: Optional<data>
    }
    Withdraw {
        credential: Credential
    }
    Certificate {
        index: int,
        certificate: Certificate
    }
    Vote {
        voter: Voter
    }
    Propose {
        index: int,
        proposal: ProposalProcedure
    }
}

export struct ScriptInfo {
    Mint { policy: PolicyId }
    Spend {
        ref: TxOutRef,
        datum: Optional<data>
    }
    Withdraw {
        credential: Credential
    }
    Certificate {
        index: int,
        certificate: Certificate
    }
    Vote {
        voter: Voter
    }
    Propose {
        index: int,
        proposal: ProposalProcedure
    }
}

export struct StakeCredential {
    Credential { credential: Credential }
    Ptr {
        a: int,
        b: int,
        c: int
    }
}

export struct Address {
    payment: Credential,
    stake: Optional<Credential>
}

export type ValueMap = LinearMap<PolicyId, LinearMap<TokenName, int>>

type ValueMap implements {
    amountOf( policy: PolicyId, name: bytes ): int
    {
        // todo
        fail;
    }
    lovelaces(): int
    {
        return this.amountOf( #, # );
    }
}

// `Value` is a native Plutus V4 built-in value (ConstTyTag.value).
// It is reached from `data` via `unValueData`; the ledger always passes data.
type Value implements {
    amountOf( policy: PolicyId, name: bytes ): int
    {
        return native.lookupCoin( policy, name, this );
    }
    lovelaces(): int
    {
        return this.amountOf( #, # );
    }
    insert( policy: PolicyId, name: bytes, amount: int ): Value
    {
        return native.insertCoin( policy, name, amount, this );
    }
    union( other: Value ): Value
    {
        return native.unionValue( this, other );
    }
    contains( other: Value ): bool
    {
        return native.valueContains( this, other );
    }
    scale( factor: int ): Value
    {
        return native.scaleValue( factor, this );
    }
    toData(): data
    {
        return native.valueData( this );
    }
}

export struct OutputDatum {
    NoDatum {}
    DatumHash { hash: Hash32 }
    InlineDatum { datum: data }
}

export struct TxOut {
    address: Address,
    value: Value,
    datum: OutputDatum,
    referenceScript: Optional<ScriptHash>
}

export struct TxIn {
    ref: TxOutRef,
    resolved: TxOut
}

export struct ExtendedInteger {
    NegInf {}
    Finite { n: int }
    PosInf {}
}

export struct IntervalBoundary {
    boundary: ExtendedInteger,
    isInclusive: boolean
}

export struct Interval {
    from: IntervalBoundary,
    to: IntervalBoundary,
}

export struct Vote {
    No {}
    Yes {}
    Abstain {}
}

export struct Delegatee {
    StakePool { poolKeyHash: PubKeyHash }
    DRep { drep: Credential }
    PoolAndDRep {
        poolKeyHash: PubKeyHash,
        drep: Credential
    }
}

export struct Certificate {
    StakeRegistration {
        stakeKey: Credential,
        deposit: Optional<int>
    }
    StakeDeRegistration {
        stakeKey: Credential,
        refund: Optional<int>
    }
    Delegation {
        delegator: Credential,
        delegatee: Delegatee
    }
    RegistrationAndDelegation {
        delegator: Credential,
        delegatee: Delegatee,
        lovelacesDeposit: int
    }
    DRepRegistration {
        drep: Credential,
        lovelacesDeposit: int
    }
    DRepUpdate {
        drep: Credential
    }
    DRepDeRegistration {
        drep: Credential,
        refund: int
    }
    PoolRegistration {
        poolId: PubKeyHash,
        poolVRF: bytes
    }
    PoolRetire {
        poolId: PubKeyHash,
        epoch: int
    }
    CommitteeHotAuthorization {
        cold: Credential,
        hot: Credential
    }
    CommitteeResignation {
        cold: Credential
    }
} 

export struct Tx {
    inputs: List<TxIn>,
    refInputs: List<TxIn>,
    outputs: List<TxOut>,
    fee: int,
    mint: Value,
    certificates: List<Certificate>,
    withdrawals: LinearMap<Credential, int>,
    validityInterval: Interval,
    requiredSigners: List<PubKeyHash>,
    redeemers: LinearMap<ScriptPurpose, data>,
    datums: LinearMap<Hash32, data>,
    hash: TxHash,
    votes: LinearMap<Voter, LinearMap<TxOutRef, Vote>>,
    proposals: List<ProposalProcedure>,
    currentTreasury: Optional<int>,
    treasuryDonation: Optional<int>
}

export struct ScriptContext {
    tx: Tx,
    redeemer: data,
    purpose: ScriptInfo
}`;
//*/