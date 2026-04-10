import { Identifier } from "../../../ast/nodes/common/Identifier";
import { TirAliasType } from "../../tir/types/TirAliasType";
import { TirInterfaceImpl } from "../../tir/types/TirInterfaceImpl";
import { isTirStructType, TirStructType } from "../../tir/types/TirStructType";
import { TirType } from "../../tir/types/TirType";
import { TirTypeParam } from "../../tir/types/TirTypeParam";
import { int_t, bytes_t, bool_t, string_t } from "../../tir/program/stdScope/stdScope";
import { AstCompilationCtx } from "../AstCompilationCtx";
import { AstFuncName, TirFuncName } from "../scope/AstScope";
import { TirUnConstrDataResultT, TirPairDataT } from "../../tir/types/TirNativeType";
import { TirBoolT } from "../../tir/types/TirNativeType/native/bool";
import { TirBytesT } from "../../tir/types/TirNativeType/native/bytes";
import { TirDataT } from "../../tir/types/TirNativeType/native/data";
import { TirFuncT } from "../../tir/types/TirNativeType/native/function";
import { TirIntT } from "../../tir/types/TirNativeType/native/int";
import { TirLinearMapT } from "../../tir/types/TirNativeType/native/linearMap";
import { TirListT } from "../../tir/types/TirNativeType/native/list";
import { isTirOptType } from "../../tir/types/TirNativeType/native/Optional/isTirOptType";
import { TirSopOptT } from "../../tir/types/TirNativeType/native/Optional/sop";
import { TirStringT } from "../../tir/types/TirNativeType/native/string";
import { TirVoidT } from "../../tir/types/TirNativeType/native/void";

export function getPropAccessReturnType(
    ctx: AstCompilationCtx,
    objType: TirType,
    propId: Identifier
): TirType | undefined
{
    const propName = propId.text;

    while(
        objType instanceof TirAliasType
        || objType instanceof TirTypeParam
    ) {
        if( objType instanceof TirTypeParam ) return undefined;

        const result = findPropInImpls( ctx, objType.methodsNamesPtr, propName );
        if( result ) return result;

        objType = objType.aliased;
    }
    // if( objType instanceof TirAliasType ) return findPropInImpls( objType.impls, propName ) ?? getPropAccessReturnType( objType.aliased, propId );

    if( isTirStructType( objType ) ) return getStructPropAccessReturnType( ctx, objType, propName );
    if( objType instanceof TirVoidT ) return undefined;
    if( objType instanceof TirBoolT ) return undefined;
    if( objType instanceof TirIntT ) return undefined;
    if( objType instanceof TirBytesT ) return bytesMethods[propName];
    if( objType instanceof TirStringT ) return bytesMethods[propName];
    if( objType instanceof TirDataT ) return undefined;
    if( isTirOptType( objType ) ) return undefined;
    if( objType instanceof TirFuncT ) return undefined;
    if( objType instanceof TirListT ) return getListMethods( objType.typeArg )[propName];
    if( objType instanceof TirLinearMapT ) return getLinearMapMethods( objType.keyTypeArg, objType.valTypeArg )[propName];
    if( objType instanceof TirUnConstrDataResultT ) return undefined;
    if( objType instanceof TirPairDataT ) return undefined;

    const tsEnsureExhaustiveCheck: never = objType;
    console.error( objType );
    throw new Error("unreachable::getPropAccessReturnType");
}

function getListMethods( elemsType: TirType ): { [x: string]: TirFuncT | undefined }
{
    const mapReturnT = new TirTypeParam("T")
    return {
        length: new TirFuncT( [], int_t ),
        isEmpty: new TirFuncT( [], bool_t ),
        show: new TirFuncT( [], bytes_t ),
        head: new TirFuncT( [], elemsType ),
        tail: new TirFuncT( [], new TirListT( elemsType ) ),
        reverse: new TirFuncT( [], new TirListT( elemsType ) ),
        find: new TirFuncT([
            new TirFuncT( [elemsType], bool_t )
        ], new TirSopOptT( elemsType ) ),
        filter: new TirFuncT([
            new TirFuncT( [elemsType], bool_t )
        ], new TirListT( elemsType ) ),
        prepend: new TirFuncT( [elemsType], new TirListT( elemsType ) ),
        map: new TirFuncT([
            new TirFuncT([ elemsType ], mapReturnT )
        ], new TirListT( mapReturnT ) ),
        every: new TirFuncT([
            new TirFuncT( [elemsType], bool_t )
        ], bool_t ),
        some: new TirFuncT([
            new TirFuncT( [elemsType], bool_t )
        ], bool_t ),
        includes: new TirFuncT([ elemsType ], bool_t ),
    };
}

function getLinearMapMethods( kT: TirType, vT: TirType ): { [x: string]: TirFuncT | undefined }
{
    return {
        // ...getListMethods( /* to add when adding support for pairs */ ),
        lookup: new TirFuncT( [kT], new TirSopOptT( vT ) )
    };
}

const bytesMethods: { [x: string]: TirFuncT | undefined } = Object.freeze({
    length: new TirFuncT([], int_t ),
    subByteString: new TirFuncT([ int_t, int_t ], bytes_t ),
    slice: new TirFuncT([ int_t, int_t ], bytes_t ),
    show: new TirFuncT([], bytes_t ),
    decodeUtf8: new TirFuncT([], string_t ),
    prepend: new TirFuncT([ int_t ], bytes_t ),
});

const stringMethods: { [x: string]: TirFuncT | undefined } = Object.freeze({
    encodeUtf8: new TirFuncT([], bytes_t ),
});

function getStructPropAccessReturnType(
    ctx: AstCompilationCtx,
    structType: TirStructType,
    propName: string
): TirType | undefined
{
    if( structType.constructors.length === 1 )
    {
        const constr = structType.constructors[0];
        const field = constr.fields.find( f => f.name === propName );
        if( field ) return field.type;
    }

    // constructor accessor methods for multi-constructor data structs
    // e.g. ExtendedInteger.finite() returns int (the field of the Finite constructor)
    if( structType.constructors.length > 1 )
    {
        const lowerPropName = propName.toLowerCase();
        const ctor = structType.constructors.find(
            c => c.name.toLowerCase() === lowerPropName
        );
        if( ctor && ctor.fields.length === 1 )
        {
            return new TirFuncT([], ctor.fields[0].type);
        }
    }

    return findPropInImpls( ctx, structType.methodNamesPtr, propName );
}

function findPropInImpls(
    ctx: AstCompilationCtx,
    methodsNamesPtr: Map<AstFuncName, TirFuncName>,
    propName: string
): TirType | undefined
{
    const tirFuncName = methodsNamesPtr.get( propName );
    if( !tirFuncName ) return undefined;

    const funcExpr = ctx.program.functions.get( tirFuncName );
    if( !funcExpr ) return undefined;

    const fullSig = funcExpr.sig();
    const methodSig = new TirFuncT(
        fullSig.argTypes.slice( 1 ),
        fullSig.returnType
    );

    return methodSig;
}