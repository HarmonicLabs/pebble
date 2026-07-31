import { isObject } from "@harmoniclabs/obj-utils";
import { TirInterfaceImpl } from "./TirInterfaceImpl";
import { ITirType, TirType } from "./TirType";
import { AstFuncName, TirFuncName } from "../../AstCompiler/scope/AstScope";
import { constT, ConstType } from "@harmoniclabs/uplc";
import { getAppliedTirTypeName } from "../program/getAppliedTirTypeName";

/**
 * Present on a struct type produced by applying a generic struct template
 * (e.g. `Box<int>` from `struct Box<T>`). Records the base name and the
 * (possibly still symbolic) type arguments so `substituteTypeParams` can
 * re-derive the applied `name` after substituting the arguments — the name
 * is the struct's identity in `canAssignStruct`, so it MUST track the args.
 */
export interface AppliedGenericStructInfo {
    /** AST-level base name of the generic struct, e.g. `Box` */
    readonly baseName: string;
    /** type arguments this struct was applied to (possibly symbolic) */
    readonly args: readonly TirType[];
}

/**
 * Display/identity name of a generic struct applied to `args`, e.g. `Box<int>`.
 * Symbolic arguments (embedding a `TirTypeParam`) fall back to `toString()`
 * because `toConcreteTirTypeName()` throws on them.
 */
