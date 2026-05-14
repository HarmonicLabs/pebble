import { SourceRange } from "../../../Source/SourceRange";
import { Identifier } from "../../common/Identifier";
import { HasSourceRange } from "../../HasSourceRange";
import { VarStmt } from "../VarStmt";
import { FuncDecl } from "./FuncDecl";
import { InterfaceDecl } from "./InterfaceDecl";
import { isPebbleTypeDecl, PebbleTypeDecl } from "./PebbleTypeDecl";

export type NamespaceMemberStmt
    = VarStmt
    | FuncDecl
    | PebbleTypeDecl
    | InterfaceDecl
    | NamespaceDecl
    ;

export function isNamespaceMemberStmt( thing: any ): thing is NamespaceMemberStmt
{
    return (
        thing instanceof VarStmt
        || thing instanceof FuncDecl
        || isPebbleTypeDecl( thing )
        || thing instanceof InterfaceDecl
        || thing instanceof NamespaceDecl
    );
}

export class NamespaceMember
    implements HasSourceRange
{
    constructor(
        readonly isPrivate: boolean,
        readonly stmt: NamespaceMemberStmt,
        readonly range: SourceRange
    ) {}
}

export class NamespaceDecl
    implements HasSourceRange
{
    constructor(
        readonly name: Identifier,
        readonly members: NamespaceMember[],
        readonly range: SourceRange
    ) {}
}
