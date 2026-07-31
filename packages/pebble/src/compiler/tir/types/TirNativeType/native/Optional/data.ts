import { ConstType, constT } from "@harmoniclabs/uplc";
import { getAppliedTirTypeName } from "../../../../program/getAppliedTirTypeName";
import { TirDataStructType, TirStructConstr, TirStructField } from "../../../TirStructType";
import { TirType, ITirType } from "../../../TirType";

export class TirDataOptT<T extends TirType = TirType>
    extends TirDataStructType
    implements ITirType
{
    constructor(
        readonly typeArg: T
    ) {
        super(
            "Optional", // name
            "", // fileUid
            [
                new TirStructConstr(
                    "Some", // name
                    [ // fields
                        new TirStructField( "value", typeArg )
                    ]
                ),
                new TirStructConstr( "None", [] ) // name, fields
            ],
            new Map() // methodNamesPtr
        );
    }

    hasDataEncoding(): boolean { return this.typeArg.hasDataEncoding(); }

    toAstName(): string {
        return "Optional"
    }

    toString(): string {
        return `${this.toAstName()}<${this.typeArg.toString()}>`;
    }

    static toTirTypeKey(): string {
        return "data_opt";
    }
    toTirTypeKey(): string {
        return TirDataOptT.toTirTypeKey();
    }

    toConcreteTirTypeName(): string {
        return getAppliedTirTypeName(
            this.toTirTypeKey(),
            [ this.typeArg.toConcreteTirTypeName() ]
        );
    }

    protected _isConcrete: boolean | undefined = undefined;
    isConcrete(): boolean {
        if( typeof this._isConcrete !== "boolean" )
            this._isConcrete = this.typeArg.isConcrete();
        return this._isConcrete!;
    }

    clone(): TirDataOptT<T> {
        const result = new TirDataOptT(
            this.typeArg.clone()
        ) as TirDataOptT<T>;
        result._isConcrete = this._isConcrete;
        return result;
    }

    toUplcConstType(): ConstType { return constT.data; }
}