import type { ITirType, TirType } from "../TirType";
import { constT, ConstType } from "@harmoniclabs/uplc";
import { TirDataStructType, TirSoPStructType, TirStructConstr, TirStructField } from "../TirStructType";
import { getAppliedTirTypeName } from "../../program/TypedProgram";
import { TirBoolT } from "./native/bool";
import { TirBytesT } from "./native/bytes";
import { TirDataT } from "./native/data";
import { TirFuncT } from "./native/function";
import { TirIntT } from "./native/int";
import { TirLinearMapT } from "./native/linearMap";
import { TirLinearMapEntryT } from "./native/linearMapEntry";
import { TirListT } from "./native/list";
import { TirDataOptT } from "./native/Optional/data";
import { TirSopOptT } from "./native/Optional/sop";
import { TirStringT } from "./native/string";
import { TirVoidT } from "./native/void";

export type TirNamedDestructableNativeType
    = TirDataT
    | TirDataOptT<TirType>
    | TirSopOptT<TirType>
    | TirListT<TirType>
    | TirLinearMapT<TirType,TirType>
    ;

export function isTirNamedDestructableNativeType( t: any ): t is TirNamedDestructableNativeType
{
    return (
        t instanceof TirDataT
        || t instanceof TirDataOptT
        || t instanceof TirSopOptT
        || t instanceof TirListT
        || t instanceof TirLinearMapT
    );
}

export type TirNativeType
    = TirVoidT
    | TirBoolT
    | TirIntT
    | TirBytesT
    | TirStringT
    | TirDataT
    | TirDataOptT<TirType>
    | TirSopOptT<TirType>
    | TirListT<TirType>
    | TirLinearMapT<TirType,TirType>
    | TirLinearMapEntryT<TirType,TirType>
    | TirFuncT
    | TirUnConstrDataResultT
    | TirPairDataT
    | TirBlsG1T
    | TirBlsG2T
    | TirMlResultT
    ;

export function isTirNativeType( t: any ): t is TirNativeType
{
    return (
        t instanceof TirVoidT
        || t instanceof TirBoolT
        || t instanceof TirIntT
        || t instanceof TirBytesT
        || t instanceof TirStringT
        || t instanceof TirDataT
        || t instanceof TirDataOptT
        || t instanceof TirSopOptT
        || t instanceof TirListT
        || t instanceof TirLinearMapT
        || t instanceof TirLinearMapEntryT
        || t instanceof TirFuncT // =>
        || t instanceof TirUnConstrDataResultT
        || t instanceof TirPairDataT
        || t instanceof TirBlsG1T
        || t instanceof TirBlsG2T
        || t instanceof TirMlResultT
    );
}

export class TirUnConstrDataResultT
    implements ITirType
{
    constructor() {}

    hasDataEncoding(): boolean { return false; }

    static toTirTypeKey(): string {
        return "#un_constr_data_result#";
    }
    toTirTypeKey(): string {
        return TirUnConstrDataResultT.toTirTypeKey();
    }

    toConcreteTirTypeName(): string {
        return this.toTirTypeKey();
    }

    toString(): string {
        return this.toTirTypeKey();
    }

    toAstName(): string {
        return this.toTirTypeKey();
    }

    isConcrete(): boolean { return true; }

    clone(): TirUnConstrDataResultT {
        return new TirUnConstrDataResultT();
    }

    toUplcConstType(): ConstType {
        return constT.pairOf(
            constT.int,
            constT.listOf( constT.data )
        );
    }
}

export class TirPairDataT
    implements ITirType
{
    constructor() {}

    hasDataEncoding(): boolean { return false; }
    static toTirTypeKey(): string {
        return "#pair_data";
    }

    toTirTypeKey(): string {
        return TirPairDataT.toTirTypeKey();
    }
    toConcreteTirTypeName(): string {
        return this.toTirTypeKey();
    }

    toString(): string {
        return this.toTirTypeKey();
    }

    toAstName(): string {
        return this.toTirTypeKey();
    }

    isConcrete(): boolean { return true; }

    clone(): TirPairDataT {
        return new TirPairDataT();
    }

    toUplcConstType(): ConstType {
        return constT.pairOf(
            constT.data,
            constT.data
        );
    }
}

/**
 * BLS12-381 G1 element. Opaque native scalar; cannot be constructed from
 * Pebble source directly — values are produced by `std.crypto.bls12_381.*`
 * builtins (typically `g1Uncompress` or `g1HashToGroup`).
 */
export class TirBlsG1T
    implements ITirType
{
    constructor() {}

    hasDataEncoding(): boolean { return false; }

    static toTirTypeKey(): string { return "#bls12_381_g1#"; }
    toTirTypeKey(): string { return TirBlsG1T.toTirTypeKey(); }
    toConcreteTirTypeName(): string { return this.toTirTypeKey(); }
    toString(): string { return "G1"; }
    toAstName(): string { return "G1"; }
    isConcrete(): boolean { return true; }
    clone(): TirBlsG1T { return new TirBlsG1T(); }
    toUplcConstType(): ConstType { return constT.bls12_381_G1_element; }
}

/**
 * BLS12-381 G2 element. Opaque native scalar.
 */
export class TirBlsG2T
    implements ITirType
{
    constructor() {}

    hasDataEncoding(): boolean { return false; }

    static toTirTypeKey(): string { return "#bls12_381_g2#"; }
    toTirTypeKey(): string { return TirBlsG2T.toTirTypeKey(); }
    toConcreteTirTypeName(): string { return this.toTirTypeKey(); }
    toString(): string { return "G2"; }
    toAstName(): string { return "G2"; }
    isConcrete(): boolean { return true; }
    clone(): TirBlsG2T { return new TirBlsG2T(); }
    toUplcConstType(): ConstType { return constT.bls12_381_G2_element; }
}

/**
 * BLS12-381 Miller-loop result. Opaque native scalar produced by
 * `bls12_381_millerLoop` and consumed by `bls12_381_finalVerify` /
 * `bls12_381_mulMlResult`.
 */
export class TirMlResultT
    implements ITirType
{
    constructor() {}

    hasDataEncoding(): boolean { return false; }

    static toTirTypeKey(): string { return "#bls12_381_ml_result#"; }
    toTirTypeKey(): string { return TirMlResultT.toTirTypeKey(); }
    toConcreteTirTypeName(): string { return this.toTirTypeKey(); }
    toString(): string { return "MlResult"; }
    toAstName(): string { return "MlResult"; }
    isConcrete(): boolean { return true; }
    clone(): TirMlResultT { return new TirMlResultT(); }
    toUplcConstType(): ConstType { return constT.bls12_381_MlResult; }
}