import { DataConstr } from "@harmoniclabs/plutus-data";
import { SourceRange } from "../../../ast/Source/SourceRange";
import { IRCase } from "../../../IR/IRNodes/IRCase";
import { IRConst } from "../../../IR/IRNodes/IRConst";
import { IRFunc } from "../../../IR/IRNodes/IRFunc";
import { IRHoisted } from "../../../IR/IRNodes/IRHoisted";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import { IRVar } from "../../../IR/IRNodes/IRVar";
import type { IRTerm } from "../../../IR/IRTerm";
import { data_t } from "../program/stdScope/stdScope";
import { TirAliasType } from "../types/TirAliasType";
import { TirDataStructType, TirSoPStructType } from "../types/TirStructType";
import { TirEnumType } from "../types/TirEnumType";
import { isTirType, TirType } from "../types/TirType";
import { getListTypeArg } from "../types/utils/getListTypeArg";
import { getOptTypeArg } from "../types/utils/getOptTypeArg";
import { getUnaliased } from "../types/utils/getUnaliased";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";
import { TirBoolT } from "../types/TirNativeType/native/bool";
import { TirBytesT } from "../types/TirNativeType/native/bytes";
import { TirDataT } from "../types/TirNativeType/native/data";
import { TirIntT } from "../types/TirNativeType/native/int";
import { TirLinearMapT } from "../types/TirNativeType/native/linearMap";
import { TirListT } from "../types/TirNativeType/native/list";
import { TirDataOptT } from "../types/TirNativeType/native/Optional/data";
import { TirSopOptT } from "../types/TirNativeType/native/Optional/sop";
import { TirStringT } from "../types/TirNativeType/native/string";
import { TirVoidT } from "../types/TirNativeType/native/void";
import { hoisted_constr1_empty } from "../../../IR/toUPLC/common_hoisted";
import { _ir_apps } from "../../../IR/IRNodes/IRApp";

type TirUnaliasedDataEncodedType = TirDataT | TirDataOptT | TirDataStructType;
export type TirDataEncodedType = TirUnaliasedDataEncodedType | TirAliasType<TirUnaliasedDataEncodedType>;

export function isTirDataEncodedType(
    type: TirType
): type is TirDataEncodedType
{
    type = getUnaliased( type ) ?? type;
    return (
        type instanceof TirDataT
        || type instanceof TirDataOptT
        || type instanceof TirDataStructType
    );
}

export class TirToDataExpr
    implements ITirExpr
{
    constructor(
        public expr: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `toData( ${this.expr.toString()} )`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `toData(${this.expr.pretty(indent)})`;
    }

    clone(): TirExpr
    {
        return new TirToDataExpr(
            this.expr.clone(),
            this.range.clone()
        );
    }

    get isConstant(): boolean { return this.expr.isConstant; }
    get type(): TirDataT { return data_t; }

    deps(): string[]
    {
        return this.expr.deps();
    }

    toIR(ctx: ToIRTermCtx): IRTerm
    {
        return _inlineToData(
            this.expr.type,
            this.expr.toIR(ctx)
        );
    }
}

