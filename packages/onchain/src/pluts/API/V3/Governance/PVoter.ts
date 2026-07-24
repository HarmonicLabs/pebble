import { pstruct } from "../../../PTypes/PStruct/pstruct";
import { PCredential } from "../../V1/Address/PCredential";
import { PPubKeyHash } from "../../V1/PubKey/PPubKeyHash";

export const PVoter = pstruct({
    Committee: { hotCredentials: PCredential.type },
    DRep: { credentials: PCredential.type }, 
    StakePool: { poolHash: PPubKeyHash.type }
});