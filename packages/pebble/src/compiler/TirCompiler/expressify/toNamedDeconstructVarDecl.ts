import { TirNamedDeconstructVarDecl } from "../../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSingleDeconstructVarDecl } from "../../tir/statements/TirVarDecl/TirSingleDeconstructVarDecl";
import { TirLinearMapEntryT } from "../../tir/types/TirNativeType/native/linearMapEntry";
import { getUnaliased } from "../../tir/types/utils/getUnaliased";
import { isSingleConstrStruct } from "./isSingleConstrStruct";

export function toNamedDeconstructVarDecl(
    varDecl: TirSingleDeconstructVarDecl | TirNamedDeconstructVarDecl
): TirNamedDeconstructVarDecl
{
    if( varDecl instanceof TirNamedDeconstructVarDecl ) return varDecl;
    if( varDecl instanceof TirSingleDeconstructVarDecl ) {
        const declType = varDecl.type;

        // LinearMapEntry<K,V> uses virtual "Entry" constructor name
        const unaliased = getUnaliased( declType );
        if( unaliased instanceof TirLinearMapEntryT ) {
            return new TirNamedDeconstructVarDecl(
                "Entry",
                varDecl.fields,
                varDecl.rest,
                varDecl.type,
                varDecl.initExpr,
                varDecl.isConst,
                varDecl.range
            );
        }

        if( !isSingleConstrStruct( declType ) )
        throw new Error("expected single constr struct type in single deconstruct var decl");

        const singleConstrName = declType.constructors[0].name;

        return new TirNamedDeconstructVarDecl(
            singleConstrName,
            varDecl.fields,
            varDecl.rest,
            varDecl.type,
            varDecl.initExpr,
            varDecl.isConst,
            varDecl.range
        );
    }
    throw new Error("unreachable::toNamedDeconstructVarDecl");
}