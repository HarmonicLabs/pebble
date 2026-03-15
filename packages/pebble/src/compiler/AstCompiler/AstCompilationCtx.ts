import { DiagnosticEmitter } from "../../diagnostics/DiagnosticEmitter";
import { DiagnosticMessage } from "../../diagnostics/DiagnosticMessage";
import { TypedProgram } from "../tir/program/TypedProgram";
import { TirType } from "../tir/types/TirType";
import { AstScope, ScopeInfos } from "./scope/AstScope";


export interface AstCompilationCtxFuncInfo {
    /** present where the function definition is inside
     * an other function definiton (closure)
     *
     * in which case, only constants from the parent funciton can be used
    **/
    parentFunctionCtx: AstCompilationCtxFuncInfo | undefined;
    returnType: TirType;
    /** when true, skip the return type assignability check
     * and infer the return type from the returned expression */
    inferReturnType?: boolean;
}

export interface IAstCompilationCtx {
    scope: AstScope;
    /** present if the statement is in a function body */
    functionCtx: AstCompilationCtxFuncInfo | undefined;
    /** to check if `continue` and `break` are valid in this context */
    isLoop: boolean;
}

export class AstCompilationCtx extends DiagnosticEmitter
    implements IAstCompilationCtx
{
    constructor(
        readonly program: TypedProgram,
        readonly scope: AstScope,
        readonly functionCtx: AstCompilationCtxFuncInfo | undefined,
        readonly isLoop: boolean,
        public diagnostics: DiagnosticMessage[]
    ) {
        super( diagnostics );
    }

    newChildScope(
        childScopeInfos: ScopeInfos,
        isLoop: boolean
    ): AstCompilationCtx
    {
        return new AstCompilationCtx(
            this.program,
            this.scope.newChildScope( childScopeInfos ),
            this.functionCtx,
            isLoop,
            this.diagnostics
        );
    }

    newFunctionChildScope( returnType: TirType, isMethod: boolean ): AstCompilationCtx
    {
        return new AstCompilationCtx(
            this.program,
            this.scope.newChildScope({
                ...this.scope.infos,
                isFunctionDeclScope: true,
                isMethodScope: isMethod
            }),
            { // function ctx
                parentFunctionCtx: this.functionCtx,
                returnType
            },
            false, // isLoop
            this.diagnostics
        );
    }

    newBranchChildScope(): AstCompilationCtx
    {
        // same as this, just new block
        return this.newChildScope(
            { ...this.scope.infos },
            this.isLoop
        );
    }

    newLoopChildScope(): AstCompilationCtx
    {
        return this.newChildScope(
            { ...this.scope.infos },
            true
        );
    }

    resolveValue(
        identifier: string
    )
    {
        const thing = this.scope.variables.get( identifier );
    }

    static fromScope(
        program: TypedProgram,
        scope: AstScope
    ): AstCompilationCtx
    {
        return new AstCompilationCtx(
            program,
            scope,
            undefined,
            false,
            program.diagnostics
        );
    }
}
