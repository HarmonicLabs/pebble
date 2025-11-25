import { DataConstr } from "@harmoniclabs/plutus-data";
import { IRApp } from "../../../IRNodes/IRApp";
import { IRConst } from "../../../IRNodes/IRConst";
import { IRDelayed } from "../../../IRNodes/IRDelayed";
import { IRForced } from "../../../IRNodes/IRForced";
import { IRFunc } from "../../../IRNodes/IRFunc";
import { IRHoisted } from "../../../IRNodes/IRHoisted";
import { IRNative } from "../../../IRNodes/IRNative";
import { IRNativeTag } from "../../../IRNodes/IRNative/IRNativeTag";
import { IRVar } from "../../../IRNodes/IRVar";
import { IRTerm } from "../../../IRTerm";
import { IRRecursive } from "../../../IRNodes/IRRecursive";
import { IRSelfCall } from "../../../IRNodes/IRSelfCall";
import { IRError } from "../../../IRNodes/IRError";
import { _ir_apps } from "../../../IRNodes/IRApp";
import { _ir_let, _ir_let_sym } from "../../../tree_utils/_ir_let";
import { _ir_lazyChooseList } from "../../../tree_utils/_ir_lazyChooseList";
import { _ir_lazyIfThenElse } from "../../../tree_utils/_ir_lazyIfThenElse";
import { hoisted_drop4, hoisted_drop2, hoisted_drop3 } from "../_comptimeDropN";
import { IRCase, IRConstr } from "../../../IRNodes";
import { _ir_and, _ir_or } from "../../../../compiler/tir/expressions/binary/TirBinaryExpr";

function _ir_strictAnd( left: IRTerm, right: IRTerm ): IRTerm
{
    return _ir_apps(
        IRNative.strictIfThenElse,
        left,
        right,
        IRConst.bool( false )
    );
}

const id_arg_sym = Symbol("id_arg");
export const hoisted_id = new IRHoisted(
    new IRFunc( [ id_arg_sym ], new IRVar( id_arg_sym ) )
);
hoisted_id.hash;

export const hoisted_not = new IRHoisted(
    (() => {
        const someBool = Symbol("someBool");
        return new IRFunc(
            [ someBool ],
            _ir_apps(
                IRNative.strictIfThenElse,
                new IRVar( someBool ),
                IRConst.bool( false ),
                IRConst.bool( true )
            )
        );
    })()
);
hoisted_not.hash;

export const hoisted_incr = new IRHoisted(
    new IRApp( IRNative.addInteger, IRConst.int( 1 ) )
);
hoisted_incr.hash;

export const hoisted_decr = new IRHoisted(
    new IRApp( IRNative.addInteger, IRConst.int( -1 ) )
);
hoisted_decr.hash;

export const hoisted_isZero = new IRHoisted(
    new IRApp( IRNative.equalsInteger, IRConst.int( 0 ) )
);
hoisted_isZero.hash;

export const hoisted_isOne = new IRHoisted(
    new IRApp( IRNative.equalsInteger, IRConst.int( 1 ) )
);
hoisted_isZero.hash;

export const hoisted_isTwo = new IRHoisted(
    new IRApp( IRNative.equalsInteger, IRConst.int( 2 ) )
);
hoisted_isTwo.hash;

export const hoisted_isThree = new IRHoisted(
    new IRApp( IRNative.equalsInteger, IRConst.int( 3 ) )
);

export const hoisted_addOne = new IRHoisted(
    new IRApp( IRNative.addInteger, IRConst.int( 1 ) )
);
hoisted_addOne.hash;

export const hoisted_subOne = new IRHoisted(
    new IRApp( IRNative.addInteger, IRConst.int( -1 ) )
);
hoisted_subOne.hash;

export const hoisted_negateInteger = new IRHoisted(
    new IRApp( IRNative.subtractInteger, IRConst.int( 0 ) )
);
hoisted_negateInteger.hash;

export const hoisted_isPositive = new IRHoisted(
    new IRApp( IRNative.lessThanInteger, IRConst.int( 0 ) )
);
hoisted_isPositive.hash;

export const hoisted_isNonNegative = new IRHoisted(
    new IRApp( IRNative.lessThanEqualInteger, IRConst.int( 0 ) )
);
hoisted_isNonNegative.hash;

export const hoisted_matchList = new IRHoisted(
    (() => {
        const delayed_matchNil = Symbol("delayed_matchNil");
        const matchCons = Symbol("matchCons");
        const list = Symbol("list");
        return new IRFunc(
            [ delayed_matchNil, matchCons, list ],
            new IRForced(
                new IRForced(
                    _ir_apps(
                        IRNative.strictChooseList,
                        new IRVar( list ),
                        new IRVar( delayed_matchNil ),
                        new IRDelayed(
                            _ir_apps(
                                new IRVar( matchCons ),
                                new IRApp( IRNative.headList, new IRVar( list ) ),
                                new IRApp( IRNative.tailList, new IRVar( list ) ),
                            )
                        )
                    )
                )
            )
        );
    })()
);
hoisted_matchList.hash;


