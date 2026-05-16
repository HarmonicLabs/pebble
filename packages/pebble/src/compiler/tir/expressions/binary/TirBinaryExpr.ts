import { isObject } from "@harmoniclabs/obj-utils";
import { TirExpr } from "../TirExpr";
import { SourceRange } from "../../../../ast/Source/SourceRange";
import { ITirExpr } from "../ITirExpr";
import { TirType } from "../../types/TirType";
import { bool_t, bytes_t, int_t } from "../../program/stdScope/stdScope";
import { mergeSortedStrArrInplace } from "../../../../utils/array/mergeSortedStrArrInplace";
import { ToIRTermCtx } from "../ToIRTermCtx";
import { getUnaliased } from "../../types/utils/getUnaliased";
import { CEKConst, Machine } from "@harmoniclabs/plutus-machine";
import { TirBytesT } from "../../types/TirNativeType/native/bytes";
import { TirIntT } from "../../types/TirNativeType/native/int";
import { TirValueT } from "../../types/TirNativeType/native/value";
import { IRNative } from "../../../../IR/IRNodes/IRNative";
import type { IRTerm } from "../../../../IR/IRTerm";
import { IRConst } from "../../../../IR/IRNodes/IRConst";
import { compileIRToUPLC } from "../../../../IR/toUPLC/compileIRToUPLC";
import { _ir_apps } from "../../../../IR/IRNodes/IRApp";
import { _ir_lazyIfThenElse } from "../../../../IR/tree_utils/_ir_lazyIfThenElse";


export type TirBinaryExpr
    = TirExponentiationExpr
    | TirLessThanExpr
    | TirGreaterThanExpr
    | TirLessThanEqualExpr
    | TirGreaterThanEqualExpr
    | TirEqualExpr
    | TirNotEqualExpr
    | TirAddExpr
    | TirSubExpr
    | TirMultExpr
    | TirDivExpr
    | TirModuloExpr 
    | TirShiftLeftExpr
    | TirShiftRightExpr
    | TirBitwiseAndExpr
    | TirBitwiseXorExpr
    | TirBitwiseOrExpr
    | TirLogicalAndExpr
    | TirLogicalOrExpr
    ;

export function isTirBinaryExpr( thing: any ): thing is TirBinaryExpr
{
    return isObject( thing ) && (
        thing instanceof TirExponentiationExpr // int
        || thing instanceof TirLessThanExpr // bool
        || thing instanceof TirGreaterThanExpr // bool
        || thing instanceof TirLessThanEqualExpr // bool
        || thing instanceof TirGreaterThanEqualExpr // bool
        || thing instanceof TirEqualExpr // bool
        || thing instanceof TirNotEqualExpr // bool
        || thing instanceof TirAddExpr // int
        || thing instanceof TirSubExpr // int
        || thing instanceof TirMultExpr // int
        || thing instanceof TirDivExpr // int
        || thing instanceof TirModuloExpr // int
        || thing instanceof TirShiftLeftExpr // bytes
        || thing instanceof TirShiftRightExpr // bytes
        || thing instanceof TirBitwiseAndExpr // bytes
        || thing instanceof TirBitwiseXorExpr // bytes
        || thing instanceof TirBitwiseOrExpr // bytes
        || thing instanceof TirLogicalAndExpr // bool
        || thing instanceof TirLogicalOrExpr // bool
    );
}

export interface ITirBinaryExpr
    extends ITirExpr
{
    left: TirExpr;
    right: TirExpr;
}

