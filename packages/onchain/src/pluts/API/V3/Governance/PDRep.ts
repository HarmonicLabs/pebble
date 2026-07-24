import { pstruct } from "../../../PTypes";
import { PCredential } from "../../V1/Address/PCredential";

export const PDrep = pstruct({
    DRep: { credentials: PCredential.type },
    AlwaysAbstain: {},
    AlwaysNoConfidence: {}
});