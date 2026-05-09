import { SourceRange } from "../../../ast/Source/SourceRange";
import { ITirExpr } from "./ITirExpr";
import { TirSimpleVarDecl } from "../statements/TirVarDecl/TirSimpleVarDecl";
import { TirType } from "../types/TirType";
import { TirBlockStmt } from "../statements/TirBlockStmt";
import { mergeSortedStrArrInplace } from "../../../utils/array/mergeSortedStrArrInplace";
import { filterSortedStrArrInplace } from "../../../utils/array/filterSortedStrArrInplace";
import { ToIRTermCtx } from "./ToIRTermCtx";
import { IRRecursive } from "../../../IR/IRNodes/IRRecursive";
import { TirReturnStmt } from "../statements/TirReturnStmt";
import { TirFuncT } from "../types/TirNativeType/native/function";
import { IRTerm } from "../../../IR/IRTerm";
import { IRFunc } from "../../../IR/IRNodes/IRFunc";
import { IRDelayed } from "../../../IR/IRNodes/IRDelayed";
import type { TirExpr } from "./TirExpr";

export class TirFuncExpr
    implements ITirExpr
{ 
    get type(): TirFuncT
    {
        return this.sig();
    }
    sig(): TirFuncT
    {
        return new TirFuncT(
            this.params.map( p => p.type ),
            this.returnType
        );
    }
    
    constructor(
        readonly name: string,
        // deconstructions are inlined in the body
        readonly params: TirSimpleVarDecl[],
        // initialized to symbol while inferring
        public returnType: TirType,
        // in case of lambdas (that only specifies a return expression)
        // this is just a return statement wrapped in a block
        // (with decosntructed arguments if any) 
        readonly body: TirBlockStmt,
        readonly range: SourceRange,
        private readonly _isLoop: boolean = false,
    ) {}

    toString(): string
    {
        return (
            `function ${this.name}` +
            `( ${this.params.map( p => p.toString() ).join(", ")} )` +
            `: ${this.returnType.toString()} ` +
            `${this.body.toString()}`
        );
    }
    
    pretty( indent: number = 1 ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat( indent );
        const indent_0 = "\n" + indent_base;
        const indent_1 = indent_0 + singleIndent;
        return (
            `function ${this.name}(` +
            indent_1 + this.params.map( p => p.pretty( indent + 1 ) ).join( `,${indent_1}` ) +
            `${indent_0}): ${this.returnType.toString()} ` +
            this.body.pretty( indent )
        );
    }

    clone(): TirExpr
    {
        return new TirFuncExpr(
            this.name,
            this.params.slice(),
            this.returnType.clone(),
            this.body,
            this.range.clone(),
            this._isLoop
        );
    }

    // / **
    //  * `true` if the function is guaranteed to never error
    //  * /
    // readonly isSafe: boolean = false;
    // / **
    //  * `true` if, for all cases where the function can error,
    //  * there is an alternative implementation that is safe (wrapping the result as `Optional`)
    //  * /
    // readonly isRecoverable: boolean = false;

    isAnonymous(): boolean
    {
        return this.name === "";
    }
    
    private _deps: string[] | undefined = undefined;
    private _defineDeps(): void
    {
        if( Array.isArray( this._deps ) ) return;

        const { introducedVars, deps } = this.params.reduce(( acc, param ) => {
            mergeSortedStrArrInplace(
                acc.deps,
                filterSortedStrArrInplace(
                    param.deps(),
                    acc.introducedVars
                )
            );
            mergeSortedStrArrInplace( acc.introducedVars, param.introducedVars() );
            return acc;
        }, { introducedVars: [], deps: [] });

        mergeSortedStrArrInplace( deps, this.body.deps() );
        filterSortedStrArrInplace( deps, introducedVars );

        this._deps = deps;
    }
    deps(): string[]
    {
        this._defineDeps();
        return this._deps!.slice();
    }

    private _isRecursive: boolean = false;
    isRecursive(): boolean
    {
        if( this._isLoop || this._isRecursive ) return true;
        this._defineDeps();
        this._isRecursive = this._deps!.includes( this.name );
        return this._isRecursive;
    }

    readonly isConstant: boolean = false;

    toIR(ctx: ToIRTermCtx): IRTerm
    {
        const returnStmt = this.body.stmts[0];
        if(!( returnStmt instanceof TirReturnStmt ))
        throw new Error("function must be expressified before being converted to IR");
        const expr = returnStmt.value;

        const isRecursive = this.isRecursive();

        ctx = ctx.newChild();
        let recursiveVarSym: symbol | undefined = undefined;
        if( isRecursive ) recursiveVarSym = ctx.defineRecursiveVar( this.name );
        const introuducedVars = this.params.map( param => ctx.defineVar( param.name ) );

        let irFunc: IRTerm = this.params.length === 0
            ? new IRDelayed( expr.toIR( ctx ) )
            : new IRFunc( introuducedVars, expr.toIR( ctx ) );
        if( isRecursive ) irFunc = new IRRecursive( recursiveVarSym!, irFunc );

        return irFunc;
    }
}
