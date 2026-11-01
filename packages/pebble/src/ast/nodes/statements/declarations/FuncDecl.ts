import { SourceRange } from "../../../Source/SourceRange";
import { HasSourceRange } from "../../HasSourceRange";
import { FuncExpr } from "../../expr/functions/FuncExpr";

export class FuncDecl
    implements HasSourceRange
{
    get range(): SourceRange
    {
        return this.expr.range;
    }
    
    /**
     * contract methods only: the execution level the method is valid at
     * (`top <purpose>` / `nested <purpose>`; a purpose keyword without a
     * level keyword defaults to `"top"`). Ignored for plain functions.
     */
    public execLevel: ContractExecLevel = "top";

    constructor(
        readonly expr: FuncExpr,
    ) {}
}

export type ContractExecLevel = "top" | "nested";