//*
// hoisted_recursiveList (needed by hoisted_foldr)
const recList_matchNil = Symbol("matchNil");
const recList_matchCons = Symbol("matchCons");
const recList_self = Symbol("recursiveList_self");
const recList_lst = Symbol("lst");
export const hoisted_recursiveList = new IRHoisted(
    new IRFunc(
        [ recList_matchNil, recList_matchCons ],
        new IRRecursive(
            recList_self,
            new IRFunc(
                [ recList_lst ],
                _ir_apps(
                    hoisted_matchList.clone(),
                    new IRApp( new IRVar( recList_matchNil ), new IRSelfCall( recList_self ) ),
                    new IRApp( new IRVar( recList_matchCons ), new IRSelfCall( recList_self ) ),
                    new IRVar( recList_lst ),
                )
            )
        )
    )
);
hoisted_recursiveList.hash;
//*/

// hoisted_foldr
const foldr_reducer = Symbol("reduceFunc");
const foldr_acc = Symbol("accumulator");
const foldr__dummy = Symbol("_self");
const foldr_self = Symbol("self");
const foldr_head = Symbol("head");
const foldr_tail = Symbol("tail");
export const hoisted_foldr = new IRHoisted(
    new IRFunc(
        [ foldr_reducer, foldr_acc ],
        _ir_apps(
            hoisted_recursiveList.clone(),
            new IRFunc(
                [ foldr__dummy ],
                new IRDelayed( new IRVar( foldr_acc ) )
            ),
            new IRFunc(
                [ foldr_self, foldr_head, foldr_tail ],
                _ir_apps(
                    new IRVar( foldr_reducer ),
                    new IRVar( foldr_head ),
                    new IRApp(
                        new IRVar( foldr_self ),
                        new IRVar( foldr_tail )
                    )
                )
            )
        )
    )
);
hoisted_foldr.hash;

export const hosited_lazyChooseList = new IRHoisted(
    (() => {
        const list = Symbol("list");
        const delayed_caseNil = Symbol("delayed_caseNil");
        const delayed_caseCons = Symbol("delayed_caseCons");
        return new IRFunc(
            [ list, delayed_caseNil, delayed_caseCons ],
            new IRForced(
                _ir_apps(
                    IRNative.strictChooseList,
                    new IRVar( list ),
                    new IRVar( delayed_caseNil ),
                    new IRVar( delayed_caseCons )
                )
            )
        );
    })()
);
hosited_lazyChooseList.hash;
//*/

export const hoisted_isMoreThanOrEqualTo4 = new IRHoisted(
    _ir_apps(
        IRNative.lessThanInteger,
        IRConst.int( 4 ),
    )
);
hoisted_isMoreThanOrEqualTo4.hash;

export const hoisted_sub4 = new IRHoisted(
    _ir_apps(
        IRNative.addInteger,
        IRConst.int( -4 ),
    )
);
hoisted_sub4.hash;

const self_length = Symbol("self_length");
const length_list_sym = Symbol("length_list_sym");
export const hoisted_length = new IRHoisted(
    new IRRecursive(
        self_length,
        new IRFunc(
            [ length_list_sym ],
            _ir_lazyChooseList(
                new IRVar( length_list_sym ),
                IRConst.int( 0 ),
                _ir_apps(
                    hoisted_incr.clone(),
                    new IRApp(
                        new IRSelfCall( self_length ), // self
                        new IRApp(
                            IRNative.tailList,
                            new IRVar( length_list_sym )  // list
                        )
                    )
                )
            )
        )
    )
);
hoisted_length.hash;

// REPLACED hoisted_dropList (was numeric arity + dbn)
const drop_self = Symbol("drop_self");
const drop_n = Symbol("n");
const drop_lst = Symbol("lst");
export const hoisted_dropList = new IRHoisted(
    new IRRecursive(
        drop_self,
        new IRFunc(
            [ drop_n, drop_lst ],
            _ir_lazyIfThenElse(
                _ir_apps( hoisted_isMoreThanOrEqualTo4.clone(), new IRVar( drop_n ) ),
                _ir_apps(
                    new IRSelfCall( drop_self ),
                    _ir_apps( hoisted_sub4.clone(), new IRVar( drop_n ) ),
                    _ir_apps( hoisted_drop4.clone(), new IRVar( drop_lst ) )
                ),
                _ir_lazyIfThenElse(
                    _ir_apps( hoisted_isZero.clone(), new IRVar( drop_n ) ),
                    new IRVar( drop_lst ),
                    _ir_lazyIfThenElse(
                        _ir_apps( hoisted_isOne.clone(), new IRVar( drop_n ) ),
                        _ir_apps( IRNative.tailList, new IRVar( drop_lst ) ),
                        _ir_lazyIfThenElse(
                            _ir_apps( hoisted_isTwo.clone(), new IRVar( drop_n ) ),
                            _ir_apps( hoisted_drop2.clone(), new IRVar( drop_lst ) ),
                            _ir_apps( hoisted_drop3.clone(), new IRVar( drop_lst ) )
                        )
                    )
                )
            )
        )
    )
);
hoisted_dropList.hash;