export class TirExponentiationExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = int_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} ** ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} ** ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirExponentiationExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        return _ir_apps(
            IRNative._exponentiateInteger,
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirLessThanExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bool_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} < ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} < ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirLessThanExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const type = getUnaliased( this.left.type );
        const irFunc = (
            type instanceof TirIntT ? IRNative.lessThanInteger :
            type instanceof TirBytesT ? IRNative.lessThanByteString :
            undefined
        );
        if( !irFunc ) throw new Error("invalid left type for TirLessThanExpr");
        return _ir_apps(
            irFunc,
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirGreaterThanExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bool_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} > ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} > ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirGreaterThanExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const type = getUnaliased( this.left.type );
        const irFunc = (
            type instanceof TirIntT ? IRNative.lessThanInteger :
            type instanceof TirBytesT ? IRNative.lessThanByteString :
            undefined
        );
        if( !irFunc ) throw new Error("invalid left type for TirLessThanExpr");
        return _ir_apps(
            irFunc,
            // invert because we only have lessThan
            this.right.toIR( ctx ),
            this.left.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirLessThanEqualExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bool_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} <= ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} <= ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirLessThanEqualExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const type = getUnaliased( this.left.type );
        const irFunc = (
            type instanceof TirIntT ? IRNative.lessThanEqualInteger :
            type instanceof TirBytesT ? IRNative.lessThanEqualsByteString :
            undefined
        );
        if( !irFunc ) throw new Error("invalid left type for TirLessThanExpr");
        return _ir_apps(
            irFunc,
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirGreaterThanEqualExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bool_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} >= ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} >= ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirGreaterThanEqualExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const type = getUnaliased( this.left.type );
        const irFunc = (
            type instanceof TirIntT ? IRNative.lessThanEqualInteger :
            type instanceof TirBytesT ? IRNative.lessThanEqualsByteString :
            undefined
        );
        if( !irFunc ) throw new Error("invalid left type for TirLessThanExpr");
        return _ir_apps(
            irFunc,
            // invert because we only have lessThanEqual
            this.right.toIR( ctx ),
            this.left.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirEqualExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bool_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} === ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} === ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirEqualExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        return _ir_apps(
            IRNative.equals( this.left.type ),
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirNotEqualExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bool_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} !== ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} !== ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirNotEqualExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        return _ir_apps(
            IRNative._not,
            _ir_apps(
                IRNative.equals( this.left.type ),
                this.left.toIR( ctx ),
                this.right.toIR( ctx ),
            )
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

let n_logs = 0;

export class TirAddExpr
    implements ITirBinaryExpr
{
    private _creationStack: string | undefined;
    get type(): TirType
    {
        const leftType = getUnaliased( this.left.type );
        if( leftType instanceof TirValueT ) return this.left.type;
        if(
            leftType instanceof TirIntT
            || leftType instanceof TirBytesT
        ) return leftType;
        throw new Error("invalid type for addition");
    }
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {
    }

    toString(): string
    {
        return `(${this.left.toString()} + ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        n_logs++;
        if(!(n_logs % 100))console.log( this );
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} + ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirAddExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const type = getUnaliased( this.left.type );
        const irFunc = (
            type instanceof TirIntT ? IRNative.addInteger :
            type instanceof TirBytesT ? IRNative.appendByteString :
            type instanceof TirValueT ? IRNative.unionValue :
            undefined
        );
        if( !irFunc ) throw new Error("invalid left type for TirAddExpr");
        return _ir_apps(
            irFunc,
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirSubExpr
    implements ITirBinaryExpr
{
    get type(): TirType
    {
        const leftType = getUnaliased( this.left.type );
        if( leftType instanceof TirValueT ) return this.left.type;
        return int_t;
    }
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} - ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} - ${this.right.pretty(indent)})`;
    }

    clone(): TirExpr
    {
        return new TirSubExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const type = getUnaliased( this.left.type );
        if( type instanceof TirValueT ) {
            // a - b  →  unionValue a (negateValue b)
            return _ir_apps(
                IRNative.unionValue,
                this.left.toIR( ctx ),
                _ir_apps(
                    IRNative._negateValue,
                    this.right.toIR( ctx )
                )
            );
        }
        return _ir_apps(
            IRNative.subtractInteger,
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirMultExpr
    implements ITirBinaryExpr
{
    get type(): TirType
    {
        const leftTy  = getUnaliased( this.left.type );
        const rightTy = getUnaliased( this.right.type );
        if( leftTy instanceof TirValueT ) return this.left.type;
        if( rightTy instanceof TirValueT ) return this.right.type;
        return int_t;
    }
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} * ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} * ${this.right.pretty(indent)})`;
    }

    clone(): TirExpr
    {
        return new TirMultExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const leftTy  = getUnaliased( this.left.type );
        const rightTy = getUnaliased( this.right.type );

        // scaleValue :: int -> Value -> Value
        if( leftTy instanceof TirValueT ) {
            // Value * int  →  scaleValue int Value
            return _ir_apps(
                IRNative.scaleValue,
                this.right.toIR( ctx ),
                this.left.toIR( ctx ),
            );
        }
        if( rightTy instanceof TirValueT ) {
            // int * Value  →  scaleValue int Value
            return _ir_apps(
                IRNative.scaleValue,
                this.left.toIR( ctx ),
                this.right.toIR( ctx ),
            );
        }

        return _ir_apps(
            IRNative.multiplyInteger,
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirDivExpr 
    implements ITirBinaryExpr
{
    readonly type: TirType = int_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} / ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} / ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirDivExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        return _ir_apps(
            IRNative.divideInteger,
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirModuloExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = int_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} % ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} % ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirModuloExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        return _ir_apps(
            IRNative.modInteger,
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirShiftLeftExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bytes_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} << ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} << ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirShiftLeftExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        return _ir_apps(
            // positive shift implies left
            IRNative.shiftByteString,
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirShiftRightExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bytes_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} >> ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} >> ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirShiftRightExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        let nIr: IRTerm = this.right.toIR( ctx );
        if( this.right.isConstant )
        {
            const result = Machine.evalSimple( compileIRToUPLC( nIr ) );
            if(
                result instanceof CEKConst
                && (typeof result.value === "bigint"
                || typeof result.value === "number")
            ) {
                const n = BigInt( result.value );
                // positive shift implies left
                if( n >= 0n ) {
                    nIr = IRConst.int( -n );
                }
                else {
                    nIr = _ir_apps(
                        IRNative._negateInt,
                        nIr
                    );
                }
            }
            else nIr = _ir_apps(
                IRNative._negateInt,
                nIr
            );
        }
        else nIr = _ir_apps(
            IRNative._negateInt,
            nIr
        );

        return _ir_apps(
            IRNative.shiftByteString,
            this.left.toIR( ctx ),
            nIr,
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirBitwiseAndExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bytes_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} & ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} & ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirBitwiseAndExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        return _ir_apps(
            IRNative.andByteString,
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirBitwiseXorExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bytes_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} ^ ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} ^ ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirBitwiseXorExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        return _ir_apps(
            IRNative.xorByteString,
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirBitwiseOrExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bytes_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} | ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} | ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirBitwiseOrExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        return _ir_apps(
            IRNative.orByteString,
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export class TirLogicalAndExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bool_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} && ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} && ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirLogicalAndExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        return _ir_and(
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export function _ir_and( left: IRTerm, right: IRTerm ): IRTerm
{
    return _ir_lazyIfThenElse(
        // condition
        left,
        // then
        right,
        // else
        IRConst.bool( false )
    );
}

export class TirLogicalOrExpr
    implements ITirBinaryExpr
{
    readonly type: TirType = bool_t;
    constructor(
        public left: TirExpr,
        public right: TirExpr,
        readonly range: SourceRange
    ) {}

    toString(): string
    {
        return `(${this.left.toString()} || ${this.right.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `(${this.left.pretty(indent)} || ${this.right.pretty(indent)})`;
    }
    
    clone(): TirExpr
    {
        return new TirLogicalOrExpr(
        	this.left.clone(),
        	this.right.clone(),
        	this.range.clone()
        );
    }

    get isConstant(): boolean { return this.left.isConstant && this.right.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        return _ir_or(
            this.left.toIR( ctx ),
            this.right.toIR( ctx ),
        );
    }

    deps(): string[]
    {
        const deps = this.left.deps();
        mergeSortedStrArrInplace( deps, this.right.deps() );
        return deps;
    }
}

export function _ir_or( left: IRTerm, right: IRTerm ): IRTerm
{
    return _ir_lazyIfThenElse(
        // condition
        left,
        // then
        IRConst.bool( true ),
        // else
        right
    );
}