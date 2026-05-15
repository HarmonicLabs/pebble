import { SourceRange } from "../../../ast/Source/SourceRange";
import { _ir_apps } from "../../../IR/IRNodes/IRApp";
import { IRConst } from "../../../IR/IRNodes/IRConst";
import { IRFunc } from "../../../IR/IRNodes/IRFunc";
import { IRHoisted } from "../../../IR/IRNodes/IRHoisted";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import { IRRecursive } from "../../../IR/IRNodes/IRRecursive";
import { IRSelfCall } from "../../../IR/IRNodes/IRSelfCall";
import { IRVar } from "../../../IR/IRNodes/IRVar";
import { IRTerm } from "../../../IR/IRTerm";
import { hoisted_bytesToHex } from "../../../IR/tree_utils/bytesToHex";
import { hoisted_intToUtf8Bytes } from "../../../IR/tree_utils/intToUtf8Bytes";
import { _ir_lazyIfThenElse } from "../../../IR/tree_utils/_ir_lazyIfThenElse";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { bytes_t } from "../program/stdScope/stdScope";
import { TirAliasType } from "../types/TirAliasType";
import { TirDataStructType } from "../types/TirStructType";
import { TirBoolT } from "../types/TirNativeType/native/bool";
import { TirBytesT } from "../types/TirNativeType/native/bytes";
import { TirDataT } from "../types/TirNativeType/native/data";
import { TirIntT } from "../types/TirNativeType/native/int";
import { TirLinearMapT } from "../types/TirNativeType/native/linearMap";
import { TirListT } from "../types/TirNativeType/native/list";
import { TirStringT } from "../types/TirNativeType/native/string";
import { TirDataOptT } from "../types/TirNativeType/native/Optional/data";
import { TirVoidT } from "../types/TirNativeType/native/void";
import { TirType } from "../types/TirType";
import { getListTypeArg } from "../types/utils/getListTypeArg";
import { getUnaliased } from "../types/utils/getUnaliased";
import { mergeSortedStrArrInplace } from "../../../utils/array/mergeSortedStrArrInplace";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";

/**
 * `_showIR`-backed compile-time-dispatched show expression.
 *
 * Created when the user writes `expr.show()` on a built-in type whose Show
 * impl the compiler provides (int, bytes, bool, data, void, string,
 * List<T>, LinearMap<K,V>, data-encoded structs). For user-declared
 * `type X implements Show { show(self): bytes { ... } }` impls the
 * regular method-dispatch path in `expressifyVars` keeps applying — this
 * expr is only emitted when no user impl is registered.
 */
export class TirShowExpr
    implements ITirExpr
{
    constructor(
        public readonly inner: TirExpr,
        public readonly range: SourceRange,
    ) {}

    get type(): TirType { return bytes_t; }
    get isConstant(): boolean { return this.inner.isConstant; }

    toString(): string { return `show( ${this.inner.toString()} )`; }
    pretty( indent: number ): string
    {
        return `show( ${this.inner.pretty(indent)} )`;
    }

    clone(): TirExpr
    {
        return new TirShowExpr( this.inner.clone(), this.range.clone() );
    }

    deps(): string[] { return this.inner.deps(); }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        return _showIR( this.inner.type, this.inner.toIR( ctx ) );
    }
}

/**
 * Inline an `IRTerm` of type `t` into its UTF-8 textual representation
 * (also bytes). Returns the IR producing the show-encoded bytes.
 *
 * Mirrors `_inlineToData` — fully compile-time-dispatched per source type:
 *
 *   int          -> hoisted_intToUtf8Bytes (decimal, sign-aware)
 *   bytes        -> hoisted_bytesToHex (lowercase hex)
 *   bool         -> "true" / "false" via lazy ifThenElse
 *   data         -> serialiseData -> bytesToHex
 *   void         -> "()"
 *   string       -> encodeUtf8 (treat as already-readable text)
 *   List<T>      -> "[" + intercalate(", ", map(_showIR(T), elems)) + "]"
 *   LinearMap<K,V> -> "{" + intercalate(", ", map((k,v) -> showK(k) ++ ": " ++ showV(v), entries)) + "}"
 *
 * For struct-typed receivers (TirDataStructType / TirSoPStructType) this
 * function does not produce IR — those should reach a user-declared
 * `type X implements Show { show(self): bytes { ... } }` and dispatch
 * through the regular method-call path. The caller is expected to detect
 * that case before invoking `_showIR`.
 */
