import { ConstType, constT } from "@harmoniclabs/uplc";
import { getAppliedTirTypeName } from "../../../program/TypedProgram";
import { TirType, ITirType } from "../../TirType";

export class TirLinearMapEntryT<K extends TirType = TirType, V extends TirType = TirType>
    implements ITirType
{
    constructor(
        readonly keyTypeArg: K,
        readonly valTypeArg: V
    ) {}

    hasDataEncoding(): boolean { return false; }

    static toTirTypeKey(): string {
        return "linear_map_entry";
    }
    toTirTypeKey(): string {
        return TirLinearMapEntryT.toTirTypeKey();
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

    clone(): TirLinearMapEntryT<K, V> {
        const result = new TirLinearMapEntryT(
            this.keyTypeArg.clone(),
            this.valTypeArg.clone()
        ) as TirLinearMapEntryT<K, V>;
        result._isConcrete = this._isConcrete;
        return result;
    }

    toUplcConstType(): ConstType {
        return constT.pairOf(
            constT.data,
            constT.data
        );
    }
}
