import { IRTerm } from "../../IR";
import { CompilerOptions } from "../../IR/toUPLC/CompilerOptions";
import { TirFuncExpr } from "../tir/expressions/TirFuncExpr";
import { ToIRTermCtx } from "../tir/expressions/ToIRTermCtx";
import { TypedProgram } from "../tir/program/TypedProgram";
import { expressify } from "./expressify/expressify";
import { TirCompilerCtx } from "./TirCompilerCtx";

/**
 * compiles Typed IR to IRTerm (old plu-ts IR).
 *
 * TIR -> IRTerm
 */
export function compileTypedProgram(
    cfg: CompilerOptions,
    tirProgram: TypedProgram
): IRTerm
{
    /*
    const ctx = new TirCompilerCtx(
        cfg,
        tirProgram,
    );
    //*/
    // expressify all program functions (including imported ones)
    // so they are ready for IR conversion when referenced via TirHoistedExpr.
    // each TirFuncExpr may appear under multiple keys (ast name + tir name),
    // so we use a Set to avoid expressifying the same function twice.
    const expressified = new Set<TirFuncExpr>();
    for( const func of tirProgram.functions.values() )
    {
        if( func instanceof TirFuncExpr && !expressified.has( func ) )
        {
            expressify( func, undefined, tirProgram );
            expressified.add( func );
        }
    }

    const mainFuncExpr = tirProgram.getMainOrThrow()
    // console.log("main func expressified:", mainFuncExpr.pretty() );
    return mainFuncExpr.toIR( ToIRTermCtx.root() );
}