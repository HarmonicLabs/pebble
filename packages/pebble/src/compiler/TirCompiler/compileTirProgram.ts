import { IRTerm } from "../../IR";
import { CompilerOptions } from "../../IR/toUPLC/CompilerOptions";
import { TirFuncExpr } from "../tir/expressions/TirFuncExpr";
import { ToIRTermCtx } from "../tir/expressions/ToIRTermCtx";
import { TypedProgram } from "../tir/program/TypedProgram";
import { expressify } from "./expressify/expressify";
import { ExpressifyCtx } from "./expressify/ExpressifyCtx";
import { expressifyVars } from "./expressify/expressifyVars";
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
    // resolve const-to-const references in top-level constant initializers
    // (e.g. `const CHUNK_SIZE = LINE_LENGTH * 8;`) BEFORE anything wraps them
    // in hoisted expressions: hoisted terms are converted with a fresh root
    // ctx, so a raw variable access to another constant would be unbound.
    // constants are inserted in dependency order (a const can only reference
    // consts of already-compiled modules or earlier declarations), so each
    // fresh ctx below sees the already-processed initializers of its deps.
    for( const decl of tirProgram.constants.values() )
    {
        if( !decl.initExpr ) continue;
        const constCtx = new ExpressifyCtx( undefined, decl.type, tirProgram );
        decl.initExpr = expressifyVars( constCtx, decl.initExpr );
    }

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