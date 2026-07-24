import { pstruct } from "../../../PTypes/PStruct/pstruct";
import { int } from "../../../type_system";
import { PCredential } from "../../V1/Address/PCredential";
import { PGovernanceAction } from "./PGovernanceAction";

export const PProposalProcedure = pstruct({
    PProposalProcedure: {
        /** lovelaces */
        deposit: int,
        returnCredentials: PCredential.type,
        governanceAction: PGovernanceAction.type
    }
});