export function _inlineToData(
    origin_t: TirType,
    exprIR: IRTerm
): IRTerm
{
    const from_t = getUnaliased( origin_t );

    if(
        from_t instanceof TirDataT
        || from_t instanceof TirDataOptT
        || from_t instanceof TirDataStructType
    ) return exprIR;

    if( from_t instanceof TirLinearMapT )
    return _ir_apps(
        IRNative.mapData,
        exprIR
    );

    if( from_t instanceof TirListT )
    {
        const elems_t = getUnaliased( getListTypeArg( from_t )! );

        if(
            elems_t instanceof TirDataStructType
            || elems_t instanceof TirDataT
            || elems_t instanceof TirDataOptT
        ) return _ir_apps(
            IRNative.listData,
            exprIR
        );

        return _ir_apps(
            IRNative._mkMapList,
            IRConst.listOf( elems_t )([]),
            _toDataUplcFunc( elems_t ),
            exprIR
        );
    }

    if( from_t instanceof TirSopOptT )
    {
        const value_t = getOptTypeArg( from_t );
        if( !isTirType( value_t ) ) throw new Error("TirToDataExpr: unreachable");

        const valueName = Symbol("value");
        return new IRCase(
            exprIR, [
                // case Just{ value }
                new IRFunc(
                    [ valueName ], // value
                    _ir_apps(
                        IRNative.constrData,
                        IRConst.int( 0 ),
                        _ir_apps(
                            IRNative.mkCons,
                            _inlineToData( value_t, new IRVar( valueName ) ), // value to data
                            IRConst.listOf( data_t )([])
                        )
                    )
                ),
                // case Nothing
                hoisted_constr1_empty.clone()
            ]
        );
    }

    if( from_t instanceof TirSoPStructType )
    {
        return _inlineMultiSopConstrToData( from_t, exprIR );
    }

    return _ir_apps(
        _toDataUplcFunc( from_t ),
        exprIR
    );
}

export function _toDataUplcFunc( origin_t: TirType ): IRTerm
{
    const from_t = getUnaliased( origin_t );

    if(
        from_t instanceof TirDataT
        || from_t instanceof TirDataOptT
        || from_t instanceof TirDataStructType
    ) return IRNative._id;

    if( from_t instanceof TirIntT ) return IRNative.iData;
    if( from_t instanceof TirEnumType ) return IRNative.iData;
    if( from_t instanceof TirBytesT ) return IRNative.bData;
    if( from_t instanceof TirVoidT ) return _mkUnitData;
    if( from_t instanceof TirBoolT ) return _boolToData;
    if( from_t instanceof TirStringT ) return _strToData;

    if( from_t instanceof TirLinearMapT )
    // linear maps only have pairs as elements
    // and we only support pairs of data (bc we only have `mkPairData`)
    return IRNative.mapData;
    
    if( from_t instanceof TirListT )
    {
        const elems_t = getUnaliased( getListTypeArg( from_t )! );

        if( elems_t instanceof TirDataStructType
            || elems_t instanceof TirDataOptT
            || elems_t instanceof TirDataT
        ) return IRNative.listData;

        return mkMapListToData( elems_t );
    }

    if(
        from_t instanceof TirSopOptT
        || from_t instanceof TirSoPStructType
    ) return mkSopToData( from_t );

    throw new Error(
        `TirFromDataExpr: cannot convert from Data to type ${from_t.toString()}`
    );
}

const _mkUnitData = new IRHoisted(
    new IRFunc(
        [ Symbol("unit") ],
        IRConst.data( new DataConstr( 0, [] ) )
    )
);

const bool_var_name = Symbol("bool");
const _boolToData = new IRHoisted( new IRFunc(
    [ bool_var_name ], // bool
    _ir_apps(
        IRNative.strictIfThenElse,
        new IRVar( bool_var_name ), // bool
        new IRHoisted( IRConst.data( new DataConstr( 0, [] ) ) ),
        new IRHoisted( IRConst.data( new DataConstr( 1, [] ) ) )
    )
));

const str_var_name = Symbol("str");
const _strToData = new IRHoisted( new IRFunc(
    [ str_var_name ], // string
    _ir_apps(
        IRNative.bData,
        _ir_apps(
            IRNative.encodeUtf8,
            new IRVar( str_var_name ) // string
        )
    )
));

