import { pstruct } from "../../../PTypes/PStruct/pstruct";
import { int } from "../../../type_system/types";
import { PTxId } from "./PTxId";

export const PTxOutRef = pstruct({
    PTxOutRef: {
        id: PTxId.type,
        index: int
    }
});