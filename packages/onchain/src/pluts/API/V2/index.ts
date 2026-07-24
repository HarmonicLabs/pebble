// export * from "./ScriptContext/PScriptContext";
// export * from "./ScriptContext/PTxInfo/PTxInfo";
export * from "./Tx/POutputDatum";
export * from "./Tx/PTxOut";
// export * from "./Tx/PTxInInfo";

import { V1 } from "../V1";
import { PScriptContext } from "./ScriptContext/PScriptContext";
import { PTxInfo } from "./ScriptContext/PTxInfo/PTxInfo";
import { POutputDatum } from "./Tx/POutputDatum";
import { PTxOut } from "./Tx/PTxOut";
import { PTxInInfo } from "./Tx/PTxInInfo";

export const V2 = Object.freeze({
    ...V1,

    PScriptContext,
    PTxInfo,

    POutputDatum,
    PTxInInfo,
    PTxOut
});