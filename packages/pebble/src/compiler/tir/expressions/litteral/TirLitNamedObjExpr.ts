import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { ITirExpr } from "../ITirExpr";
import { SourceRange } from "../../../../ast/Source/SourceRange";
import { TirExpr } from "../TirExpr";
import { ITirLitObjExpr } from "./TirLitObjExpr";
import { mergeSortedStrArrInplace } from "../../../../utils/array/mergeSortedStrArrInplace";
import { IRTerm, IRConstr } from "../../../../IR";
import { data_t } from "../../program/stdScope/stdScope";
import { TirAliasType } from "../../types/TirAliasType";
import { TirDataStructType, TirSoPStructType } from "../../types/TirStructType";
import { TirTypeParam } from "../../types/TirTypeParam";
import { getUnaliased } from "../../types/utils/getUnaliased";
import { TirCallExpr } from "../TirCallExpr";
import { TirToDataExpr } from "../TirToDataExpr";
import { ToIRTermCtx } from "../ToIRTermCtx";
import { TirLitArrExpr } from "./TirLitArrExpr";
import { TirLitIntExpr } from "./TirLitIntExpr";
import { NamedExpr } from "../utils/NamedExpr";
import { TirNativeFunc } from "../TirNativeFunc";
import { isObject } from "@harmoniclabs/obj-utils";
import { TirPairDataT } from "../../types/TirNativeType";
import { TirFuncT } from "../../types/TirNativeType/native/function";
import { TirListT } from "../../types/TirNativeType/native/list";
import { TirDataOptT } from "../../types/TirNativeType/native/Optional/data";
import { TirSopOptT } from "../../types/TirNativeType/native/Optional/sop";

export class TirLitNamedObjExpr
    implements ITirExpr, ITirLitObjExpr
{
    get isConstant(): boolean
    {
        return this.values.every( value => value.isConstant );
    }

    constructor(
        readonly name: Identifier,
        readonly fieldNames: Identifier[],
        readonly values: TirExpr[],
        readonly type: TirSoPStructType | TirDataStructType | TirSopOptT | TirDataOptT,
        readonly range: SourceRange
    ) {}

    pretty(): string { return this.toString(); }
    toString(): string
    {
        const fields = this.fieldNames.map( (f, i) => `${f.text}: ${this.values[i].toString()}` );
        return `${this.name.text}{ ${fields.join(", ")} }`;
    }

    clone(): TirExpr
    {
        return new TirLitNamedObjExpr(
            this.name,
            this.fieldNames.map( f => f ),
            this.values.map( v => v.clone() ) as TirExpr[],
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

        const ctorIdx = type.constructors.findIndex( c => c.name === this.name.text );
        if( ctorIdx < 0 )
        throw new Error("invalid constructor name in named object literal.");

        const ctor = type.constructors[ctorIdx];
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
            // the runtime tag is the constructor's index in the ORIGINAL
            // (un-narrowed) type — `case` dispatches by that same index.
            // Previously hardcoded to 0, so every non-first variant ran the
            // first arm (masterpiece/audit BUG 27). `parentCtorIdx` is
            // identity for un-narrowed types.
            return new IRConstr(
                type.parentCtorIdx( ctorIdx ),
                namedFields.map(({ expr }) => expr.toIR( ctx ) )
            );
        }

        // else data
        const exprsAsData = namedFields.map(({ expr }) => {
            const exprType = getUnaliased( expr.type ) ?? expr.type;
            if(
                exprType instanceof TirSoPStructType
                || exprType instanceof TirSopOptT
                || exprType instanceof TirFuncT
                || exprType instanceof TirPairDataT
                // we have no way to describe it to typescript if not this way
                || exprType instanceof TirAliasType
                || exprType instanceof TirTypeParam
            ) throw new Error("filed cannot be encoded as data");

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
                    new TirLitIntExpr( BigInt(ctorIdx), this.range ),
                    fieldsAsListOfData
                ],
                data_t,
                this.range
            ).toIR( ctx )
        );
    }
}