export function getAppliedStructTypeName(
    baseName: string,
    args: readonly TirType[]
): string
{
    return getAppliedTirTypeName(
        baseName,
        args.map( a => a.isConcrete() ? a.toConcreteTirTypeName() : a.toString() )
    );
}

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

    /** set when this struct is an instantiation of a generic struct template */
    readonly appliedGeneric: AppliedGenericStructInfo | undefined;

    /** `constructors` is mutable ONLY through `fillConstructors` (recursion
     * support: the type object is registered BEFORE its fields compile, so
     * self-references resolve to it by reference). */
    constructors: TirStructConstr[];
    untagged: boolean;

    private _filled: boolean = true;
    /** `false` while this is a forward-declared placeholder whose
     * constructors have not been compiled yet */
    isFilled(): boolean { return this._filled; }

    constructor(
        readonly name: string,
        readonly fileUid: string,
        constructors: TirStructConstr[],
        /** points to an array possibly shared with alternative encoding types */
        readonly methodNamesPtr: Map<AstFuncName, TirFuncName>,
        untagged: boolean = false,
        narrowedFromParentCtorIdxs: number[] | undefined = undefined,
        appliedGeneric: AppliedGenericStructInfo | undefined = undefined,
    ) {
        // `untagged === true` requires a single constructor — its runtime
        // form is `listData(fields)` instead of `constrData(idx, fields)`.
        if( untagged && constructors.length !== 1 ) {
            throw new Error(
                "untagged data struct must have exactly one constructor; got "
                + constructors.length
            );
        }
        this.constructors = constructors;
        this.untagged = untagged;
        this.narrowedFromParentCtorIdxs = narrowedFromParentCtorIdxs;
        this.appliedGeneric = appliedGeneric;
    }

    /**
     * Forward-declared placeholder: registered (by reference) before its
     * field types compile, so recursive/sibling references resolve to it.
     * MUST be completed with `fillConstructors`.
     */
    static unfilled(
        name: string,
        fileUid: string,
        methodNamesPtr: Map<AstFuncName, TirFuncName>,
        appliedGeneric: AppliedGenericStructInfo | undefined = undefined,
        narrowedFromParentCtorIdxs: number[] | undefined = undefined,
    ): TirDataStructType
    {
        const t = new TirDataStructType( name, fileUid, [], methodNamesPtr, false, narrowedFromParentCtorIdxs, appliedGeneric );
        t._filled = false;
        return t;
    }

    fillConstructors( constructors: TirStructConstr[], untagged: boolean = false ): void
    {
        if( untagged && constructors.length !== 1 ) {
            throw new Error(
                "untagged data struct must have exactly one constructor; got "
                + constructors.length
            );
        }
        this.constructors = constructors;
        this.untagged = untagged;
        this._filled = true;
        this._isConcrete = undefined; // reset memo computed while unfilled
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
            filtered,
            this.appliedGeneric
        );
    }

    toString(): string {
        return this.name;
    }
    toAstName(): string {
        return this.toString();
    }

    protected _isConcrete: boolean | undefined = undefined;
    private _computingIsConcrete: boolean = false;
    isConcrete(): boolean {
        if( typeof this._isConcrete === "boolean" ) return this._isConcrete;
        // recursive struct: a back-edge to a type still being walked is not
        // what makes it non-concrete (recursion never introduces a type
        // param); answer `true` for the back-edge and only memoize the
        // result of a COMPLETE walk.
        if( this._computingIsConcrete ) return true;
        this._computingIsConcrete = true;
        try {
            this._isConcrete = this.constructors.every(
                c => c.isConcrete()
            );
        } finally {
            this._computingIsConcrete = false;
        }
        return this._isConcrete;
    }

    clone(): TirDataStructType
    {
        // interning: struct types are never mutated after creation (filling
        // a forward-declared placeholder is completion, not mutation), and a
        // deep clone of a RECURSIVE struct would never terminate.
        return this;
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

    /** set when this struct is an instantiation of a generic struct template */
    readonly appliedGeneric: AppliedGenericStructInfo | undefined;

    /** see `TirDataStructType.constructors` — mutable only via `fillConstructors` */
    constructors: TirStructConstr[];

    private _filled: boolean = true;
    /** `false` while this is a forward-declared placeholder whose
     * constructors have not been compiled yet */
    isFilled(): boolean { return this._filled; }

    constructor(
        readonly name: string,
        readonly fileUid: string,
        constructors: TirStructConstr[],
        /** points to an array possibly shared with alternative encoding types */
        readonly methodNamesPtr: Map<AstFuncName, TirFuncName>,
        narrowedFromParentCtorIdxs: number[] | undefined = undefined,
        appliedGeneric: AppliedGenericStructInfo | undefined = undefined,
    ) {
        this.constructors = constructors;
        this.narrowedFromParentCtorIdxs = narrowedFromParentCtorIdxs;
        this.appliedGeneric = appliedGeneric;
    }

    /** see `TirDataStructType.unfilled` */
    static unfilled(
        name: string,
        fileUid: string,
        methodNamesPtr: Map<AstFuncName, TirFuncName>,
        appliedGeneric: AppliedGenericStructInfo | undefined = undefined,
        narrowedFromParentCtorIdxs: number[] | undefined = undefined,
    ): TirSoPStructType
    {
        const t = new TirSoPStructType( name, fileUid, [], methodNamesPtr, narrowedFromParentCtorIdxs, appliedGeneric );
        t._filled = false;
        return t;
    }

    fillConstructors( constructors: TirStructConstr[] ): void
    {
        this.constructors = constructors;
        this._filled = true;
        this._isConcrete = undefined; // reset memo computed while unfilled
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
            filtered,
            this.appliedGeneric
        );
    }

    toString(): string {
        return this.name;
    }
    toAstName(): string {
        return this.toString();
    }

    protected _isConcrete: boolean | undefined = undefined;
    private _computingIsConcrete: boolean = false;
    isConcrete(): boolean {
        if( typeof this._isConcrete === "boolean" ) return this._isConcrete;
        // see `TirDataStructType.isConcrete` — back-edges answer `true`
        if( this._computingIsConcrete ) return true;
        this._computingIsConcrete = true;
        try {
            this._isConcrete = this.constructors.every(
                c => c.isConcrete()
            );
        } finally {
            this._computingIsConcrete = false;
        }
        return this._isConcrete;
    }

    clone(): TirSoPStructType
    {
        // interning — see `TirDataStructType.clone`
        return this;
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