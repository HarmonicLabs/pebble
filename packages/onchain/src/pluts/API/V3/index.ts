import { V2 } from "../V2";

export * from "./Governance";
export * from "./ScriptContext";
export * from "./Tx";

import { PChangedParams, PDrep, PGovernanceAction, PProposalProcedure, PProtocolVersion, PVote, PVoter, PConstitution, PRational } from "./Governance";
import { PCertificate, PDelegatee, PScriptContext, PScriptInfo, PScriptPurpose, PTxInfo } from "./ScriptContext";
import { PTxId, PTxInInfo, PTxOutRef } from "./Tx";

export const V3 = Object.freeze({
    ...V2,

    PChangedParams, PDrep, PGovernanceAction, PProposalProcedure, PProtocolVersion, PVote, PVoter, PConstitution, PRational,
    PCertificate, PDelegatee, PScriptContext, PScriptInfo, PScriptPurpose, PTxInfo,
    PTxId, PTxInInfo, PTxOutRef
});