const MAX_WORD4 = 0xFFFFFFFF;

// Added missing symbols & refactored hoisted_sizeofPositiveInt if previously numeric
const sizeof_self = Symbol("sizeofPositiveInt_self");
const sizeof_n = Symbol("n");
const sizeof_countWords = Symbol("count_words");
export const hoisted_sizeofPositiveInt = new IRHoisted(
    _ir_apps(
        new IRRecursive(
            sizeof_self,
            new IRFunc(
                [ sizeof_n, sizeof_countWords ],
                new IRForced(_ir_apps(
                    IRNative.strictIfThenElse,
                    _ir_apps( hoisted_isZero.clone(), new IRVar( sizeof_n ) ),
                    new IRDelayed(
                        new IRForced(_ir_apps(
                            IRNative.strictIfThenElse,
                            _ir_apps( hoisted_isZero.clone(), new IRVar( sizeof_countWords ) ),
                            new IRDelayed( IRConst.int( 4 ) ),
                            new IRDelayed(
                                _ir_apps(
                                    IRNative.multiplyInteger,
                                    IRConst.int( 4 ),
                                    new IRVar( sizeof_countWords )
                                )
                            )
                        ))
                    ),
                    new IRDelayed(
                        _ir_apps(
                            new IRSelfCall( sizeof_self ),
                            _ir_apps( hoisted_addOne.clone(), new IRVar( sizeof_countWords ) ),
                            _ir_apps(
                                IRNative.divideInteger,
                                new IRVar( sizeof_n ),
                                IRConst.int( MAX_WORD4 )
                            )
                        )
                    )
                ))
            )
        ),
        IRConst.int( 0 ),
    )
);

const foldl_reduce = Symbol("reduceFunc");
const foldl_self = Symbol("foldl_self");
const foldl_acc = Symbol("accum");
const foldl_head = Symbol("head");
const foldl_tail = Symbol("tail");
const hoiseted_foldl = new IRHoisted(
    new IRFunc(
        [ foldl_reduce ],
        new IRRecursive(
            foldl_self,
            new IRFunc(
                [ foldl_acc ],
                _ir_apps(
                    hoisted_matchList.clone(),
                    new IRDelayed( new IRVar( foldl_acc ) ),
                    new IRFunc(
                        [ foldl_head, foldl_tail ],
                        _ir_apps(
                            new IRSelfCall( foldl_self ),
                            _ir_apps(
                                new IRVar( foldl_reduce ),
                                new IRVar( foldl_acc ),
                                new IRVar( foldl_head ),
                            ),
                            new IRVar( foldl_tail )
                        )
                    )
                )
            )
        )
    )
);
hoiseted_foldl.hash;

// hoisted _findSopOptional
// (predicate: (a -> Bool)) -> (list: [a]) -> Optional<a>
const findSop_predicate = Symbol("predicate");
const findSop_self = Symbol("findOpt_self");
const findSop_list = Symbol("list");
const findSop_head = Symbol("head");
export const hoisted_findSopOptional = new IRHoisted(
    new IRFunc(
        [ findSop_predicate ],
        new IRRecursive(
            findSop_self,
            new IRFunc(
                [ findSop_list ],
                _ir_lazyChooseList(
                    new IRVar( findSop_list ),
                    // case nil
                    new IRConstr( 1, [] ), // None
                    // case cons
                    new IRFunc(
                        [ findSop_head ],
                        _ir_lazyIfThenElse(
                            _ir_apps(
                                new IRVar( findSop_predicate ),
                                new IRVar( findSop_head )
                            ),
                            // then => Some(head)
                            new IRConstr( 1, [ new IRVar( findSop_head ) ] ), // Some{ head }
                            // else => self(tail)
                            _ir_apps(
                                new IRSelfCall( findSop_self ),
                                _ir_apps(
                                    IRNative.tailList,
                                    new IRVar( findSop_list )
                                )
                            )
                        )
                    )
                )
            )
        )
    )
);
hoisted_findSopOptional.hash;

