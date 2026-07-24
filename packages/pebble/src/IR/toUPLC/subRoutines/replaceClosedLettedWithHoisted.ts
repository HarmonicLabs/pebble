import { IRHoisted } from "../../IRNodes/IRHoisted";
import { containsExpensiveWork } from "./handleLetted/isSafeToFloatOutOfLambda";
import { IRLetted } from "../../IRNodes/IRLetted";
import { IRTerm } from "../../IRTerm";
import { isClosedIRTerm } from "../../utils/isClosedIRTerm";
import { _modifyChildFromTo } from "../_internal/_modifyChildFromTo";
import { iterTree } from "../_internal/iterTree";

export function replaceClosedLettedWithHoisted( root: IRTerm )
{
    iterTree( root, (node) => {
        if(
            node instanceof IRLetted
            && isClosedIRTerm( node.value )
            // EXPENSIVE closed values (hash-grade work) must NOT be hoisted
            // to the root: hoisted bindings evaluate on EVERY execution,
            // including dispatch arms that never use them (a closed
            // sha256-of-14KB `initialCid` taxed every masterpiece method
            // ~350M CPU). Left as letted, the per-branch duplication binds
            // them once per referencing arm instead.
            && !containsExpensiveWork( node.value )
        )
        {
            _modifyChildFromTo(
                node.parent,
                node,
                new IRHoisted(
                    node.value,
                    node.meta
                )
            );
            return true;
        }
    });
}
