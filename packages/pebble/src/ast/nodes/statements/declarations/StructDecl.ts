import { SourceRange } from "../../../Source/SourceRange";
import { Identifier } from "../../common/Identifier";
import { HasSourceRange } from "../../HasSourceRange";
import { SimpleVarDecl } from "./VarDecl/SimpleVarDecl";

export enum StructDeclAstFlags {
    none = 0 << 0,

    /**
     * Hint that the user used the shortcut single-constructor syntax
     * (`struct Foo { x: int }` rather than `struct Foo { Foo { x: int } }`).
     * The shortcut form is untagged (`listData(...)`) unless the
     * compiler's `encodingStrategy` option is `"legacy"`, which keeps the
     * tagged form (`constrData(0, ...)`) of the compilers up to 0.4.x.
     */
    shortcutSingleConstructor = 1 << 0,
    onlyDataEncoding = 1 << 1,
    onlySopEncoding = 1 << 2,
    /**
     * Explicit `untagged` modifier. Forces the untagged listData encoding
     * regardless of `encodingStrategy`. Requires a single constructor.
     */
    untagged = 1 << 3,
}

export class StructDecl
    implements HasSourceRange
{
    constructor(
        readonly name: Identifier,
        readonly typeParams: Identifier[],
        readonly constrs: StructConstrDecl[],
        readonly flags: StructDeclAstFlags,
        readonly range: SourceRange
    ) {}

    hasFlag(flag: StructDeclAstFlags): boolean {
        return (this.flags & flag) !== 0;
    }
}

export class StructConstrDecl
    implements HasSourceRange
{
    constructor(
        readonly name: Identifier,
        // name and type
        readonly fields: SimpleVarDecl[],
        readonly range: SourceRange
    ) {}
}