// hoisted _mkFindDataOptional
const mkFind_elemToData = Symbol("elemToData");
const mkFind_pred = Symbol("predicate");
const mkFind_self = Symbol("findOpt_self");
const mkFind_list = Symbol("list");
const mkFind_head = Symbol("head");
export const hoisted_mkFindDataOptional = new IRHoisted(
    new IRFunc(
        [ mkFind_elemToData, mkFind_pred ],
        new IRRecursive(
            mkFind_self,
            new IRFunc(
                [ mkFind_list ],
                new IRForced(
                    _ir_apps(
                        new IRApp( IRNative.strictChooseList, new IRVar( mkFind_list ) ),
                        new IRDelayed( IRConst.data( new DataConstr( 1, [] ) ) ),
                        new IRDelayed(
                            new IRApp(
                                new IRFunc(
                                    [ mkFind_head ],
                                    new IRForced(
                                        _ir_apps(
                                            IRNative.strictIfThenElse,
                                            new IRApp(
                                                new IRVar( mkFind_pred ),
                                                new IRVar( mkFind_head )
                                            ),
                                            new IRDelayed(
                                                _ir_apps(
                                                    IRNative.constrData,
                                                    IRConst.int( 0 ),
                                                    new IRApp(
                                                        new IRVar( mkFind_elemToData ),
                                                        new IRVar( mkFind_head )
                                                    )
                                                )
                                            ),
                                            new IRDelayed(
                                                new IRApp(
                                                    new IRSelfCall( mkFind_self ),
                                                    new IRApp(
                                                        IRNative.tailList,
                                                        new IRVar( mkFind_list )
                                                    )
                                                )
                                            )
                                        )
                                    )
                                ),
                                new IRApp(
                                    IRNative.headList,
                                    new IRVar( mkFind_list )
                                )
                            )
                        )
                    )
                )
            )
        )
    )
);
hoisted_mkFindDataOptional.hash;

// hoisted strictAnd / strictOr
const strictAnd_a = Symbol("a");
const strictAnd_b = Symbol("b");
export const hoisted_strictAnd = new IRHoisted(
    new IRFunc(
        [ strictAnd_a, strictAnd_b ],
        _ir_apps(
            IRNative.strictIfThenElse,
            new IRVar( strictAnd_a ),
            new IRVar( strictAnd_b ),
            IRConst.bool( false )
        )
    )
);
hoisted_strictAnd.hash;

const strictOr_a = Symbol("a");
const strictOr_b = Symbol("b");
export const hoisted_strictOr = new IRHoisted(
    new IRFunc(
        [ strictOr_a, strictOr_b ],
        _ir_apps(
            IRNative.strictIfThenElse,
            new IRVar( strictOr_a ),
            IRConst.bool( true ),
            new IRVar( strictOr_b )
        )
    )
);
hoisted_strictOr.hash;

// hoisted _some
const some_pred = Symbol("predicate");
const some_lst = Symbol("lst");
const some_self = Symbol("self");
export const hoisted_some = new IRHoisted(
    new IRFunc(
        [ some_pred ],
        new IRRecursive(
            some_self,
            new IRFunc(
                [ some_lst ],
                _ir_lazyChooseList(
                    new IRVar( some_lst ),
                    IRConst.bool( false ), // case nil => false
                    _ir_or(
                        // either predicate(head) is true
                        _ir_apps(
                            new IRVar( some_pred ),
                            new IRApp(
                                IRNative.headList,
                                new IRVar( some_lst )
                            )
                        ),
                        // or self(tail) is true
                        _ir_apps(
                            new IRSelfCall( some_self ),
                            new IRApp(
                                IRNative.tailList,
                                new IRVar( some_lst )
                            )
                        )
                    )
                )
            )
        )
    )
);
hoisted_some.hash;

// hoisted _every
const every_pred = Symbol("predicate");
const every_self = Symbol("self");
const every_lst = Symbol("lst");
export const hoisted_every = new IRHoisted(
    new IRFunc(
        [ every_pred ],
        new IRRecursive(
            every_self,
            new IRFunc(
                [ every_lst ],
                _ir_lazyChooseList(
                    new IRVar( every_lst ),
                    IRConst.bool( true ), // case nil => true
                    _ir_and(
                        // both predicate(head) is true
                        _ir_apps(
                            new IRVar( every_pred ),
                            new IRApp(
                                IRNative.headList,
                                new IRVar( every_lst )
                            )
                        ),
                        // AND self(tail) is true
                        _ir_apps(
                            new IRSelfCall( every_self ),
                            new IRApp(
                                IRNative.tailList,
                                new IRVar( every_lst )
                            )
                        )
                    )
                )
            )
        )
    )
);
hoisted_every.hash;

// hoisted _filter
const filt_pred = Symbol("predicate");
const filt_self = Symbol("filter_self");
const filt_list = Symbol("list");
const filt_elem = Symbol("elem");
export const hoisted_filter = new IRHoisted(
    new IRFunc(
        [ filt_pred ],
        new IRRecursive(
            filt_self,
            new IRFunc(
                [ filt_list ],
                _ir_lazyChooseList(
                    new IRVar( filt_list ),
                    // case nil
                    new IRVar( filt_list ), // nil
                    // case cons
                    _ir_let_sym(
                        filt_elem,
                        _ir_apps( IRNative.headList, new IRVar( filt_list ) ),
                        _ir_lazyIfThenElse(
                            _ir_apps(
                                new IRVar( filt_pred ),
                                new IRVar( filt_elem )
                            ),
                            // then => cons(elem, self(tail))
                            _ir_apps(
                                IRNative.mkCons,
                                new IRVar( filt_elem ),
                                _ir_apps(
                                    new IRSelfCall( filt_self ),
                                    _ir_apps(
                                        IRNative.tailList,
                                        new IRVar( filt_list )
                                    )
                                )
                            ),
                            // else => self(tail)
                            _ir_apps(
                                new IRSelfCall( filt_self ),
                                _ir_apps(
                                    IRNative.tailList,
                                    new IRVar( filt_list )
                                )
                            )
                        )
                    )
                )
            )
        )
    )
);
hoisted_filter.hash;

