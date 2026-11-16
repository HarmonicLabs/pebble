import { TirNamedDeconstructVarDecl } from "../../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSingleDeconstructVarDecl } from "../../tir/statements/TirVarDecl/TirSingleDeconstructVarDecl";
import { pairConstructorOf } from "../../tir/types/utils/pairConstructorOf";
import { isSingleConstrStruct } from "./isSingleConstrStruct";

export function toNamedDeconstructVarDecl(
    varDecl: TirSingleDeconstructVarDecl | TirNamedDeconstructVarDecl
): TirNamedDeconstructVarDecl
{
    if( varDecl instanceof TirNamedDeconstructVarDecl ) return varDecl;
    if( varDecl instanceof TirSingleDeconstructVarDecl ) {
        const declType = varDecl.type;

        // a pair at runtime (`LinearMapEntry`, `RawConstr`): the name of the one
        // constructor it is destructured as
        const pairConstr = pairConstructorOf( declType );
        if( pairConstr ) {
            return new TirNamedDeconstructVarDecl(
                pairConstr.name,
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