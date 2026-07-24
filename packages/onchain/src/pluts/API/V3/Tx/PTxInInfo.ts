import { pstruct } from "../../../PTypes/PStruct/pstruct";
import { PTxOut } from "../../V2/Tx/PTxOut";
import { PTxOutRef } from "./PTxOutRef";

export const PTxInInfo = pstruct({
    PTxInInfo: {
        utxoRef: PTxOutRef.type,
        resolved: PTxOut.type
    }
});