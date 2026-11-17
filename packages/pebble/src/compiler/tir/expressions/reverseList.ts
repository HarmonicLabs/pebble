import { SourceRange } from "../../../ast/Source/SourceRange";
import { _ir_apps } from "../../../IR/IRNodes/IRApp";
import { IRConst } from "../../../IR/IRNodes/IRConst";
import { IRFunc } from "../../../IR/IRNodes/IRFunc";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import { IRNativeTag } from "../../../IR/IRNodes/IRNative/IRNativeTag";
import { IRVar } from "../../../IR/IRNodes/IRVar";
import type { IRTerm } from "../../../IR/IRTerm";
import { TirFuncT } from "../types/TirNativeType";
import { TirListT } from "../types/TirNativeType/native/list";
import { TirType } from "../types/TirType";
import { TirInlineClosedIR } from "./TirInlineClosedIR";

/**
 * `( xs: List<elem> ) => List<elem>`, the elements last first, as IR:
 * `foldl ( acc, x ) => mkCons x acc` from the empty list of `elems_t`.
 *
 * One definition for the two ways to write it: the function `std.list.reverse( xs )`
 * and the method `xs.reverse()` (which a linear map has too: it is a list of
 * pairs underneath).
 */
export function reverseListIR( elems_t: TirType ): IRTerm
{
    const xs = Symbol("list_reverse_xs");
    const acc = Symbol("list_reverse_acc");
    const x = Symbol("list_reverse_x");
    return new IRFunc(
        [ xs ],
        _ir_apps(
            new IRNative( IRNativeTag._foldl ),
            new IRFunc(
                [ acc, x ],
                _ir_apps(
                    new IRNative( IRNativeTag.mkCons ),
                    new IRVar( x ),
                    new IRVar( acc )
                )
            ),
            IRConst.listOf( elems_t )([]),
            new IRVar( xs )
        )
    );
}

/** `xs.reverse()` on a list of `elems_t`: the function the method call applies to its receiver */
export function tirReverseList( elems_t: TirType ): TirInlineClosedIR
{
    const list_t = new TirListT( elems_t );
    return new TirInlineClosedIR(
        new TirFuncT([ list_t ], list_t ),
        () => reverseListIR( elems_t ),
        SourceRange.unknown
    );
}
