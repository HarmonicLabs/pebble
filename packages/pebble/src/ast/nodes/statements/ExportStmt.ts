import { SourceRange } from "../../Source/SourceRange";
import { HasSourceRange } from "../HasSourceRange";
import { BodyStmt, TopLevelStmt } from "./PebbleStmt";

/**
 * ```ts
 * export <PebbleStmt>
 * ```
 */
export class ExportStmt
    implements HasSourceRange
{
    constructor(
        readonly stmt: BodyStmt | TopLevelStmt,
        readonly range: SourceRange,
    ) {}
}