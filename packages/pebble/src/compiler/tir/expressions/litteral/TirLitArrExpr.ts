import { Machine, CEKConst } from "@harmoniclabs/plutus-machine";
import { SourceRange } from "../../../../ast/Source/SourceRange";
import { mergeSortedStrArrInplace } from "../../../../utils/array/mergeSortedStrArrInplace";
import { TirType } from "../../types/TirType";
import { ITirExpr } from "../ITirExpr";
import { TirExpr } from "../TirExpr";
import { ToIRTermCtx } from "../ToIRTermCtx";
import { getListTypeArg } from "../../types/utils/getListTypeArg";
import { getUnaliased } from "../../types/utils/getUnaliased";
import type { IRTerm } from "../../../../IR/IRTerm";
import { _ir_apps } from "../../../../IR/IRNodes/IRApp";
import { IRNative } from "../../../../IR/IRNodes/IRNative";
import { IRConst, type IRConstValue } from "../../../../IR/IRNodes/IRConst";
import { compileIRToUPLC } from "../../../../IR/toUPLC/compileIRToUPLC";
import { CompilationCtx, withCompilationCtx } from "../../../../IR/CompilationCtx";

export class TirLitArrExpr
    implements ITirExpr
{
    get isConstant(): boolean
    {
        return this.elems.every( elem => elem.isConstant );
    }
    
    constructor(
        readonly elems: TirExpr[],
        readonly type: TirType,
        readonly range: SourceRange,
    ) {}

    pretty(): string { return this.toString(); }
    toString(): string
    {
        return `[ ${this.elems.map( e => e.toString() ).join(", ")} ]`;
    }

    clone(): TirExpr
    {
        return new TirLitArrExpr(
            this.elems.map( e => e.clone() ),
            this.type.clone(),
            this.range.clone()
        );
    }

    deps(): string[]
    {
        return this.elems.reduce((deps, elem) => {
            const elemDeps = elem.deps();
            mergeSortedStrArrInplace( deps, elemDeps );
            return deps;
        }, []);
    }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        let nConstantsFromEnd = 0;
        const elems = this.elems;
        const elemsT = getListTypeArg( getUnaliased( this.type ) )!;

        if( !elemsT ) throw new Error("invalid type for list");

        for(let i = elems.length - 1; i >= 0; i--)
        {
            if( elems[i].isConstant ) nConstantsFromEnd++;
            else break;
        }

        let list: IRTerm = constantList( elems.slice( elems.length - nConstantsFromEnd ), elemsT, ctx ); 

        // all the elements where constants
        if( nConstantsFromEnd === elems.length ) return list;

        for( let i = elems.length - nConstantsFromEnd - 1; i >= 0; i-- )
        {
            list = _ir_apps(
                IRNative.mkCons,
                elems[i].toIR( ctx ),
                list
            );
        }

        return list;
    }
}

function constantList( elems: TirExpr[], elemsT: TirType, ctx: ToIRTermCtx ): IRConst
{
    return IRConst.listOf( elemsT )(
        elems.map(
            el => {
                // This eager sub-compilation is a COMPLETE nested pipeline
                // run. Two isolations are load-bearing:
                // - compile a CLONE: the pipeline mutates its tree in place,
                //   and `toIR` output can share nodes with the surrounding
                //   program's IR;
                // - run under a FRESH CompilationCtx: the ctx caches
                //   (`hoistedCache` in particular) reference live nodes of
                //   the tree being compiled, so letting a nested run share
                //   the outer compile's ctx makes the outer pipeline reuse
                //   nodes from the DISCARDED nested tree — surfacing as
                //   dangling `IRVar`s ("trying to increment use of variable
                //   not in context") or an `invalid constant` here.
                const ir = el.toIR( ctx ).clone();
                let res = Machine.evalSimple(
                    withCompilationCtx( new CompilationCtx(), () =>
                        compileIRToUPLC( ir )
                    )
                );

                if(!(
                    res instanceof CEKConst
                    // || res instanceof CEKError
                )) throw new Error("invalid constant");

                return res.value as IRConstValue;
            }
        )
    )
}