import { SourceRange } from "../../Source/SourceRange";
import { Identifier } from "../common/Identifier";
import { HasSourceRange } from "../HasSourceRange";
import { BlockStmt } from "./BlockStmt";
import { TestParam } from "./TestParam";

export class TestStmt
    implements HasSourceRange
{
    constructor(
        readonly testName: Identifier,
        readonly params: TestParam[],
        readonly body: BlockStmt,
        readonly range: SourceRange,
    ) {}
}
