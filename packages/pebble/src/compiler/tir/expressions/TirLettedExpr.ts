import { SourceRange } from "../../../ast/Source/SourceRange";
import { debugCreationStack } from "../../../utils/debugCreationStack";
import { IRLetted } from "../../../IR/IRNodes/IRLetted";
import type { IRTerm } from "../../../IR/IRTerm";
import { TirType } from "../types/TirType";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";
import { currentDebug } from "../../debug/DebugCollector";
import { stampVarValue } from "../../../IR/sourceMap/irDebug";

export class TirLettedExpr
    implements ITirExpr
{
    private _creationStack: string | undefined = undefined;
    get type(): TirType {
        return this.expr.type;
    }

    private readonly _irVarSym: symbol;

    constructor(
        readonly varName: string,
        public expr: TirExpr,
        readonly range: SourceRange,
        _unsafeVarSym?: symbol | undefined,
        _creationStack?: string | undefined,
        /** see `IRLettedMeta.siteScoped` */
        readonly siteScoped: boolean = false,
        /** see `IRLettedMeta.eagerFnScope` */
        readonly eagerFnScope: boolean = false,
    ) {
        if(!(
            typeof varName === "string"
            && varName.length > 0
        )) throw new Error("TirLettedExpr: varName must be a non empty string");

        this._creationStack = _creationStack ?? debugCreationStack();

        this._irVarSym = (
            typeof _unsafeVarSym === "symbol"
            && _unsafeVarSym.description === varName
        ) ? _unsafeVarSym : Symbol( varName );
    }

    toString(): string
    {
        return `/*letted '${this.varName}'*/(${this.expr.toString()})`;
    }
    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        const indent_0 = "\n" + indent_base;
        return `/*letted '${this.varName}'*/(${indent_0}${this.expr.pretty(indent)}${indent_0})`;
    }

    deps(): string[] {
        return this.expr.deps();
    }

    clone(): TirExpr
    {
        return this.cloneAtUse( this.range );
    }

    /**
     * like `cloneAtUse`, but sharing the value's expression,
     * for the places that hand out this same object to every use
     */
    withUseRange( useRange: SourceRange ): TirLettedExpr
    {
        return new TirLettedExpr(
            this.varName,
            this.expr,
            useRange,
            this._irVarSym,
            this._creationStack,
            this.siteScoped,
            this.eagerFnScope
        );
    }

    /** a clone standing for one use of the variable: its IR takes the use's range */
    cloneAtUse( useRange: SourceRange ): TirLettedExpr
    {
        return new TirLettedExpr(
            this.varName,
            this.expr.clone() as any,
            useRange.clone(),
            this._irVarSym,
            this._creationStack,
            this.siteScoped,
            this.eagerFnScope
        );
    }
    
    get isConstant(): boolean { return this.expr.isConstant; }

    /** the symbol every use of this value shares (debug information keys variables by it) */
    get irVarSym(): symbol { return this._irVarSym; }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        const letted = new IRLetted(
            this._irVarSym,
            this.expr.toIR( ctx ),
            {
                ...( this.siteScoped ? { siteScoped: true } : {} ),
                ...( this.eagerFnScope ? { eagerFnScope: true } : {} ),
            }
        );
        // debug information: wherever the value ends up (inlined, bound, hoisted), it is
        // the value of the variables this letted holds
        const bindings = currentDebug()?.bindingsOfSymbol( this._irVarSym );
        if( bindings !== undefined )
        {
            stampVarValue( letted, bindings );
            stampVarValue( letted.value, bindings );
        }
        return letted;
    }
}