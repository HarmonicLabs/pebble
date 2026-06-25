import { IRHoisted } from "../../IRNodes/IRHoisted";
import { IRLetted } from "../../IRNodes/IRLetted";
import { IRNative } from "../../IRNodes/IRNative";
import { IRTerm } from "../../IRTerm";
import { _modifyChildFromTo } from "./_modifyChildFromTo";
import { iterTree } from "./iterTree";

export function _makeAllNegativeNativesHoisted( term: IRTerm ): void
{
    iterTree( term, elem => {
        if(
            elem instanceof IRNative
            // already wrapped in a sharing container
            && !(elem.parent instanceof IRHoisted)
            // A native that is the direct value of an `IRLetted` is already
            // shared via the letting mechanism, and crucially `IRLetted.value`
            // UNWRAPS any `IRHoisted` assigned to it (see IRLetted.set value).
            // Wrapping such a native therefore never "sticks" — the wrapper is
            // immediately stripped back to the bare native and we'd loop
            // forever re-wrapping it. Leave it letted.
            && !(elem.parent instanceof IRLetted)
        )
        {
            _modifyChildFromTo(
                elem.parent,
                elem,
                new IRHoisted( elem )
            );
            return true;
        }
    })
}