export function _inlineSingleSopConstrToData(
    sop_t: TirSoPStructType,
    exprIR: IRTerm
): IRTerm
{
    if( sop_t.constructors.length !== 1 )
    throw new Error("_inilneSingeSopConstrFromData: multiple constructors");

    const constr = sop_t.constructors[0];

    if( constr.fields.length === 0 )
    return new IRHoisted( IRConst.data( new DataConstr( 0, [] ) ) );

    if( constr.fields.length === 1 ) {
        const value_t = getUnaliased( constr.fields[0].type );
        if( !isTirType( value_t ) ) throw new Error("TirFromDataExpr: unreachable");

        return _ir_apps(
            IRNative.constrData,
            IRConst.int( 0 ),
            _ir_apps(
                IRNative.mkCons,
                _inlineToData(
                    value_t,
                    // get unique field
                    new IRCase(
                        exprIR, [ IRNative._id ]
                    )
                    
                ),
                IRConst.listOf( data_t )([])
            )
        );
    }

    let lst: IRTerm = IRConst.listOf( data_t )([]);
    const fieldsVarsNames = constr.fields.map( f => Symbol( f.name ) );
    for( let i = constr.fields.length - 1; i >= 0; i-- )
    {
        const filedExpr = new IRVar( fieldsVarsNames[ i ] );
        const field_t = getUnaliased( constr.fields[i].type );
        if( !isTirType( field_t ) ) throw new Error("TirFromDataExpr: unreachable");

        lst = _ir_apps(
            IRNative.mkCons,
            _inlineToData( field_t, filedExpr ),
            lst
        );
    }

    return _ir_apps(
        IRNative.constrData,
        IRConst.int( 0 ),
        new IRCase(
            exprIR, [
                new IRFunc(
                    fieldsVarsNames,
                    lst
                )
            ]
        )
    );
}

export function _inlineMultiSopConstrToData(
    sop_t: TirSoPStructType,
    exprIR: IRTerm
): IRTerm
{
    if( sop_t.constructors.length <= 1 )
    return _inlineSingleSopConstrToData( sop_t, exprIR );

    const cases: IRTerm[] = sop_t.constructors.map(( constr, constrIdx ) =>
    {
        if( constr.fields.length === 0 )
        return new IRHoisted( IRConst.data( new DataConstr( constrIdx, [] ) ) );

        let lst: IRTerm = IRConst.listOf( data_t )([]);
        const fieldsVarsNames = constr.fields.map( f => Symbol( f.name ) );
        for( let i = constr.fields.length - 1 ; i >= 0; i-- )
        {
            const filedExpr = new IRVar( fieldsVarsNames[i] );
            const field_t = getUnaliased( constr.fields[i].type );
            if( !isTirType( field_t ) ) throw new Error("TirFromDataExpr: unreachable");

            lst = _ir_apps(
                IRNative.mkCons,
                _inlineToData( field_t, filedExpr ),
                lst
            );
        }

        return new IRFunc(
            fieldsVarsNames,
            _ir_apps(
                IRNative.constrData,
                IRConst.int( constrIdx ),
                lst
            )
        );
    });

    return new IRCase(
        exprIR,
        cases
    );
}



const _mapListToDataOfType: Record<string, IRHoisted> = {};
function mkMapListToData( elems_t: TirType ): IRHoisted
{
    const key = elems_t.toTirTypeKey();
    if( _mapListToDataOfType[key] ) return _mapListToDataOfType[key].clone();

    const hoisted_mapListToData_lst = Symbol("hoisted_mapListToData_lst");
    _mapListToDataOfType[key] = new IRHoisted(new IRFunc(
        [ hoisted_mapListToData_lst ], // list
        _ir_apps(
            IRNative.listData,
            _ir_apps(
                IRNative._mkMapList,
                IRConst.listOf( elems_t )([]),
                _toDataUplcFunc( elems_t ),
                new IRVar( hoisted_mapListToData_lst ) // list
            )
        )
    ));

    return _mapListToDataOfType[key].clone();
}

const _sopToDataOfType: Record<string, IRHoisted> = {};
function mkSopToData( from_t: TirSoPStructType ): IRHoisted
{
    const key = from_t.toTirTypeKey();
    if( _sopToDataOfType[key] ) return _sopToDataOfType[key].clone();

    const sop_var = Symbol("sop");
    _sopToDataOfType[key] = new IRHoisted(
        new IRFunc(
            [ sop_var ], // sop
            _inlineToData(
                from_t,
                new IRVar( sop_var ) // sop
            )
        )
    );
    
    return _sopToDataOfType[key].clone();
}