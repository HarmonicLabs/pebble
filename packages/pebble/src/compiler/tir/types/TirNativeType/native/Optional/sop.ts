import { ConstType } from "@harmoniclabs/uplc";
import { getAppliedTirTypeName } from "../../../../program/getAppliedTirTypeName";
import { TirSoPStructType, TirStructConstr, TirStructField } from "../../../TirStructType";
import { TirType, ITirType } from "../../../TirType";

export class TirSopOptT<T extends TirType = TirType>
    extends TirSoPStructType
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

    hasDataEncoding(): boolean { return false; }

    toAstName(): string {
        return "Optional"
    }

    toString(): string {
        return `${this.toAstName()}<${this.typeArg.toString()}>`;
    }

    static toTirTypeKey(): string {
        return "sop_opt";
    }
    toTirTypeKey(): string {
        return TirSopOptT.toTirTypeKey();
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

    clone(): TirSopOptT<T> {
        const result = new TirSopOptT(
            this.typeArg.clone()
        ) as TirSopOptT<T>;
        result._isConcrete = this._isConcrete;
        return result;
    }

    toUplcConstType(): ConstType {
        throw new Error("SoP encoded optional cannot be represented as uplc const");
    }
}
