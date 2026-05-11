import { SourceRange } from "../../../Source/SourceRange";
import { Identifier } from "../../common/Identifier";
import { HasSourceRange } from "../../HasSourceRange";
import { FuncDecl } from "./FuncDecl";
import { SimpleVarDecl } from "./VarDecl/SimpleVarDecl";

export class StateDecl
    implements HasSourceRange
{
    constructor(
        readonly name: Identifier,
        readonly fields: SimpleVarDecl[],
        readonly spendMethods: FuncDecl[],
        readonly range: SourceRange
    ) {}
}
