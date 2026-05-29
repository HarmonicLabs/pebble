import { ConstType, constT } from "@harmoniclabs/uplc";
import { ITirType } from "../../TirType";

export class TirValueT
    implements ITirType
{
    clone(): TirValueT { return new TirValueT(); }
    isConcrete(): boolean { return true; }
    toString(): string { return "Value"; }
    toAstName(): string { return "Value"; }
    static toTirTypeKey(): string { return "Value"; }
    toTirTypeKey(): string { return TirValueT.toTirTypeKey(); }
    toConcreteTirTypeName(): string { return this.toTirTypeKey(); }
    /**
     * Native `Value` is bidirectionally reachable from `data` via
     * `unValueData` / `valueData`, so it qualifies as data-encoded for
     * the purposes of `data struct` field types.
     */
    hasDataEncoding(): boolean { return true; }
    toUplcConstType(): ConstType { return constT.value; }
}
