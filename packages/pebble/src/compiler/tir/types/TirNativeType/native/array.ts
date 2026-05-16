import { ConstType, constT } from "@harmoniclabs/uplc";
import { getAppliedTirTypeName } from "../../../program/TypedProgram";
import { TirType, ITirType } from "../../TirType";


export class TirArrayT<T extends TirType = TirType>
    implements ITirType
{
    constructor(
        readonly typeArg: T
    ) {}

    hasDataEncoding(): boolean { return this.typeArg.hasDataEncoding(); }

    static toTirTypeKey(): string {
        return "Array";
    }
    toTirTypeKey(): string {
        return TirArrayT.toTirTypeKey();
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

    clone(): TirArrayT<T> {
        const result = new TirArrayT(
            this.typeArg.clone()
        ) as TirArrayT<T>;
        result._isConcrete = this._isConcrete;
        return result;
    }

    toUplcConstType(): ConstType {
        return constT.arrayOf(
            this.typeArg.toUplcConstType()
        );
    }
}
