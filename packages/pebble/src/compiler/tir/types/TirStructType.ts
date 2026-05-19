import { isObject } from "@harmoniclabs/obj-utils";
import { TirInterfaceImpl } from "./TirInterfaceImpl";
import { ITirType, TirType } from "./TirType";
import { AstFuncName, TirFuncName } from "../../AstCompiler/scope/AstScope";
import { constT, ConstType } from "@harmoniclabs/uplc";

export interface ITirStructType extends ITirType {
    readonly name: string;
    readonly fileUid: string;
    readonly constructors: TirStructConstr[];
    /** points to an array possibly shared with alternative encoding types */
    readonly methodNamesPtr: Map<AstFuncName, TirFuncName>,
}

export type TirStructType
    = TirDataStructType
    | TirSoPStructType
    ;

export function isTirStructType( thing: any ): thing is TirStructType
{
    return isObject( thing ) && (
        thing instanceof TirDataStructType
        || thing instanceof TirSoPStructType
    );
}

export class TirDataStructType
    implements ITirStructType
{
    /**
     * indexes (in the ORIGINAL parent struct's constructors array) of the
     * constructors still possible after flow-sensitive narrowing.
     *
     * `undefined` means "not narrowed" (full struct).
     * If present, length matches `this.constructors.length` and entries
     * correspond positionally to `this.constructors`.
     */
    readonly narrowedFromParentCtorIdxs: number[] | undefined;

    constructor(
        readonly name: string,
        readonly fileUid: string,
        readonly constructors: TirStructConstr[],
        /** points to an array possibly shared with alternative encoding types */
        readonly methodNamesPtr: Map<AstFuncName, TirFuncName>,
        readonly untagged: boolean = false,
        narrowedFromParentCtorIdxs: number[] | undefined = undefined,
    ) {
        // `untagged === true` requires a single constructor — its runtime
        // form is `listData(fields)` instead of `constrData(idx, fields)`.
        if( untagged && constructors.length !== 1 ) {
            throw new Error(
                "untagged data struct must have exactly one constructor; got "
                + constructors.length
            );
        }
        this.narrowedFromParentCtorIdxs = narrowedFromParentCtorIdxs;
    }

    hasDataEncoding(): boolean { return true; }

    toTirTypeKey(): string {
        return "data_" + this.name + "_" + this.fileUid;
    }
    toConcreteTirTypeName(): string {
        return this.toTirTypeKey();
    }

    isSingleConstr(): boolean {
        return this.constructors.length === 1;
    }

    isNarrowed(): boolean {
        return this.narrowedFromParentCtorIdxs !== undefined;
    }

    /**
     * Original ctor index of `this.constructors[localIdx]` in the
     * un-narrowed parent type. For un-narrowed types this is identity.
     */
    parentCtorIdx( localIdx: number ): number {
        return this.narrowedFromParentCtorIdxs?.[localIdx] ?? localIdx;
    }

    /**
     * Returns a clone of this struct type narrowed to the constructors
     * whose ORIGINAL parent indexes are listed in `parentIdxs`.
     */
    narrowTo( parentIdxs: number[] ): TirDataStructType
    {
        const baseIdxs = this.narrowedFromParentCtorIdxs ?? this.constructors.map( ( _, i ) => i );
        const filtered: number[] = [];
        const filteredCtors: TirStructConstr[] = [];
        for( let i = 0; i < this.constructors.length; i++ )
        {
            const parentIdx = baseIdxs[i];
            if( parentIdxs.includes( parentIdx ) )
            {
                filtered.push( parentIdx );
                filteredCtors.push( this.constructors[i] );
            }
        }
        return new TirDataStructType(
            this.name,
            this.fileUid,
            filteredCtors,
            this.methodNamesPtr,
            this.untagged,
            filtered
        );
    }

    toString(): string {
        return this.name;
    }
    toAstName(): string {
        return this.toString();
    }

    protected _isConcrete: boolean | undefined = undefined;
    isConcrete(): boolean {
        if( typeof this._isConcrete !== "boolean" )
            this._isConcrete = this.constructors.every(
                c => c.isConcrete()
            );
        return this._isConcrete;
    }

    clone(): TirDataStructType
    {
        const result = new TirDataStructType(
            this.name,
            this.fileUid,
            this.constructors.map( c => c.clone() ),
            this.methodNamesPtr,
            this.untagged,
            this.narrowedFromParentCtorIdxs ? [ ...this.narrowedFromParentCtorIdxs ] : undefined
        );
        result._isConcrete = this._isConcrete;
        return result;
    }

    toUplcConstType(): ConstType {
        return constT.data
    }
}

