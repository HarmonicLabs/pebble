import { pstruct } from "../../../PTypes/PStruct/pstruct";
import { data } from "../../../type_system";
import { PScriptInfo } from "./PScriptInfo";
import { PTxInfo } from "./PTxInfo";

export const PScriptContext = pstruct({
    PScriptContext: {
        tx: PTxInfo.type,
        redeemer: data,
        purpose: PScriptInfo.type
    }
});