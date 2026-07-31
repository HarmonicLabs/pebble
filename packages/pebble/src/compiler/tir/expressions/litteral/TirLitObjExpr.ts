import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { ITirExpr } from "../ITirExpr";
import { SourceRange } from "../../../../ast/Source/SourceRange";
import { TirExpr } from "../TirExpr";
import { mergeSortedStrArrInplace } from "../../../../utils/array/mergeSortedStrArrInplace";
import { TirDataStructType, TirSoPStructType } from "../../types/TirStructType";
import { ToIRTermCtx } from "../ToIRTermCtx";
import { IRConstr, IRTerm } from "../../../../IR";
import { isObject } from "@harmoniclabs/obj-utils";
import { TirToDataExpr } from "../TirToDataExpr";
import { getUnaliased } from "../../types/utils/getUnaliased";
import { data_t } from "../../program/stdScope/stdScope";
import { TirAliasType } from "../../types/TirAliasType";
import { TirTypeParam } from "../../types/TirTypeParam";
import { TirLitArrExpr } from "./TirLitArrExpr";
import { TirCallExpr } from "../TirCallExpr";
import { TirLitIntExpr } from "./TirLitIntExpr";
import { NamedExpr } from "../utils/NamedExpr";
import { TirNativeFunc } from "../TirNativeFunc";
import { TirPairDataT } from "../../types/TirNativeType";
import { TirFuncT } from "../../types/TirNativeType/native/function";
import { TirListT } from "../../types/TirNativeType/native/list";
import { TirSopOptT } from "../../types/TirNativeType/native/Optional/sop";

export interface ITirLitObjExpr {
    fieldNames: Identifier[];
    values: TirExpr[];
}

export class TirLitObjExpr
    implements ITirExpr, ITirLitObjExpr
{
    get isConstant(): boolean
    {
        return this.values.every( value => value.isConstant );
    }
    
    constructor(
        readonly fieldNames: Identifier[],
        readonly values: TirExpr[],
        readonly type: TirSoPStructType | TirDataStructType,
        readonly range: SourceRange
    ) {}

    pretty(): string { return this.toString(); }
    toString(): string
    {
        const fields = this.fieldNames.map( (f, i) => `${f.text}: ${this.values[i].toString()}` );
        return `{ ${fields.join(", ")} }`;
    }

    clone(): TirExpr
    {
        return new TirLitObjExpr(
            this.fieldNames.map( f => f ),
            this.values.map( v => v.clone() as TirExpr ),
            this.type.clone(),
            this.range.clone()
        );
    }

    deps(): string[]
    {
        return this.values.reduce((deps, value) => {
            const valueDeps = value.deps();
            mergeSortedStrArrInplace( deps, valueDeps );
            return deps;
        }, []);
    }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const type = this.type;

        if( type.constructors.length !== 1 )
        throw new Error("multiple constructors for unnamed object literal");

        const ctor = type.constructors[0];
        const fields = ctor.fields;
        const fNames = fields.map( f => f.name );

        if(
            fields.length !== this.fieldNames.length
            || this.fieldNames.length !== this.values.length
        ) throw new Error("incorrect number of fields in object literal");

        const len = fNames.length;
        const _namedFields: NamedExpr[] = new Array( len );
        for( let i = 0; i < len; i++ ) {
            _namedFields[i] = {
                name: fNames[i],
                expr: this.values[i]
            };
        }

        // sort according to definition order
        const namedFields = fNames.map( f => _namedFields.find( n => n.name === f )! );
        if( namedFields.some( thing => !isObject( thing ) ) ) {
            throw new Error("missing field in object literal");
        }
        
        if( type instanceof TirSoPStructType ) {
            // single-constructor unnamed literal: the runtime tag is that
            // constructor's index in the ORIGINAL (un-narrowed) type, which
            // `parentCtorIdx(0)` yields (identity, i.e. 0, for un-narrowed).
            return new IRConstr(
                type.parentCtorIdx( 0 ),
                namedFields.map(({ expr }) => expr.toIR( ctx ) )
            );
        }

        // else data
        const exprsAsData = namedFields.map(({ expr }) => {
            const exprType = getUnaliased( expr.type ) ?? expr.type;
            if(
                // a SoP optional HAS a data conversion (`_inlineToData`), so
                // it is NOT rejected — and note `TirSopOptT` EXTENDS
                // `TirSoPStructType`, hence the explicit exclusion
                ( exprType instanceof TirSoPStructType && !( exprType instanceof TirSopOptT ) )
                || exprType instanceof TirFuncT
                || exprType instanceof TirPairDataT
                // we have no way to describe it to typescript if not this way
                || exprType instanceof TirAliasType
                || exprType instanceof TirTypeParam
            ) throw new Error("field cannot be encoded as data");

            /*
            const returnType = (
                exprType instanceof TirVoidT
                || exprType instanceof TirBoolT
                || exprType instanceof TirIntT
                || exprType instanceof TirBytesT
                || exprType instanceof TirStringT
                || exprType instanceof TirDataT
                || exprType instanceof TirListT
                || exprType instanceof TirLinearMapT
                || exprType instanceof TirUnConstrDataResultT
            ) ? data_t : exprType;
            //*/

            return new TirToDataExpr(
                expr,
                expr.range
            );
        });

        const fieldsAsListOfData = new TirLitArrExpr( exprsAsData, new TirListT( data_t ), this.range );

        return ( type.untagged ?
            new TirCallExpr(
                TirNativeFunc.listData,
                [ fieldsAsListOfData ],
                data_t,
                this.range
            ).toIR( ctx ) :
            new TirCallExpr(
                TirNativeFunc.constrData,
                [
                    new TirLitIntExpr( BigInt(0), this.range ),
                    new TirLitArrExpr(
                        exprsAsData,
                        new TirListT( data_t ),
                        this.range
                    )
                ],
                data_t,
                this.range
            ).toIR( ctx )
        );
    }
}