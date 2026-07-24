import { pstruct } from "../../../PTypes/PStruct/pstruct";
import { bool } from "../../../type_system/types";
import { PExtended } from "./PExtended";

export const PBound = pstruct({
    PBound: {
        bound: PExtended.type,
        inclusive: bool 
    }
});