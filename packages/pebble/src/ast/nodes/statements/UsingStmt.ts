import { SourceRange } from "../../Source/SourceRange";
import { Identifier } from "../common/Identifier";
import { HasSourceRange } from "../HasSourceRange";
import { AstTypeExpr } from "../types/AstTypeExpr";

/**
 * dotted chain of identifiers used as the RHS of a `using` statement
 * to refer to a namespace path (e.g. `std.builtins`).
 */
export class UsingPath
    implements HasSourceRange
{
    constructor(
        readonly segments: Identifier[],
        readonly range: SourceRange
    ) {}
}

export type UsingRhs = AstTypeExpr | UsingPath;

/**
 * `using { a, b: renamed } = <rhs>;`
 *
 * `<rhs>` may be either a struct type expression (existing behavior,
 * bringing constructors into scope) or a namespace path (new behavior,
 * destructuring the namespace's exported members into scope).
 */
export class UsingStmt
    implements HasSourceRange
{
    constructor(
        readonly constructorNames: UsingStmtDeclaredConstructor[],
        readonly rhs: UsingRhs,
        readonly range: SourceRange
    ) {}

    /** legacy accessor for code paths still expecting `structTypeExpr` */
    get structTypeExpr(): UsingRhs { return this.rhs; }
}

export class UsingStmtDeclaredConstructor
    implements HasSourceRange
{
    constructor(
        readonly constructorName: Identifier,
        readonly renamedConstructorName: Identifier | undefined,
        readonly range: SourceRange
    ) {}
}

/**
 * `using <aliasName> = <rhs>;`
 *
 * binds `aliasName` as a local alias for the namespace identified by `rhs`.
 */
export class UsingAliasStmt
    implements HasSourceRange
{
    constructor(
        readonly aliasName: Identifier,
        readonly rhs: UsingPath,
        readonly range: SourceRange
    ) {}
}
