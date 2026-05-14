import { SourceRange } from "../../Source/SourceRange";
import { Identifier } from "../common/Identifier";
import { HasSourceRange } from "../HasSourceRange";
import { BlockStmt } from "./BlockStmt";
import { VarDecl } from "./declarations/VarDecl/VarDecl";

export class TestStmt
    implements HasSourceRange
{
    constructor(
        readonly testName: Identifier,
        readonly params: VarDecl[],
        readonly body: BlockStmt,
        readonly range: SourceRange,
    ) {}
}
