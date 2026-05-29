import { IRCase } from "../IRNodes/IRCase";
import { IRFunc } from "../IRNodes/IRFunc";
import type { IRTerm } from "../IRTerm";

/**
 * case list of
 *   h::t -> caseCons   (h, t are bound only if `consParams` is provided)
 *   []   -> caseNil
 *
 * Lowers to UPLC `Case`. Branches are naturally lazy, so callers
 * should pass plain (un-delayed) expressions — no `force` is needed around
 * the result.
 */
export function _ir_caseList(
    listTerm: IRTerm,
    caseNil: IRTerm,
    caseCons: IRTerm,
    consParams?: { head: symbol; tail: symbol }
): IRCase
{
    const h = consParams?.head ?? Symbol("_caseList_h");
    const t = consParams?.tail ?? Symbol("_caseList_t");
    return new IRCase(
        listTerm,
        [
            new IRFunc( [ h, t ], caseCons ),
            caseNil
        ]
    );
}