export class TirSoPStructType
    implements ITirStructType
{
    /**
     * indexes (in the ORIGINAL parent struct's constructors array) of the
     * constructors still possible after flow-sensitive narrowing.
     *
     * `undefined` means "not narrowed" (full struct).
     * If present, length matches `this.constructors.length`.
     */
    readonly narrowedFromParentCtorIdxs: number[] | undefined;

    constructor(
        readonly name: string,
        readonly fileUid: string,
        readonly constructors: TirStructConstr[],
        /** points to an array possibly shared with alternative encoding types */
        readonly methodNamesPtr: Map<AstFuncName, TirFuncName>,
        narrowedFromParentCtorIdxs: number[] | undefined = undefined,
    ) {
        this.narrowedFromParentCtorIdxs = narrowedFromParentCtorIdxs;
    }

    hasDataEncoding(): boolean { return false; }

    toTirTypeKey(): string {
        return "sop_" + this.name + "_" + this.fileUid;
    }
    toConcreteTirTypeName(): string {
        return this.toTirTypeKey();
    }

    isSingleConstr(): boolean {
        return this.constructors.length === 1;
    }

    isNarrowed(): boolean {
        return this.narrowedFromParentCtorIdxs !== undefined;
    }

    parentCtorIdx( localIdx: number ): number {
        return this.narrowedFromParentCtorIdxs?.[localIdx] ?? localIdx;
    }

    narrowTo( parentIdxs: number[] ): TirSoPStructType
    {
        const baseIdxs = this.narrowedFromParentCtorIdxs ?? this.constructors.map( ( _, i ) => i );
        const filtered: number[] = [];
        const filteredCtors: TirStructConstr[] = [];
        for( let i = 0; i < this.constructors.length; i++ )
        {
            const parentIdx = baseIdxs[i];
            if( parentIdxs.includes( parentIdx ) )
            {
                filtered.push( parentIdx );
                filteredCtors.push( this.constructors[i] );
            }
        }
        return new TirSoPStructType(
            this.name,
            this.fileUid,
            filteredCtors,
            this.methodNamesPtr,
            filtered
        );
    }

    toString(): string {
        return this.name;
    }
    toAstName(): string {
        return this.toString();
    }

    protected _isConcrete: boolean | undefined = undefined;
    isConcrete(): boolean {
        if( typeof this._isConcrete !== "boolean" )
            this._isConcrete = this.constructors.every(
                c => c.isConcrete()
            );
        return this._isConcrete;
    }

    clone(): TirSoPStructType
    {
        const result = new TirSoPStructType(
            this.name,
            this.fileUid,
            this.constructors.map( c => c.clone() ),
            this.methodNamesPtr,
            this.narrowedFromParentCtorIdxs ? [ ...this.narrowedFromParentCtorIdxs ] : undefined
        );
        result._isConcrete = this._isConcrete;
        return result;
    }

    toUplcConstType(): ConstType {
        throw new Error("SoP struct cannot be represented as uplc constants.");
    }
}

export class TirStructConstr
{
    constructor(
        readonly name: string,
        readonly fields: TirStructField[]
    ) {}

    toString(): string {
        return this.name;
    }

    isConcrete(): boolean {
        return this.fields.every(
            f => f.isConcrete()
        );
    }

    clone(): TirStructConstr
    {
        return new TirStructConstr(
            this.name,
            this.fields.map( f => f.clone() )
        );
    }
}

export class TirStructField
{
    constructor(
        readonly name: string,
        readonly type: TirType
    ) {}

    isConcrete(): boolean {
        return this.type.isConcrete();
    }

    clone(): TirStructField
    {
        return new TirStructField(
            this.name,
            this.type.clone()
        );
    }
}