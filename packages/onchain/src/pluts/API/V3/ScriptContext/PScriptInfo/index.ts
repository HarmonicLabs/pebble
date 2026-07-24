import { PMaybe } from "../../../../lib/std/PMaybe/PMaybe";
import { pstruct } from "../../../../PTypes/PStruct/pstruct";
import { data, int } from "../../../../type_system/types";
import { PCredential } from "../../../V1/Address/PCredential";
import { PCurrencySymbol } from "../../../V1/Value/PCurrencySymbol";
import { PProposalProcedure } from "../../Governance/PProposalProcedure";
import { PVoter } from "../../Governance/PVoter";
import { PTxOutRef } from "../../Tx/PTxOutRef";
import { PCertificate } from "../PCertificate";

export const PScriptInfo = pstruct({
    Minting: { currencySym: PCurrencySymbol.type },
    Spending: {
        utxoRef: PTxOutRef.type,
        datum: PMaybe( data ).type
    },
    Rewarding: { stakeCredential: PCredential.type },
    Certifying: {
        index: int,
        cert: PCertificate.type
    },
    Voting: {
        voter: PVoter.type
    },
    Proposing: {
        index: int,
        proposal: PProposalProcedure.type
    }
});