// comparison & conversion hoisted (previously inline)
const gtbs_a = Symbol("a"), gtbs_b = Symbol("b");
export const hoisted_gtBS = new IRHoisted(
    new IRFunc(
        [ gtbs_a, gtbs_b ],
        _ir_apps(
            IRNative.lessThanByteString,
            new IRVar( gtbs_b ),
            new IRVar( gtbs_a ),
        )
    )
);
hoisted_gtBS.hash;

const gteqbs_a = Symbol("a"), gteqbs_b = Symbol("b");
export const hoisted_gtEqBS = new IRHoisted(
    new IRFunc(
        [ gteqbs_a, gteqbs_b ],
        _ir_apps(
            IRNative.lessThanEqualsByteString,
            new IRVar( gteqbs_b ),
            new IRVar( gteqbs_a ),
        )
    )
);
hoisted_gtEqBS.hash;

const gt_a = Symbol("a"), gt_b = Symbol("b");
export const hoisted_gtInt = new IRHoisted(
    new IRFunc(
        [ gt_a, gt_b ],
        _ir_apps(
            IRNative.lessThanInteger,
            new IRVar( gt_b ),
            new IRVar( gt_a ),
        )
    )
);
hoisted_gtInt.hash;

const gteq_a = Symbol("a"), gteq_b = Symbol("b");
export const hoisted_gtEqInt = new IRHoisted(
    new IRFunc(
        [ gteq_a, gteq_b ],
        _ir_apps(
            IRNative.lessThanEqualInteger,
            new IRVar( gteq_b ),
            new IRVar( gteq_a ),
        )
    )
);
hoisted_gtEqInt.hash;

const s2d_str = Symbol("str");
export const hoisted_strToData = new IRHoisted(
    new IRFunc(
        [ s2d_str ],
        new IRApp(
            IRNative.bData,
            new IRApp(
                IRNative.encodeUtf8,
                new IRVar( s2d_str )
            )
        )
    )
);
hoisted_strToData.hash;

const pdt_pair = Symbol("pair");
export const hoisted_pairDataToData = new IRHoisted(
    new IRFunc(
        [ pdt_pair ],
        new IRApp(
            IRNative.listData,
            _ir_apps(
                IRNative.mkCons,
                new IRApp( IRNative.fstPair, new IRVar( pdt_pair ) ),
                _ir_apps(
                    IRNative.mkCons,
                    new IRApp( IRNative.sndPair, new IRVar( pdt_pair ) ),
                    new IRApp( IRNative.mkNilData, IRConst.unit )
                )
            )
        )
    )
);
hoisted_pairDataToData.hash;

const dataStr = Symbol("data");
export const hoisted_strFromData = new IRHoisted(
    new IRFunc(
        [ dataStr ],
        new IRApp(
            IRNative.decodeUtf8,
            new IRApp(
                IRNative.unBData,
                new IRVar( dataStr )
            )
        )
    )
);
hoisted_strFromData.hash;

const pdfd_data = Symbol("data");
const pdfd_unlisted = Symbol("unlisted_data");
export const hoisted_pairDataFromData = new IRHoisted(
    new IRFunc(
        [ pdfd_data ],
        new IRApp(
            new IRFunc(
                [ pdfd_unlisted ],
                _ir_apps(
                    IRNative.mkPairData,
                    new IRApp( IRNative.headList, new IRVar( pdfd_unlisted ) ),
                    new IRApp(
                        IRNative.headList,
                        new IRApp(
                            IRNative.tailList,
                            new IRVar( pdfd_unlisted )
                        )
                    )
                )
            ),
            new IRApp(
                IRNative.unListData,
                new IRVar( pdfd_data )
            )
        )
    )
);
hoisted_pairDataFromData.hash;

const boolSym = Symbol("bool");
export const hoisted_boolToInt = new IRHoisted(
    new IRFunc(
        [ boolSym ],
        _ir_apps(
            IRNative.strictIfThenElse,
            new IRVar( boolSym ),
            IRConst.int( 1 ),
            IRConst.int( 0 )
        )
    )
);
hoisted_boolToInt.hash;

