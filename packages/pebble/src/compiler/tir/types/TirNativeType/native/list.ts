import { ConstType, constT } from "@harmoniclabs/uplc";
import { getAppliedTirTypeName } from "../../../program/getAppliedTirTypeName";
import { TirType, ITirType } from "../../TirType";


export class TirListT<T extends TirType = TirType>
    implements ITirType
{
    constructor(
        readonly typeArg: T
    ) {}

    hasDataEncoding(): boolean { return this.typeArg.hasDataEncoding(); }

    static toTirTypeKey(): string {
        return "List";
    }
    toTirTypeKey(): string {
        return TirListT.toTirTypeKey();
    }

    toConcreteTirTypeName(): string {
        return getAppliedTirTypeName(
            this.toTirTypeKey(),
            [ this.typeArg.toConcreteTirTypeName() ]
        );
    }

    toString(): string {
        return `${this.toTirTypeKey()}<${this.typeArg.toString()}>`;
    }

    toAstName(): string {
        return this.toTirTypeKey();
    }

    private _isConcrete: boolean | undefined = undefined;
    isConcrete(): boolean {
        if( typeof this._isConcrete !== "boolean" )
            this._isConcrete = this.typeArg.isConcrete();
        return this._isConcrete ?? false;
    }

    clone(): TirListT<T> { 
        const result = new TirListT(
            this.typeArg.clone()
        ) as TirListT<T>;
        result._isConcrete = this._isConcrete;
        return result;
    }

    toUplcConstType(): ConstType {
        return constT.listOf(
            this.typeArg.toUplcConstType()
        );
    }
}