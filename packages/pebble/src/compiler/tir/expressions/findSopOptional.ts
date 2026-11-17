import { SourceRange } from "../../../ast/Source/SourceRange";
import { _ir_apps } from "../../../IR/IRNodes/IRApp";
import { IRCase } from "../../../IR/IRNodes/IRCase";
import { IRConstr } from "../../../IR/IRNodes/IRConstr";
import { IRFunc } from "../../../IR/IRNodes/IRFunc";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import { IRNativeTag } from "../../../IR/IRNodes/IRNative/IRNativeTag";
import { IRVar } from "../../../IR/IRNodes/IRVar";
import type { IRTerm } from "../../../IR/IRTerm";
import { TirFuncT } from "../types/TirNativeType";
import { TirBoolT } from "../types/TirNativeType/native/bool";
import { TirListT } from "../types/TirNativeType/native/list";
import { TirLinearMapEntryT } from "../types/TirNativeType/native/linearMapEntry";
import { TirPairDataT } from "../types/TirNativeType/TirNativeType";
import { getUnaliased } from "../types/utils/getUnaliased";
import { TirSopOptT } from "../types/TirNativeType/native/Optional/sop";
import { TirType } from "../types/TirType";
import { TirInlineClosedIR } from "./TirInlineClosedIR";
import { TirNativeFunc } from "./TirNativeFunc";
import { _toDataUplcFunc } from "./TirToDataExpr";

/** `( predicate: ( elem ) => boolean, list: List<elem> ) => Optional<elem>` */
export function findSopOptionalType( elems_t: TirType ): TirFuncT
{
    return new TirFuncT([
        new TirFuncT([ elems_t ], new TirBoolT() ),
        new TirListT( elems_t )
    ], new TirSopOptT( elems_t ));
}

/**
 * `find` over a list of `elems_t`, as IR.
 *
 * SoP optional convention: `Some` wraps RAW DATA, and every consumer (`case`,
 * `match`, a destructuring `const Some{ value } = ...`) decodes the payload on
 * extraction — see `TirCaseExpr._sopStructToIR`.
 *
 * The hoisted finder (`_findSopOptional`) knows nothing about types: its
 * `Some{ head }` holds the element as the list holds it. That is data only
 * when the list's elements are data-represented (`List<TxIn>`, `List<data>`).
 * The elements of a `List<int>`, a `List<bytes>`, ... are native, so the
 * element found has to be encoded before it becomes a `Some` payload; without
 * it every consumer died with "unIData :: not data value". `std.list.at`
 * encodes its element the same way.
 */
/**
 * `true` iff a list of `elems_t` holds its elements as data already (`List<TxIn>`,
 * `List<data>`): what the finder finds is a `Some` payload as it is
 */
function elementsAreData( elems_t: TirType ): boolean
{
    // The entries of a map are pairs of data. A pair has no data form of its own,
    // and the consumers of an `Optional<entry>` take the `Some` payload as the
    // pair it is (`_inlineFromData`: "LinearMapEntry is Pair<Data,Data> at runtime
    // — no conversion needed"). So the entry found is the payload, as it is.
    const unaliased = getUnaliased( elems_t );
    if(
        unaliased instanceof TirPairDataT
        || unaliased instanceof TirLinearMapEntryT
    ) return true;

    const toData = _toDataUplcFunc( elems_t );
    return toData instanceof IRNative && toData.tag === IRNativeTag._id;
}

export function _findSopOptionalIR( elems_t: TirType ): IRTerm
{
    const find = new IRNative( IRNativeTag._findSopOptional );
    // the elements are data already: the finder's `Some{ head }` is right as it is
    if( elementsAreData( elems_t ) ) return find;

    const toData = _toDataUplcFunc( elems_t );
    const predicate = Symbol("find_predicate");
    const list = Symbol("find_list");
    const found = Symbol("find_found");
    return new IRFunc(
        [ predicate, list ],
        new IRCase(
            _ir_apps( find, new IRVar( predicate ), new IRVar( list ) ),
            [
                // Some{ toData( found ) }
                new IRFunc( [ found ], new IRConstr( 0, [ _ir_apps( toData, new IRVar( found ) ) ] ) ),
                // None
                new IRConstr( 1, [] )
            ]
        )
    );
}

/**
 * the `find` of a list of `elems_t`, as a TIR expression to call.
 *
 * For elements that are data it is the bare native, exactly as it was before the
 * elements' type mattered: the passes after this one know a native in function position
 * (and specialize its application), which a closed term wrapping it hides from them.
 */
export function tirFindSopOptional( elems_t: TirType, range: SourceRange = SourceRange.unknown ): TirNativeFunc | TirInlineClosedIR
{
    if( elementsAreData( elems_t ) )
    return new TirNativeFunc(
        IRNativeTag._findSopOptional,
        findSopOptionalType( elems_t )
    );

    return new TirInlineClosedIR(
        findSopOptionalType( elems_t ),
        () => _findSopOptionalIR( elems_t ),
        range
    );
}