const intSym = Symbol("int");
export const hoisted_intToBytesBE = new IRHoisted(
    new IRFunc(
        [ intSym ],
        _ir_apps(
            IRNative.integerToByteString,
            IRConst.bool( true ),
            _ir_apps(
                hoisted_sizeofPositiveInt.clone(),
                new IRVar( intSym )
            ),
            new IRVar( intSym )
        )
    )
);
hoisted_intToBytesBE.hash;

// hoisted exponentiateInteger
const baseSym = Symbol("base");
const expSym = Symbol("exponent");
const exp_self = Symbol("expInt_self");
const nSym = Symbol("n");
const xSym = Symbol("x");
export const hoisted_exponentiateInteger = new IRHoisted(
    new IRFunc(
        [ baseSym, expSym ],
        new IRForced(_ir_apps(
            IRNative.strictIfThenElse,
            _ir_apps( hoisted_isNonNegative.clone(), new IRVar( expSym ) ),
            new IRDelayed(
                new IRRecursive(
                    exp_self,
                    new IRFunc(
                        [ nSym, xSym ],
                        new IRForced(_ir_apps(
                            IRNative.strictIfThenElse,
                            _ir_apps( hoisted_isZero.clone(), new IRVar( nSym ) ),
                            new IRDelayed( IRConst.int( 1 ) ),
                            new IRDelayed(
                                new IRForced(_ir_apps(
                                    IRNative.strictIfThenElse,
                                    _ir_apps( hoisted_isOne.clone(), new IRVar( nSym ) ),
                                    new IRDelayed( new IRVar( xSym ) ),
                                    new IRDelayed(
                                        new IRForced(_ir_apps(
                                            IRNative.strictIfThenElse,
                                            _ir_apps(
                                                hoisted_isZero.clone(),
                                                _ir_apps(
                                                    IRNative.modInteger,
                                                    new IRVar( nSym ),
                                                    IRConst.int( 2 )
                                                )
                                            ),
                                            new IRDelayed(
                                                _ir_let(
                                                    _ir_apps(
                                                        new IRSelfCall( exp_self ),
                                                        new IRVar( xSym ),
                                                        _ir_apps(
                                                            IRNative.divideInteger,
                                                            new IRVar( nSym ),
                                                            IRConst.int( 2 )
                                                        )
                                                    ),
                                                    halfSym => _ir_apps(
                                                        IRNative.multiplyInteger,
                                                        new IRVar( halfSym ),
                                                        new IRVar( halfSym )
                                                    )
                                                )
                                            ),
                                            new IRDelayed(
                                                _ir_apps(
                                                    IRNative.multiplyInteger,
                                                    new IRVar( xSym ),
                                                    _ir_apps(
                                                        new IRSelfCall( exp_self ),
                                                        new IRVar( xSym ),
                                                        _ir_apps(
                                                            hoisted_subOne.clone(),
                                                            new IRVar( nSym )
                                                        )
                                                    )
                                                )
                                            )
                                        ))
                                    )
                                ))
                            )
                        ))
                    )
                )
            ),
            new IRDelayed( new IRError() )
        ))
    )
);
hoisted_exponentiateInteger.hash;


// already external: hoiseted_foldl

export function nativeToIR( native: IRNative ): IRTerm
{
    // positive natives are translated to uplc builtins (no need to hoist)
    if( native.tag >= 0 ) return native;

    switch( native.tag )
    {
        case IRNativeTag._foldr: return hoisted_foldr.clone();
        case IRNativeTag._foldl: return hoiseted_foldl.clone();
        // case IRNativeTag._mkFindDataOptional: return hoisted_mkFindDataOptional.clone();
        case IRNativeTag._findSopOptional: return hoisted_findSopOptional.clone();
        case IRNativeTag._length: return hoisted_length.clone();
        case IRNativeTag._some: return hoisted_some.clone();
        case IRNativeTag._every: return hoisted_every.clone();
        case IRNativeTag._filter: return hoisted_filter.clone();
        case IRNativeTag._id: return hoisted_id.clone();
        case IRNativeTag._not: return hoisted_not.clone();
        case IRNativeTag._strictAnd: return hoisted_strictAnd.clone();
        case IRNativeTag._strictOr: return hoisted_strictOr.clone();
        case IRNativeTag._gtBS: return hoisted_gtBS.clone();
        case IRNativeTag._gtEqBS: return hoisted_gtEqBS.clone();
        case IRNativeTag._gtInt: return hoisted_gtInt.clone();
        case IRNativeTag._gtEqInt: return hoisted_gtEqInt.clone();
        case IRNativeTag._strToData: return hoisted_strToData.clone();
        case IRNativeTag._pairDataToData: return hoisted_pairDataToData.clone();
        case IRNativeTag._strFromData: return hoisted_strFromData.clone();
        case IRNativeTag._pairDataFromData: return hoisted_pairDataFromData.clone();
        case IRNativeTag._boolToInt: return hoisted_boolToInt.clone();
        case IRNativeTag._intToBytesBE: return hoisted_intToBytesBE.clone();
        case IRNativeTag._intToBool: return hoisted_isNonNegative.clone();
        case IRNativeTag._exponentiateInteger: return hoisted_exponentiateInteger.clone();
        case IRNativeTag._amountOfValue: return hoisted_amountOfValue.clone();
        case IRNativeTag._isZero: return hoisted_isZero.clone();
        case IRNativeTag._sortedValueLovelaces: return hoisted_sortedValueLovelaces.clone();
        case IRNativeTag._getCredentialsHash: return hoisted_getCredentialsHash.clone();
        case IRNativeTag._dropList: return hoisted_dropList.clone();
        case IRNativeTag._mkMapList: return hoisted_mkMapList.clone();
        case IRNativeTag._increment: return hoisted_addOne.clone();
        case IRNativeTag._decrement: return hoisted_subOne.clone();
        // case IRNativeTag._bytesToIntBE: ;
        // case IRNativeTag._equalBoolean: ;
        // case IRNativeTag._equalPairData: ;
        case IRNativeTag._mkEqualsList: return hoisted_mkEqualsList.clone();
        case IRNativeTag._negateInt: return hoisted_negateInteger.clone();
        // case IRNativeTag._mkEqualsList: return hoisted_mkEqualsList.clone();
        default:
        throw new Error(
            "unknown (negative) native calling 'nativeToIR'; "+
            "number: " + native.tag + "; name: " + IRNativeTag[ native.tag ]
        );
    }
}