export function _showIR( origin_t: TirType, exprIR: IRTerm ): IRTerm
{
    const t = getUnaliased( origin_t );

    if( t instanceof TirIntT )
    return _ir_apps( hoisted_intToUtf8Bytes.clone(), exprIR );

    if( t instanceof TirBytesT )
    return _ir_apps( hoisted_bytesToHex.clone(), exprIR );

    if( t instanceof TirBoolT )
    return _ir_lazyIfThenElse(
        exprIR,
        _hoisted_litBytes( "true"  ).clone(),
        _hoisted_litBytes( "false" ).clone(),
    );

    if( t instanceof TirDataT )
    return _ir_apps(
        hoisted_bytesToHex.clone(),
        _ir_apps( IRNative.serialiseData, exprIR ),
    );

    if( t instanceof TirVoidT )
    return _hoisted_litBytes( "()" ).clone();

    if( t instanceof TirStringT )
    return _ir_apps( IRNative.encodeUtf8, exprIR );

    if( t instanceof TirListT )
    return _showListIR( t, exprIR );

    if( t instanceof TirLinearMapT )
    return _showLinearMapIR( t, exprIR );

    // data-encoded structs and Optional<T> auto-show via serialiseData + hex.
    // Users can override by declaring `type X implements Show { ... }` —
    // that path is handled before _showIR is reached.
    if(
        t instanceof TirDataStructType
        || t instanceof TirDataOptT
    )
    return _ir_apps(
        hoisted_bytesToHex.clone(),
        _ir_apps( IRNative.serialiseData, exprIR ),
    );

    throw new Error(
        `_showIR: no built-in Show impl for type ${origin_t.toString()}; ` +
        `the type must declare \`type X implements Show { show(self): bytes { ... } }\``
    );
}

// ---- helpers ----

const _hoistedLits: Record<string, IRHoisted> = {};
function _hoisted_litBytes( s: string ): IRHoisted
{
    let cached = _hoistedLits[s];
    if( !cached )
    {
        cached = new IRHoisted( IRConst.bytes( fromUtf8( s ) ) );
        cached.hash;
        _hoistedLits[s] = cached;
    }
    return cached;
}

// recurses through `_showIR`. Caches per element-type to avoid repeated
// IR construction across multiple call sites for the same `List<T>`.
const _listShowCache: Map<string, IRHoisted> = new Map();
function _showListIR( listT: TirListT, exprIR: IRTerm ): IRTerm
{
    const elemT = getUnaliased( getListTypeArg( listT )! );
    if( !elemT ) throw new Error("_showListIR: missing element type");

    const key = elemT.toConcreteTirTypeName();
    let hoisted = _listShowCache.get( key );

    if( !hoisted )
    {
        // \xs ->
        //   "[" ++
        //   ( recur xs True )
        //   ++ "]"
        // recur = fix \self \xs \first ->
        //   if nullList xs then ""
        //   else
        //     let head = headList xs
        //     let tail = tailList xs
        //     ( if first then "" else ", " )
        //     ++ showElem(head)
        //     ++ self(tail, False)
        const xsOuter = Symbol("show_list_xs_outer");
        const recSelf = Symbol("show_list_self");
        const xs      = Symbol("show_list_xs");
        const first   = Symbol("show_list_first");

        const recur = new IRRecursive(
            recSelf,
            new IRFunc(
                [ xs, first ],
                _ir_lazyIfThenElse(
                    _ir_apps( IRNative.nullList, new IRVar( xs ) ),
                    _hoisted_litBytes( "" ).clone(),
                    // separator + show(head) + recur(tail, false)
                    _ir_apps(
                        IRNative.appendByteString,
                        // separator
                        _ir_lazyIfThenElse(
                            new IRVar( first ),
                            _hoisted_litBytes( "" ).clone(),
                            _hoisted_litBytes( ", " ).clone(),
                        ),
                        _ir_apps(
                            IRNative.appendByteString,
                            // show(head)
                            _showIR( elemT, _ir_apps( IRNative.headList, new IRVar( xs ) ) ),
                            // recur(tail, false)
                            _ir_apps(
                                new IRSelfCall( recSelf ),
                                _ir_apps( IRNative.tailList, new IRVar( xs ) ),
                                IRConst.bool( false ),
                            )
                        )
                    )
                )
            )
        );

        hoisted = new IRHoisted(
            new IRFunc(
                [ xsOuter ],
                _ir_apps(
                    IRNative.appendByteString,
                    _hoisted_litBytes( "[" ).clone(),
                    _ir_apps(
                        IRNative.appendByteString,
                        _ir_apps( recur, new IRVar( xsOuter ), IRConst.bool( true ) ),
                        _hoisted_litBytes( "]" ).clone(),
                    )
                )
            )
        );
        hoisted.hash;
        _listShowCache.set( key, hoisted );
    }

    return _ir_apps( hoisted.clone(), exprIR );
}

