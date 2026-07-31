import { AstFuncType } from "../../../../ast/nodes/types/AstNativeTypeExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirFuncT } from "../../../tir/types/TirNativeType/native/function";
import { TirType } from "../../../tir/types/TirType";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileDataEncodedConcreteType } from "./_compileDataEncodedConcreteType";
import { _compileSopEncodedConcreteType } from "./_compileSopEncodedConcreteType";

/**
 * Compile a function SIGNATURE (`AstFuncType`) to a `TirFuncT`.
 *
 * Lives in its own module (rather than inside `_compileFuncExpr`) because it
 * is mutually recursive with the concrete-type compilers: a function type can
 * appear as a parameter/return type annotation, and those annotations are
 * lowered by the type compilers, which in turn call back here for the
 * function-type case. Keeping it here lets every consumer import it directly
 * from its definition file with a plain static import — no re-exports, no lazy
 * `require`/`import()`. The resulting import cycle
 * (`getDataFuncSignature` ↔ concrete-type compilers) is inherent to the
 * recursive type grammar and safe: none of the modules use an imported
 * binding at module-initialization time (only inside function bodies).
 *
 * Parameters are compiled with the DATA-preferred encoding and the return type
 * with the SOP-preferred encoding: passing an argument in encodes it once
 * before the call, which is cheaper than forcing the callee to decode every
 * field of a value it may not fully use. Optionals stay SOP; a bare
 * `TirTypeParam` in return position is valid (it marks a template slot that
 * `monomorphizeGeneric` substitutes at each call site).
 */
export function getDataFuncSignature(
    ctx: AstCompilationCtx,
    signature: AstFuncType
): TirFuncT | undefined
{
    const funcParams = signature.params;
    const paramTypes = new Array<TirType>( funcParams.length );
    for( let i = 0; i < funcParams.length; i++ )
    {
        const param = funcParams[i];
        if( !param.type )
        return ctx.error(
            DiagnosticCode.Could_not_infer_function_signature_parameter_type_is_missing,
            param.range,
        );

        const type = _compileDataEncodedConcreteType( ctx, param.type, true );
        if( !type ) return undefined;

        paramTypes[i] = type;
    }

    if( !signature.returnType )
    return ctx.error(
        DiagnosticCode.Could_not_infer_function_signature_return_type_is_missing,
        signature.range,
    );

    const returnType = signature.returnType instanceof AstFuncType ?
    getDataFuncSignature(
        ctx,
        signature.returnType
    ) :
    _compileSopEncodedConcreteType(
        ctx,
        signature.returnType
    );

    if( !returnType ) return undefined;

    return new TirFuncT(
        paramTypes,
        returnType
    );
}
