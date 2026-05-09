import { SourceRange } from "../../../ast/Source/SourceRange";
import { _ir_apps } from "../../../IR/IRNodes/IRApp";
import { IRCase } from "../../../IR/IRNodes/IRCase";
import { IRConst } from "../../../IR/IRNodes/IRConst";
import { IRFunc } from "../../../IR/IRNodes/IRFunc";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import type { IRTerm } from "../../../IR/IRTerm";
import { TirBoolT } from "../types/TirNativeType/native/bool";
import { TirDataStructType, TirSoPStructType, TirStructType } from "../types/TirStructType";
import { getUnaliased } from "../types/utils/getUnaliased";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";

export class TirIsExpr
    implements ITirExpr
{
    readonly type: TirBoolT;

    constructor(
        public instanceExpr: TirExpr,
        readonly ctorName: string,
        /** index in the *parent* (un-narrowed) struct's `constructors` array */
        readonly parentCtorIdx: number,
        readonly range: SourceRange,
        boolType: TirBoolT,
    ) {
        this.type = boolType;
    }

    toString(): string {
        return `(${this.instanceExpr.toString()} is ${this.ctorName})`;
    }

    pretty( indent: number ): string {
        return `(${this.instanceExpr.pretty( indent )} is ${this.ctorName})`;
    }

    clone(): TirIsExpr {
        return new TirIsExpr(
            this.instanceExpr.clone() as TirExpr,
            this.ctorName,
            this.parentCtorIdx,
            this.range.clone(),
            this.type.clone() as TirBoolT,
        );
    }

    deps(): string[] {
        return this.instanceExpr.deps();
    }

    get isConstant(): boolean { return this.instanceExpr.isConstant; }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const structType = getUnaliased( this.instanceExpr.type ) as TirStructType;

        if( structType instanceof TirDataStructType )
        {
            // equalsInteger(parentCtorIdx, fstPair(unConstrData(<instance>)))
            return _ir_apps(
                IRNative.equalsInteger,
                IRConst.int( this.parentCtorIdx ),
                _ir_apps(
                    IRNative.fstPair,
                    _ir_apps(
                        IRNative.unConstrData,
                        this.instanceExpr.toIR( ctx )
                    )
                )
            );
        }

        if( structType instanceof TirSoPStructType )
        {
            // we need a branch in the IRCase per ORIGINAL parent constructor.
            // the type system has narrowed `instanceExpr.type`, but at runtime
            // the value is still a Constr from the parent universe; if the
            // current type is narrowed, we use its parent-idx mapping.
            const localToParent = structType.narrowedFromParentCtorIdxs
                ?? structType.constructors.map( ( _, i ) => i );

            // We need to size the IRCase to the maximum parent index we know about.
            // For pure narrowing of an SoP value at runtime, we still see ALL
            // parent constructors. Without access to the un-narrowed type here,
            // we trust the constructor list reflects the runtime layout when
            // `structType` is un-narrowed; when narrowed we still ALSO need to
            // produce a complete IRCase for the underlying value.
            //
            // For the un-narrowed case (structType.constructors enumerates all
            // runtime variants) this is correct. For a narrowed SoP (where the
            // local constructors array is smaller than the runtime arity), we
            // must emit a branch for every original parent slot up to `max + 1`
            // and treat anything outside the narrowed set as "false".
            const maxParentIdx = localToParent.reduce( ( m, x ) => x > m ? x : m, -1 );
            const branchCount = maxParentIdx + 1;

            const branches: IRTerm[] = new Array( branchCount );
            for( let parentIdx = 0; parentIdx < branchCount; parentIdx++ )
            {
                // find the local constructor for this parent index, if any
                const localIdx = localToParent.indexOf( parentIdx );
                const matches = parentIdx === this.parentCtorIdx;
                const body = IRConst.bool( matches );

                // we don't know the field arity for parent slots that have
                // been narrowed away. Use the local ctor if present;
                // otherwise no params (best-effort: narrowed-away slots
                // shouldn't be reachable at runtime in well-typed code).
                const fields = localIdx >= 0 ? structType.constructors[ localIdx ].fields.length : 0;
                if( fields <= 0 ) {
                    branches[ parentIdx ] = body;
                } else {
                    const introduced = Array( fields ).fill( 0 ).map( () => Symbol("_") );
                    branches[ parentIdx ] = new IRFunc( introduced, body );
                }
            }

            return new IRCase(
                this.instanceExpr.toIR( ctx ),
                branches
            );
        }

        throw new Error(
            "`is` operator can only be applied to struct types; got: "
            + this.instanceExpr.type.toString()
        );
    }
}