// ( a => b => bool ) => [a] => [b] => bool
const eqList_eqFunc = Symbol("elemEq");
const eqList_self = Symbol("eqList_self");
const eqList_listA = Symbol("listA");
const eqList_listB = Symbol("listB");
export const hoisted_mkEqualsList = new IRHoisted(
    new IRFunc(
        [ eqList_eqFunc ],
        new IRRecursive(
            eqList_self,
            new IRFunc(
                [ eqList_listA, eqList_listB ],
                _ir_lazyChooseList(
                    new IRVar( eqList_listA ),
                    // case nil: check if listB is also nil
                    _ir_apps(
                        IRNative.nullList,
                        new IRVar( eqList_listB )
                    ),
                    // case cons
                    _ir_lazyChooseList(
                        new IRVar( eqList_listB ),
                        // listB is nil => false
                        IRConst.bool( false ),
                        // both lists are cons
                        _ir_strictAnd(
                            _ir_apps(
                                new IRVar( eqList_eqFunc ),
                                new IRApp(
                                    IRNative.headList,
                                    new IRVar( eqList_listA )
                                ),
                                new IRApp(
                                    IRNative.headList,
                                    new IRVar( eqList_listB )
                                )
                            ),
                            _ir_apps(
                                new IRSelfCall( eqList_self ),
                                new IRApp(
                                    IRNative.tailList,
                                    new IRVar( eqList_listA )
                                ),
                                new IRApp(
                                    IRNative.tailList,
                                    new IRVar( eqList_listB )
                                )
                            )
                        )
                    )
                )
            )
        )
    )
);
hoisted_mkEqualsList.hash;

// (nil of type) [b] => ( a => b ) => [a] => [b]
const mkMap_nil = Symbol("nilOfType");
const mkMap_mapFunc = Symbol("mapFunc");
const mkMap_map = Symbol("map_self");
const mkMap_list = Symbol("list");
export const hoisted_mkMapList = new IRHoisted(
    new IRFunc(
        [ mkMap_nil, mkMap_mapFunc ],
        new IRRecursive(
            mkMap_map,
            new IRFunc(
                [ mkMap_list ],
                _ir_lazyChooseList(
                    new IRVar( mkMap_list ),
                    // case nil: return nil of type
                    new IRVar( mkMap_nil ),
                    // case cons
                    _ir_apps(
                        IRNative.mkCons,
                        // mapFunc( head list )
                        _ir_apps(
                            new IRVar( mkMap_mapFunc ),
                            new IRApp(
                                IRNative.headList,
                                new IRVar( mkMap_list )
                            )
                        ),
                        // recurse tail
                        _ir_apps(
                            new IRSelfCall( mkMap_map ),
                            new IRApp(
                                IRNative.tailList,
                                new IRVar( mkMap_list )
                            )
                        )
                    )
                )
            )
        )
    )
);
hoisted_mkMapList.hash;

const credHash_credentials = Symbol("credentials");
export const hoisted_getCredentialsHash = new IRHoisted(
    new IRFunc(
        [ credHash_credentials ],
        _ir_apps(
            IRNative.unBData,
            _ir_apps(
                IRNative.headList,
                _ir_apps(
                    IRNative.sndPair,
                    _ir_apps(
                        IRNative.unConstrData,
                        new IRVar( credHash_credentials )
                    )
                )
            )
        )
    )
);
hoisted_getCredentialsHash.hash;

