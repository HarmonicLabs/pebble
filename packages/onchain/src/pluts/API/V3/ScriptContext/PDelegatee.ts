import { pstruct } from "../../../PTypes/PStruct/pstruct";
import { PPubKeyHash } from "../../V1/PubKey/PPubKeyHash";
import { PDrep } from "../Governance/PDRep";

export const PDelegatee = pstruct({
    DelegStake: { poolId: PPubKeyHash.type },
    DelegVote: { drep: PDrep.type },
    DelegStakeVote: { poolId: PPubKeyHash.type, drep: PDrep.type }
});