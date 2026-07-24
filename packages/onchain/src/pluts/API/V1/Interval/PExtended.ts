import { palias } from "../../../PTypes/PAlias/palias";
import { pstruct } from "../../../PTypes/PStruct/pstruct";
import { pInt } from "../../../lib/std/int";
import { int } from "../../../type_system";

export const PExtended = pstruct({
    PNegInf: {},
    PFinite: { n: int },
    PPosInf: {}
});


const PPOSIXTime = palias( int )

PPOSIXTime.from( pInt( 1 ) )