// If _sortedValueLovelaces was previously inline, hoist it:
const sorted_value = Symbol("value");
export const hoisted_sortedValueLovelaces = new IRHoisted(
    new IRFunc(
        [ sorted_value ],
        _ir_apps(
            IRNative.unIData,
            _ir_apps(
                IRNative.sndPair,
                _ir_apps(
                    IRNative.headList,
                    _ir_apps(
                        IRNative.unMapData,
                        _ir_apps(
                            IRNative.sndPair,
                            _ir_apps(
                                IRNative.headList,
                                new IRVar( sorted_value )
                            )
                        )
                    )
                )
            )
        )
    )
);
hoisted_sortedValueLovelaces.hash;


// ((policy => bool), value, (tokenName => bool)) => amount
// REPLACED hoisted_amountOfValue (symbol-based)
const amount_isPolicy = Symbol("isPolicy");
const amount_policyLoop = Symbol("policyLoop_self");
const amount_value = Symbol("value");
const amount_isTokenName = Symbol("isTokenName");
const amount_tokenNameLoop = Symbol("tokenNameLoop_self");
const amount_tokenMap = Symbol("tokenMap");

export const hoisted_amountOfValue = new IRHoisted(
    new IRFunc(
        [ amount_isPolicy ], // (policy => bool)
        new IRRecursive(
            amount_policyLoop,
            new IRFunc(
                [ amount_value ], // value
                new IRForced(_ir_apps(
                    IRNative.strictChooseList,
                    new IRVar( amount_value ),
                    // case nil: return (tokenName => 0)
                    new IRDelayed(
                        new IRFunc( [ amount_isTokenName ], IRConst.int( 0 ) )
                    ),
                    // case cons
                    new IRDelayed(
                        _ir_let(
                            _ir_apps(
                                IRNative.headList,
                                new IRVar( amount_value )
                            ),
                            pairDataSym => new IRForced(_ir_apps(
                                IRNative.strictIfThenElse,
                                // isPolicy( fst pairData as bytes )
                                _ir_apps(
                                    new IRVar( amount_isPolicy ),
                                    _ir_apps(
                                        IRNative.unBData,
                                        _ir_apps(
                                            IRNative.fstPair,
                                            new IRVar( pairDataSym )
                                        )
                                    )
                                ),
                                // then: build (tokenName => amount)
                                new IRDelayed(
                                    new IRFunc(
                                        [ amount_isTokenName ],
                                        _ir_apps(
                                            new IRRecursive(
                                                amount_tokenNameLoop,
                                                new IRFunc(
                                                    [ amount_tokenMap ],
                                                    new IRForced(_ir_apps(
                                                        IRNative.strictChooseList,
                                                        new IRVar( amount_tokenMap ),
                                                        // token map empty => 0
                                                        new IRDelayed( IRConst.int( 0 ) ),
                                                        // token map cons
                                                        new IRDelayed(
                                                            _ir_let(
                                                                _ir_apps(
                                                                    IRNative.headList,
                                                                    new IRVar( amount_tokenMap )
                                                                ),
                                                                pairDataTokenSym => new IRForced(_ir_apps(
                                                                    IRNative.strictIfThenElse,
                                                                    // isTokenName( fst pairDataToken as bytes )
                                                                    _ir_apps(
                                                                        new IRVar( amount_isTokenName ),
                                                                        _ir_apps(
                                                                            IRNative.unBData,
                                                                            _ir_apps(
                                                                                IRNative.fstPair,
                                                                                new IRVar( pairDataTokenSym )
                                                                            )
                                                                        ),
                                                                        // then: return amount
                                                                        new IRDelayed(
                                                                            _ir_apps(
                                                                                IRNative.unIData,
                                                                                _ir_apps(
                                                                                    IRNative.sndPair,
                                                                                    new IRVar( pairDataTokenSym )
                                                                                )
                                                                            )
                                                                        ),
                                                                        // else: recurse tail
                                                                        new IRDelayed(
                                                                            _ir_apps(
                                                                                new IRSelfCall( amount_tokenNameLoop ),
                                                                                _ir_apps(
                                                                                    IRNative.tailList,
                                                                                    new IRVar( amount_tokenMap ) // tokenMap list
                                                                                )
                                                                            )
                                                                        )
                                                                    ),
                                                                ))
                                                            )
                                                        )
                                                    ))
                                                )
                                            ),
                                            // pass token map (snd pairData)
                                            _ir_apps(
                                                IRNative.unMapData,
                                                _ir_apps(
                                                    IRNative.sndPair,
                                                    new IRVar( pairDataSym )
                                                )
                                            )
                                        )
                                    )
                                ),
                                // else: recurse policyLoop on tail value list
                                new IRDelayed(_ir_apps(
                                    new IRSelfCall( amount_policyLoop ),
                                    _ir_apps(
                                        IRNative.tailList,
                                        new IRVar( amount_value )
                                    )
                                ))
                            ))
                        )
                    )
                ))
            )
        )
    )
);
hoisted_amountOfValue.hash;