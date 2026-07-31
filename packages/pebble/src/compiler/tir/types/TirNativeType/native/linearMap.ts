import { ConstType, constT } from "@harmoniclabs/uplc";
import { getAppliedTirTypeName } from "../../../program/getAppliedTirTypeName";
import { TirType, ITirType } from "../../TirType";

export class TirLinearMapT<K extends TirType = TirType,V extends TirType = TirType>
    implements ITirType
{
    constructor(
        readonly keyTypeArg: K,
        readonly valTypeArg: V
    ) {}

    hasDataEncoding(): boolean { return this.keyTypeArg.hasDataEncoding() && this.valTypeArg.hasDataEncoding(); }

    static toTirTypeKey(): string {
        return "list_pair_data";
    }
    toTirTypeKey(): string {
        return TirLinearMapT.toTirTypeKey();
    }

    toAstName(): string {
        return this.toTirTypeKey();
    }

    toConcreteTirTypeName(): string {
        return getAppliedTirTypeName(
            this.toTirTypeKey(),
            [ 
                this.keyTypeArg.toConcreteTirTypeName(),
                this.valTypeArg.toConcreteTirTypeName()
            ]
        );
    }

    toString(): string {
        return `${this.toTirTypeKey()}<${this.keyTypeArg.toString()},${this.valTypeArg.toString()}>`;
    }

    private _isConcrete: boolean | undefined = undefined;
    isConcrete(): boolean {
        if( typeof this._isConcrete !== "boolean" )
            this._isConcrete = (
                this.keyTypeArg.isConcrete()
                && this.valTypeArg.isConcrete()
            );
        return this._isConcrete ?? false;
    }

    clone(): TirLinearMapT<K,V> {
        const result = new TirLinearMapT(
            this.keyTypeArg.clone(),
            this.valTypeArg.clone()
        ) as TirLinearMapT<K,V>;
        result._isConcrete = this._isConcrete;
        return result;
    }

    toUplcConstType(): ConstType {
        return constT.listOf(
            constT.pairOf(
                constT.data,
                constT.data
            )
        );
    }
}