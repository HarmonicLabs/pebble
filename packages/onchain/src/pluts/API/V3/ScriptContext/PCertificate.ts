import { pstruct } from "../../../PTypes/PStruct/pstruct";
import { PMaybe } from "../../../lib/std/PMaybe/PMaybe";
import { int } from "../../../type_system/types";
import { PCredential } from "../../V1/Address/PCredential";
import { PPubKeyHash } from "../../V1/PubKey/PPubKeyHash";
import { PDelegatee } from "./PDelegatee";

const PMaybeInt = PMaybe( int );

export const PCertificate = pstruct({
    StakeRegistration: {
        stakeKey: PCredential.type,
        deposit: PMaybeInt.type
    },
    StakeDeRegistration: {
        stakeKey: PCredential.type,
        refound: PMaybeInt.type
    },
    Delegation: {
        delegator: PCredential.type,
        delegatee: PDelegatee.type
    },
    RegistrationAndDelegation: {
        delegator: PCredential.type,
        delegatee: PDelegatee.type,
        lovelacesDeposit: int
    },
    DRepRegistration: {
        drep: PCredential.type,
        lovelacesDeposit: int
    },
    DRepUpdate: {
        drep: PCredential.type
    },
    DRepDeRegistration: {
        drep: PCredential.type,
        refound: int
    },
    PoolRegistration: {
        poolId: PPubKeyHash.type,
        poolVFR: PPubKeyHash.type,
    },
    PoolRetire: {
        poolId: PPubKeyHash.type,
        epoch: int,
    },
    CommitteeHotAuthorization: {
        cold: PCredential.type,
        hot: PCredential.type
    },
    CommitteeResignation: {
        cold: PCredential.type
    }
});