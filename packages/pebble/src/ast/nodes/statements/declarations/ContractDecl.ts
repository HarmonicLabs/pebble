import { SourceRange } from "../../../Source/SourceRange";
import { Identifier } from "../../common/Identifier";
import { HasSourceRange } from "../../HasSourceRange";
import { FuncDecl } from "./FuncDecl";
import { SimpleVarDecl } from "./VarDecl/SimpleVarDecl";
import { StateDecl } from "./StateDecl";

export class ContractDecl
    implements HasSourceRange
{
    constructor(
        readonly name: Identifier,
        readonly params: SimpleVarDecl[],
        readonly spendMethods: FuncDecl[],
        readonly mintMethods: FuncDecl[],
        readonly certifyMethods: FuncDecl[],
        readonly withdrawMethods: FuncDecl[],
        readonly proposeMethods: FuncDecl[],
        readonly voteMethods: FuncDecl[],
        /** Plutus V4 guarding purpose (`guard name() {}`); requires targetPlutusVersion >= v4 */
        readonly guardMethods: FuncDecl[],
        readonly stateDecls: StateDecl[],
        readonly range: SourceRange
    ) {}
}