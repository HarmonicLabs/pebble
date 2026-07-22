import { SourceRange } from "../../../ast/Source/SourceRange";
import { IRHoisted } from "../../../IR/IRNodes/IRHoisted";
import type { IRTerm } from "../../../IR/IRTerm";
import { TirType } from "../types/TirType";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";


/**
 * per-expression cache of the IR conversion of hoisted bodies.
 *
 * keyed by TIR object identity (all `TirHoistedExpr` wrappers of the same
 * function/constant share the underlying expression — see `clone` below);
 * a WeakMap so entries die with the compilation's TIR.
 */
const _hoistedIrCache = new WeakMap<TirExpr, IRTerm>();

export class TirHoistedExpr
    implements ITirExpr
{
    get type(): TirType {
        return this.expr.type;
    }

    get range(): SourceRange {
        return this.expr.range;
    }

    constructor(
        readonly varName: string,
        public expr: TirExpr
    ) {}

    toString(): string
    {
        return `/*hoisted '${this.varName}'*/(${this.expr.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `/*hoisted '${this.varName}'*/(${this.expr.pretty(indent)})`;
    }

    clone(): TirExpr
    {
        // deliberately SHARE the inner expression (no deep clone): hoisted
        // terms are closed and are never mutated after being expressified,
        // and sharing lets `toIR` below recognize every call site of the
        // same function/constant and emit hash-identical IR for all of
        // them — which is what the IR-level dedup (handleLetted /
        // handleHoisted, both content-hash based) needs in order to bind
        // the body ONCE instead of inlining a copy at every call site.
        return new TirHoistedExpr(
            this.varName,
            this.expr,
        );
    }

    deps(): string[] {
        return this.expr.deps();
    }

    unsafeClone(): TirHoistedExpr
    {
        return new TirHoistedExpr(
            this.varName,
            this.expr, // this.expr.clone(),
        );
    }

    get isConstant(): boolean { return this.expr.isConstant; }
    
    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        // hoisted terms are closed by definition — convert with a fresh
        // root ctx so bindings of the call-site scope (e.g. case-arm
        // deferred field accesses that happen to share a name with the
        // hoisted function's params) can never leak into the hoisted body.
        //
        // memoize the conversion per underlying expression: IR hashing is
        // symbol-identity based, so converting the same function once per
        // call site would produce hash-DIFFERENT (alpha-equivalent) copies
        // that the IR dedup can't recognize as the same term — the body
        // would then be inlined at every call site, multiplying script
        // size. `IRTerm.clone()` preserves symbols, so every call site
        // gets a distinct tree with the SAME hash.
        const cached = _hoistedIrCache.get( this.expr );
        if( cached ) return new IRHoisted( cached.clone() );

        const converted: IRTerm = this.expr.toIR( ToIRTermCtx.root() );
        _hoistedIrCache.set( this.expr, converted );
        return new IRHoisted( converted.clone() );
    }
}