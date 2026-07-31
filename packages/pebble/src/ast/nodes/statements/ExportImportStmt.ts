import { SourceRange } from "../../Source/SourceRange";
import { LitStrExpr } from "../expr/litteral/LitStrExpr";
import { HasSourceRange } from "../HasSourceRange";
import { ImportDecl } from "./ImportStmt";

/**
 * ```ts
 * export { ... } from "module";
 * ```
 */
export class ExportImportStmt
    implements HasSourceRange
{
    constructor(
        readonly members: ImportDecl[],
        readonly fromPath: LitStrExpr,
        readonly range: SourceRange,
    ) {}
}