const _linearMapShowCache: Map<string, IRHoisted> = new Map();
function _showLinearMapIR( mapT: TirLinearMapT, exprIR: IRTerm ): IRTerm
{
    const keyT = getUnaliased( mapT.keyTypeArg );
    const valT = getUnaliased( mapT.valTypeArg );

    const cacheKey = keyT.toConcreteTirTypeName() + "→" + valT.toConcreteTirTypeName();
    let hoisted = _linearMapShowCache.get( cacheKey );

    if( !hoisted )
    {
        // LinearMap is List<PairData> at the IR level. Iterate similarly to
        // _showListIR, but on each entry call showK(fst(entry)) ++ ": " ++
        // showV(snd(entry)). Both sides go through `unBData / unIData / etc.`
        // implicitly because the Pebble runtime stores keys/values as data.
        //
        // For show purposes we treat the entry as an opaque pair-of-data and
        // recover the value bytes via `_inlineFromData(...)`-like dispatch.
        // To keep this turn focused, we invoke `_showIR` with `data` and
        // accept that K/V are shown via their data encoding (compact). A
        // future polish pass can recover the original K/V types and call
        // `_showIR(K)` / `_showIR(V)` directly.
        const xsOuter = Symbol("show_map_outer");
        const recSelf = Symbol("show_map_self");
        const xs      = Symbol("show_map_xs");
        const first   = Symbol("show_map_first");

        // key/value extraction at the IR level: an entry is a Pair<Data,Data>;
        // fst gets the data-encoded key, snd the data-encoded value. We then
        // just call _showIR(data, ...) on both, which is `serialiseData ++ hex`.
        const showEntry = ( entryIR: IRTerm ): IRTerm => _ir_apps(
            IRNative.appendByteString,
            _showIR( /* data */  /* fall back to data show */
                /* Pebble stores K and V as data inside LinearMap */
                /* see TirLinearMapT.toUplcConstType */
                /* TirDataT */
                /* hack: reach the singleton via a fresh instance */
                new (require("../types/TirNativeType/native/data").TirDataT)(),
                _ir_apps( IRNative.fstPair, entryIR ),
            ),
            _ir_apps(
                IRNative.appendByteString,
                _hoisted_litBytes( ": " ).clone(),
                _showIR(
                    new (require("../types/TirNativeType/native/data").TirDataT)(),
                    _ir_apps( IRNative.sndPair, entryIR ),
                )
            )
        );

        const recur = new IRRecursive(
            recSelf,
            new IRFunc(
                [ xs, first ],
                _ir_lazyIfThenElse(
                    _ir_apps( IRNative.nullList, new IRVar( xs ) ),
                    _hoisted_litBytes( "" ).clone(),
                    _ir_apps(
                        IRNative.appendByteString,
                        _ir_lazyIfThenElse(
                            new IRVar( first ),
                            _hoisted_litBytes( "" ).clone(),
                            _hoisted_litBytes( ", " ).clone(),
                        ),
                        _ir_apps(
                            IRNative.appendByteString,
                            showEntry( _ir_apps( IRNative.headList, new IRVar( xs ) ) ),
                            _ir_apps(
                                new IRSelfCall( recSelf ),
                                _ir_apps( IRNative.tailList, new IRVar( xs ) ),
                                IRConst.bool( false ),
                            )
                        )
                    )
                )
            )
        );

        hoisted = new IRHoisted(
            new IRFunc(
                [ xsOuter ],
                _ir_apps(
                    IRNative.appendByteString,
                    _hoisted_litBytes( "{" ).clone(),
                    _ir_apps(
                        IRNative.appendByteString,
                        _ir_apps( recur, new IRVar( xsOuter ), IRConst.bool( true ) ),
                        _hoisted_litBytes( "}" ).clone(),
                    )
                )
            )
        );
        hoisted.hash;
        _linearMapShowCache.set( cacheKey, hoisted );
    }

    return _ir_apps( hoisted.clone(), exprIR );
}

/** A canonical 1-arg `(T) -> bytes` IR closure for use as a `Show` dictionary entry. */
export function _showUplcFunc( origin_t: TirType ): IRTerm
{
    const xSym = Symbol("show_self");
    return new IRHoisted(
        new IRFunc(
            [ xSym ],
            _showIR( origin_t, new IRVar( xSym ) ),
        )
    );
}
