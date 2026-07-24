import { PMaybe } from "../../../lib";
import { pstruct } from "../../../PTypes/PStruct/pstruct";
import { int, list, map } from "../../../type_system/types";
import { PCredential } from "../../V1/Address/PCredential";
import { PValidatorHash } from "../../V1/ScriptsHashes/PValidatorHash";
import { PTxOutRef } from "../Tx/PTxOutRef";
import { PChangedParams } from "./PChangedParams";
import { PProtocolVersion } from "./PProtocolVersion";

export const PRational = pstruct({
    PRational: {
        numerator: int,
        denominator: int
    }
});

export const PConstitution = pstruct({
    PConstitution: {
        constitutionScriptHash: PMaybe( PValidatorHash.type ).type
    }
});

export const PGovernanceAction = pstruct({
    ParameterChange: {
        govActionId: PMaybe( PTxOutRef.type ).type,
        changedParameters: PChangedParams.type,
        constitutionScriptHash: PMaybe( PValidatorHash.type ).type
    },
    HardForkInitiation: {
        govActionId: PMaybe( PTxOutRef.type ).type,
        nextProtocolVersion: PProtocolVersion.type
    },
    TreasuryWithdrawals: {
        withdrawals: map( PCredential.type, int ),
        constitutionScriptHash: PMaybe( PValidatorHash.type ).type
    },
    NoConfidence: {
        govActionId: PMaybe( PTxOutRef.type ).type
    },
    UpdateCommittee: {
        govActionId: PMaybe( PTxOutRef.type ).type,
        removedMembers: list( PCredential.type ),
        newMembers: map( PCredential.type, int ),
        newQuorum: PRational.type
    },
    NewConstitution: {
        govActionId: PMaybe( PTxOutRef.type ).type,
        consitution: PConstitution.type
    },
    InfoAction: {}
});