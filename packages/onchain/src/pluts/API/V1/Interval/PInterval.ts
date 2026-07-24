import { pstruct } from "../../../PTypes/PStruct/pstruct";
import { PBound } from "./PBound";

export const PInterval = pstruct({
    PInterval: {
        from: PBound.type,
        to: PBound.type
    }
});