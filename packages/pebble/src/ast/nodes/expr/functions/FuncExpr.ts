import { CommonFlags } from "../../../../common";
import { SourceRange } from "../../../Source/SourceRange";
import { Identifier } from "../../common/Identifier";
import { HasSourceRange } from "../../HasSourceRange";
import { BlockStmt } from "../../statements/BlockStmt";
import { FuncDecl } from "../../statements/declarations/FuncDecl";
import { ReturnStmt } from "../../statements/ReturnStmt";
import { AstTypeExpr } from "../../types/AstTypeExpr";
import { AstFuncType } from "../../types/AstNativeTypeExpr";
import { PebbleExpr } from "../PebbleExpr";
import { ArrowKind } from "./ArrowKind";

/**
 * A declared type parameter on a function declaration. Optionally constrained
 * to an interface via `<T implements I>` syntax — when set, every concrete
 * instantiation of the generic function must provide a type that implements
 * `I`, and the compiler threads an implicit `I`-dictionary argument through
 * the function body (see `monomorphizeGeneric`).
 */
export class TypeParamDecl implements HasSourceRange
{
    constructor(
        readonly name: Identifier,
        readonly constraint: AstTypeExpr | undefined,
        readonly range: SourceRange,
    ) {}
}

/**
 * a litteral function value
**/
export class FuncExpr implements HasSourceRange
{
    constructor(
        readonly name: Identifier,
        readonly flags: CommonFlags,
        readonly typeParams: TypeParamDecl[],
        readonly signature: AstFuncType,
        public body: BlockStmt | PebbleExpr,
        readonly arrowKind: ArrowKind,
        readonly range: SourceRange
    ) {}

    bodyBlockStmt(): BlockStmt
    {
        return (this.body instanceof BlockStmt ? this.body :
            new BlockStmt(
                [ new ReturnStmt( this.body, this.body.range ) ],
                this.body.range
            )
        );
    }
}