import { SourceRange } from "../../Source/SourceRange";
import { debugCreationStack } from "../../../utils/debugCreationStack";
import { HasSourceRange } from "../HasSourceRange";
import { AstTypeExpr } from "../types/AstTypeExpr";
import { PebbleExpr } from "./PebbleExpr";


export class TypeConversionExpr
    implements HasSourceRange
{
    private _creationStack: string | undefined;
    constructor(
        public expr: PebbleExpr,
        readonly asType: AstTypeExpr,
        readonly range: SourceRange = SourceRange.join( expr.range, asType.range )
    ) {
        this._creationStack = debugCreationStack();
    }
}