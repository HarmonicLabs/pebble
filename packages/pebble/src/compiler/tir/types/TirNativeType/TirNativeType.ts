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