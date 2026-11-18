import { SourceRange } from "../../../ast/Source/SourceRange";
import { _ir_apps } from "../../../IR/IRNodes/IRApp";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import type { IRTerm } from "../../../IR/IRTerm";
import { TirBoolT } from "../types/TirNativeType/native/bool";
import { TirBytesT } from "../types/TirNativeType/native/bytes";
import { TirDataT } from "../types/TirNativeType/native/data";
import { TirIntT } from "../types/TirNativeType/native/int";
import { TirDataOptT } from "../types/TirNativeType/native/Optional/data";
import { TirStringT } from "../types/TirNativeType/native/string";
import { TirLinearMapT } from "../types/TirNativeType/native/linearMap";
import { TirLinearMapEntryT } from "../types/TirNativeType/native/linearMapEntry";
import { TirDataStructType } from "../types/TirStructType";
import { TirEnumType } from "../types/TirEnumType";
import { TirType } from "../types/TirType";
import { getUnaliased } from "../types/utils/getUnaliased";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { _fromDataUplcFunc, _inlineFromData } from "./TirFromDataExpr";
import { _inlineToData, _toDataUplcFunc, isTirDataEncodedType } from "./TirToDataExpr";
import { TirListT } from "../types/TirNativeType/native/list";
import { getListTypeArg } from "../types/utils/getListTypeArg";
import { IRConst } from "../../../IR/IRNodes/IRConst";
import { ToIRTermCtx } from "./ToIRTermCtx";

export class TirTypeConversionExpr
    implements ITirExpr
{
    constructor(
        public expr: TirExpr,
        readonly type: TirType,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.expr.toString()} as ${this.type.toString()})`;
    }

    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat( indent );
        return (
            `(${this.expr.pretty( indent )} as ${this.type.toString()})`
        );
    }

    deps(): string[]
    {
        return this.expr.deps();
    }

    get isConstant(): boolean { return this.expr.isConstant; }

    clone(): TirExpr
    {
        return new TirTypeConversionExpr(
            this.expr.clone(),
            this.type.clone(),
            this.range.clone()
        );
    }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const from_t = getUnaliased( this.expr.type );
        const to_t = getUnaliased( this.type );
        const exprIR = this.expr.toIR( ctx );

        if(
            from_t instanceof TirDataT
            || from_t instanceof TirDataOptT
            || from_t instanceof TirDataStructType
        ) return _inlineFromData( to_t, exprIR );
        if( 
            to_t instanceof TirDataT
            || to_t instanceof TirDataOptT
            || to_t instanceof TirDataStructType
        ) return _inlineToData( from_t, exprIR );

        if( to_t instanceof TirIntT )
        {
            if( from_t instanceof TirIntT ) return exprIR;
            // enum is already an int at runtime; identity conversion.
            if( from_t instanceof TirEnumType ) return exprIR;
            if( from_t instanceof TirBytesT ) return _ir_apps(
                IRNative._bytesToIntBE,
                exprIR
            );
            if( from_t instanceof TirBoolT ) return _ir_apps(
                IRNative._boolToInt,
                exprIR
            );
            throw new Error(`Cannot convert from ${from_t.toString()} to ${to_t.toString()}`);
        }
        if( to_t instanceof TirEnumType )
        {
            // identity at runtime — same enum type.
            if( from_t instanceof TirEnumType ) return exprIR;
            throw new Error(`Cannot convert from ${from_t.toString()} to ${to_t.toString()}`);
        }
        if( to_t instanceof TirBytesT )
        {
            if( from_t instanceof TirBytesT ) return exprIR;
            if( from_t instanceof TirIntT ) return _ir_apps(
                IRNative._intToBytesBE, // internally handles int size
                exprIR
            );
            throw new Error(`Cannot convert from ${from_t.toString()} to ${to_t.toString()}`);
        }
        if( to_t instanceof TirBoolT )
        {
            if( from_t instanceof TirBoolT ) return exprIR;
            if( from_t instanceof TirIntT ) return _ir_apps(
                IRNative._intToBool,
                exprIR
            );
            throw new Error(`Cannot convert from ${from_t.toString()} to ${to_t.toString()}`);
        }

        if( to_t instanceof TirStringT )
        {
            if( from_t instanceof TirBytesT ) return _ir_apps(
                IRNative.decodeUtf8,
                exprIR
            );
            throw new Error(`Cannot convert from ${from_t.toString()} to ${to_t.toString()}`);
        }

        // `List<A> as List<B>` (PEBBLE_BUGS 83). A list holds its elements as
        // data when they are data, a data struct or an optional out of one,
        // and as the plain UPLC value otherwise (`List<int>` is `list
        // integer`). Between two lists of the first kind the cast is the
        // identity — this is how the elements of a list read off some data
        // are given their type: `std.builtins.unListData( d ) as List<Asset>`
        // — and between a list of data and a list of plain values each
        // element is decoded, or encoded. The checker accepted all of them
        // (and any pair of element types that cast to each other); the back
        // end knew none, and failed with "Cannot convert from List<data> to
        // List<Asset>" at no place in the source.
        if( to_t instanceof TirListT && from_t instanceof TirListT )
        {
            const fromElem = getUnaliased( getListTypeArg( from_t )! );
            const toElem = getUnaliased( getListTypeArg( to_t )! );
            const fromData = isTirDataEncodedType( fromElem );
            const toData = isTirDataEncodedType( toElem );
            if( fromData && toData ) return exprIR;
            if( fromElem.toTirTypeKey() === toElem.toTirTypeKey() ) return exprIR;
            if( fromData ) return _ir_apps(
                IRNative._mkMapList,
                IRConst.listOf( toElem )([]),
                _fromDataUplcFunc( toElem ),
                exprIR
            );
            if( toData ) return _ir_apps(
                IRNative._mkMapList,
                IRConst.listOf( toElem )([]),
                _toDataUplcFunc( fromElem ),
                exprIR
            );
            throw new Error(`Cannot convert from ${from_t.toString()} to ${to_t.toString()}`);
        }

        // every `LinearMap<K,V>` (and entry) is `list (pair data data)` /
        // `pair data data` at runtime regardless of K/V — re-typing the
        // keys/values is an identity conversion. This is the documented
        // idiom for building typed maps:
        // `std.builtins.unMapData( d ) as LinearMap<bytes, bytes>` (BUG 47).
        if( to_t instanceof TirLinearMapT && from_t instanceof TirLinearMapT )
            return exprIR;
        if( to_t instanceof TirLinearMapEntryT && from_t instanceof TirLinearMapEntryT )
            return exprIR;

        throw new Error(`Cannot convert from ${from_t.toString()} to ${to_t.toString()}`);
    }
}