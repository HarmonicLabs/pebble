import { pstruct } from "../../../../PTypes/PStruct/pstruct";
import { list, pair, int, data, map } from "../../../../type_system";
import { PValue } from "../../../V1/Value/PValue";
import { PDCert } from "../../../V1/PDCert";
import { PPOSIXTimeRange } from "../../../V1/Time";
import { PPubKeyHash } from "../../../V1/PubKey/PPubKeyHash";
import { PDatumHash } from "../../../V1/ScriptsHashes/PDatumHash";
import { PTxInInfo } from "../../Tx/PTxInInfo";
import { PTxOut } from "../../../V2/Tx/PTxOut";
import { PMaybe } from "../../../../lib/std/PMaybe/PMaybe";
import { PTxId } from "../../Tx/PTxId";
import { PVoter } from "../../Governance/PVoter";
import { PTxOutRef } from "../../Tx/PTxOutRef";
import { PVote } from "../../Governance/PVote";
import { PProposalProcedure } from "../../Governance/PProposalProcedure";
import { PCredential } from "../../../V1/Address/PCredential";
import { PScriptPurpose } from "../PScriptPurpose";
   
export const PTxInfo = pstruct({
    PTxInfo: {
        inputs: list( PTxInInfo.type ),
        refInputs: list( PTxInInfo.type ),
        outputs: list( PTxOut.type ),
        fee:  int, // lovelaces
        /** mint has no lovelaces entry */
        mint: PValue.type,
        certificates: list( PDCert.type ),
        withdrawals: map( PCredential.type, int ),
        interval: PPOSIXTimeRange.type,
        signatories: list( PPubKeyHash.type ),
        redeemers: map( PScriptPurpose.type, data ),
        datums: map( PDatumHash.type, data ),
        id: PTxId.type,
        votes: map( PVoter.type, map( PTxOutRef.type, PVote.type ) ),
        proposalProcedures: list( PProposalProcedure.type ),
        currentTreasury: PMaybe( int ).type,
        treasuryDonation: PMaybe( int ).type,
    }
});