import { CallExpr } from "../../../../ast/nodes/expr/functions/CallExpr";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { TirCallExpr } from "../../../tir/expressions/TirCallExpr";
import { TirExpr } from "../../../tir/expressions/TirExpr";
import { TirFuncT } from "../../../tir/types/TirNativeType/native/function";
import { TirType } from "../../../tir/types/TirType";
import { canAssignTo } from "../../../tir/types/utils/canAssignTo";
import { inferTypeArgs } from "../../../tir/types/utils/inferTypeArgs";
import { substituteTypeParams } from "../../../tir/types/utils/substituteTypeParams";
import { TirVariableAccessExpr } from "../../../tir/expressions/TirVariableAccessExpr";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { monomorphizeGeneric } from "../../utils/monomorphizeGeneric";
import { _compileDataEncodedConcreteType } from "../types/_compileDataEncodedConcreteType";
import { _compileExpr } from "./_compileExpr";

export function _compileCallExpr(
    ctx: AstCompilationCtx,
    expr: CallExpr,
    typeHint: TirType | undefined
): TirCallExpr | undefined
{
    if(!( typeHint instanceof TirFuncT )) typeHint = undefined;

    const funcExpr = _compileExpr( ctx, expr.funcExpr, typeHint );
    if( !funcExpr ) return undefined;

    if( !( funcExpr.type instanceof TirFuncT ) ) return ctx.error(
        DiagnosticCode.Expression_is_not_callable,
        expr.funcExpr.range
    );

    // ---- Generic-callee handling --------------------------------------
    // If the callee resolved to a generic placeholder, the funcExpr is a
    // `TirVariableAccessExpr` whose `variableInfos.genericTemplateName` names
    // a template registered on `program.genericTemplates`. We instantiate it
    // here with explicit or inferred type arguments and replace `funcExpr`
    // with a synthetic access pointing at the concrete monomorphized instance.
    let callee: TirExpr = funcExpr;
    let funcType: TirFuncT = funcExpr.type;
    if( funcExpr instanceof TirVariableAccessExpr )
    {
        const templateName = funcExpr.resolvedValue.variableInfos.genericTemplateName;
        if( typeof templateName === "string" )
        {
            const template = ctx.program.genericTemplates.get( templateName );
            if( !template ) return ctx.error(
                DiagnosticCode._0_is_not_defined,
                expr.funcExpr.range,
                templateName
            );

            const nParams = template.typeParams.length;

            // 1) Collect explicit type-args, if any
            const explicitArgs: TirType[] | undefined = (
                Array.isArray( expr.genericTypeArgs )
                    ? new Array<TirType>()
                    : undefined
            );
            if( explicitArgs && expr.genericTypeArgs )
            {
                for( const tArgExpr of expr.genericTypeArgs )
                {
                    const t = _compileDataEncodedConcreteType( ctx, tArgExpr, true );
                    if( !t ) return undefined;
                    explicitArgs.push( t );
                }
                if( explicitArgs.length !== nParams )
                {
                    return ctx.error(
                        DiagnosticCode.Expected_0_type_arguments_but_got_1,
                        expr.funcExpr.range,
                        String( nParams ),
                        String( explicitArgs.length )
                    );
                }
            }

            // 2) Compile arguments. We need them anyway, and they're used for
            //    inference when no explicit args were given.
            const tirArgs = expr.args.map(( arg, i ) => {
                const expected = explicitArgs
                    ? substituteTypeParams(
                          funcType.argTypes[i],
                          new Map( template.typeParams.map(( tp, idx ) => [ tp.symbol, explicitArgs![idx] ]) )
                      )
                    : undefined;
                return _compileExpr( ctx, arg, expected );
            }) as TirExpr[];
            for( const a of tirArgs ) if( !a ) return undefined;

            // 3) Determine final type arguments
            let resolvedArgs: TirType[];
            if( explicitArgs )
            {
                resolvedArgs = explicitArgs;
            }
            else
            {
                const env = new Map<symbol, TirType>();
                const usable = Math.min( tirArgs.length, funcType.argTypes.length );
                for( let i = 0; i < usable; i++ )
                {
                    if( !inferTypeArgs( funcType.argTypes[i], tirArgs[i].type, env ) )
                    {
                        return ctx.error(
                            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
                            expr.args[i].range,
                            tirArgs[i].type.toString(),
                            funcType.argTypes[i].toString()
                        );
                    }
                }
                resolvedArgs = new Array<TirType>( nParams );
                for( let i = 0; i < nParams; i++ )
                {
                    const bound = env.get( template.typeParams[i].symbol );
                    if( !bound )
                    {
                        return ctx.error(
                            DiagnosticCode.The_type_argument_for_type_parameter_0_cannot_be_inferred_from_the_usage_Consider_specifying_the_type_arguments_explicitly,
                            expr.funcExpr.range,
                            template.typeParams[i].name
                        );
                    }
                    resolvedArgs[i] = bound;
                }
            }

            // 4) Monomorphize
            const mono = monomorphizeGeneric( ctx, template, resolvedArgs, expr.range );
            if( !mono ) return undefined;

            funcType = mono.concreteFuncType;

            // 5) Synthesize a TirVariableAccessExpr for the concrete instance.
            //    The IR layer looks up by name on `program.functions`, so it
            //    matches the entry registered by `monomorphizeGeneric`.
            callee = new TirVariableAccessExpr(
                {
                    variableInfos: {
                        name: mono.tirFuncName,
                        type: funcType,
                        isConstant: true,
                    },
                    isDefinedOutsideFuncScope: true,
                },
                expr.funcExpr.range
            );

            // 6) Re-validate argument assignability against concrete signature
            const finalCallExprType = funcType.argTypes.length === tirArgs.length
                ? funcType.returnType
                : new TirFuncT( funcType.argTypes.slice( tirArgs.length ), funcType.returnType );

            for( let i = 0; i < tirArgs.length && i < funcType.argTypes.length; i++ )
            {
                if( !canAssignTo( tirArgs[i].type, funcType.argTypes[i] ) )
                return ctx.error(
                    DiagnosticCode.Type_0_is_not_assignable_to_type_1,
                    expr.args[i].range,
                    tirArgs[i].type.toString(),
                    funcType.argTypes[i].toString()
                );
            }

            return new TirCallExpr(
                callee,
                tirArgs,
                finalCallExprType,
                expr.range
            );
        }
    }
    // ---- End generic-callee handling ----------------------------------

    for( let i = funcType.argTypes.length; i < expr.args.length; i++ )
    {
        ctx.warning(
            DiagnosticCode.Unexpected_argument,
            expr.args[i].range
        ); // not a big deal
    }

    if( funcType.argTypes.length < expr.args.length )
        expr.args.length = funcType.argTypes.length; // drop extra

    const finalCallExprType = funcType.argTypes.length === expr.args.length ?
        funcType.returnType :
        new TirFuncT( funcType.argTypes.slice( expr.args.length ), funcType.returnType );

    const args = expr.args.map((arg, i) =>
        _compileExpr( ctx, arg, funcType.argTypes[i] )
    ) as TirExpr[]; // we early return in case of undefined
    for( let i = 0; i < args.length; i++ )
    {
        const arg = args[i];
        if( !arg ) return undefined;
        if( !canAssignTo( arg.type, funcType.argTypes[i] ) )
        return ctx.error(
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
            expr.args[i].range, arg.type.toString(), funcType.argTypes[i].toString()
        );
    }

    return new TirCallExpr(
        callee,
        args,
        finalCallExprType,
        expr.range
    );
}
