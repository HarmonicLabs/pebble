import { pstruct } from "../../../PTypes/PStruct/pstruct";
import { int } from "../../../type_system/types";

export const PProtocolVersion = pstruct({
    PProtocolVersion: {
        major: int,
        minor: int
    }
});