import { SourceRange } from "../../../../ast/Source/SourceRange";
import { _ir_apps } from "../../../../IR/IRNodes/IRApp";
import { IRFunc } from "../../../../IR/IRNodes/IRFunc";
import { IRNative } from "../../../../IR/IRNodes/IRNative";
import { IRNativeTag } from "../../../../IR/IRNodes/IRNative/IRNativeTag";
import { IRVar } from "../../../../IR/IRNodes/IRVar";
import type { IRTerm } from "../../../../IR/IRTerm";
import { TypeParamConstraint } from "../TypedProgram";
import { AstScope, NamespaceSymbol } from "../../../AstCompiler/scope/AstScope";
import { TirInlineClosedIR } from "../../expressions/TirInlineClosedIR";
import { TirNativeFunc } from "../../expressions/TirNativeFunc";
import {
    TirBlsG1T,
    TirBlsG2T,
    TirMlResultT,
    TirUnConstrDataResultT,
    TirFuncT,
} from "../../types/TirNativeType";
import { TirLinearMapT } from "../../types/TirNativeType/native/linearMap";
import { TirLinearMapEntryT } from "../../types/TirNativeType/native/linearMapEntry";
import { TirListT } from "../../types/TirNativeType/native/list";
import { TirArrayT } from "../../types/TirNativeType/native/array";
import { TirValueT } from "../../types/TirNativeType/native/value";
import { TirSopOptT } from "../../types/TirNativeType/native/Optional/sop";
import { TirTypeParam } from "../../types/TirTypeParam";
import { TirType } from "../../types/TirType";
import { TypedProgram } from "../TypedProgram";
import {
    bool_t, bytes_t, data_t, int_t, string_t, void_t,
    valueLovelacesName, valueAmountOfName,
    valueMapLovelacesName, valueMapAmountOfName,
    valueInsertCoinName, valueUnionName, valueContainsName,
    valueScaleName, valueToDataName,
    getCredentialHashFuncName,
} from "./stdScope";

/**
 * Populate the top-level `std` namespace and its sub-namespaces:
 *
 *   std
 *   ├── crypto
 *   │   ├── hashing & signatures (sha2_256, blake2b_256, verifyEd25519Signature, ...)
 *   │   └── bls12_381
 *   │       ├── types: G1, G2, MlResult
 *   │       └── g1Add, g1Neg, g2Add, ..., millerLoop, finalVerify
 *   └── builtins
 *       ├── types: RawConstr
 *       ├── arithmetic, byte-string, bitwise, data, string, trace, conversion ops
 *       └── (polymorphic intrinsics like mkCons<T> are registered as native
 *           generic templates and dispatched through the same monomorphizer
 *           as user generic functions — see `populateNativeGenericTemplates`)
 *
 * Identifiers like `std.crypto.sha2_256(b)` resolve through the existing
 * namespace-chain walker; the function is registered on the program as a
 * `TirInlineClosedIR` whose IR is the corresponding `IRNative` tag.
 */
export function populateStdNamespace( program: TypedProgram ): void
{
    // ------------------------------------------------------------------
    // 0. Scopes for each namespace
    // ------------------------------------------------------------------
    const stdNsScope        = new AstScope( program.preludeScope, program, {} );
    const cryptoNsScope     = new AstScope( stdNsScope,           program, {} );
    const blsNsScope        = new AstScope( cryptoNsScope,        program, {} );
    const builtinsNsScope   = new AstScope( stdNsScope,           program, {} );

    // ------------------------------------------------------------------
    // 1. Native types exported by namespaces
    // ------------------------------------------------------------------

    // BLS types -- registered both on the program and exposed under
    // `std.crypto.bls12_381`.
    const g1_t   = new TirBlsG1T();
    const g2_t   = new TirBlsG2T();
    const ml_t   = new TirMlResultT();
    program.types.set( g1_t.toConcreteTirTypeName(), g1_t );
    program.types.set( g2_t.toConcreteTirTypeName(), g2_t );
    program.types.set( ml_t.toConcreteTirTypeName(), ml_t );

    // BLS native types are exported ONLY through `std.crypto.bls12_381`.
    // To use them in source code, the user either fully qualifies the name
    // or brings them into local scope with
    //   `using { G1, G2, MlResult } = std.crypto.bls12_381;`
    blsNsScope.defineUnambigousType( "G1",       g1_t.toConcreteTirTypeName(), false, new Map() );
    blsNsScope.defineUnambigousType( "G2",       g2_t.toConcreteTirTypeName(), false, new Map() );
    blsNsScope.defineUnambigousType( "MlResult", ml_t.toConcreteTirTypeName(), false, new Map() );

    // RawConstr — the `unConstrData` return shape, exposed under
    // `std.builtins`. Field access (`.index` / `.fields`) is handled in
    // `_compileDotPropAccessExpr` and lowers to fst/sndPair.
    const rawConstr_t = new TirUnConstrDataResultT();
    program.types.set( rawConstr_t.toConcreteTirTypeName(), rawConstr_t );
    builtinsNsScope.defineUnambigousType(
        "RawConstr",
        rawConstr_t.toConcreteTirTypeName(),
        false,
        new Map()
    );
    program.preludeScope.defineUnambigousType(
        "RawConstr",
        rawConstr_t.toConcreteTirTypeName(),
        false,
        new Map()
    );

    // ------------------------------------------------------------------
    // 2. Helper: register a monomorphic builtin as a namespace member
    // ------------------------------------------------------------------
    function defineBuiltin(
        scope: AstScope,
        astName: string,
        tag: IRNativeTag,
        funcType: TirFuncT,
        namespacePath: string
    ): void
    {
        const uniqueTirName = `__pebble__std__${namespacePath}__${astName}`;
        program.functions.set(
            uniqueTirName,
            new TirInlineClosedIR(
                funcType,
                () => new IRNative( tag ),
                SourceRange.unknown
            )
        );
        scope.functions.set( astName, uniqueTirName );
    }

    /**
     * Resolve the dictionary IRTerm for `interfaceName.<first-method>` against
     * a concrete type, at IR-codegen time (so user-impl function references
     * can be looked up through the live `ToIRTermCtx`).
     *
     * Resolution order — Rust-trait-like:
     *   1. **User-impl** (declared via `type Foo implements I { ... }`).
     *      The impl method lives in `t.methodsNamesPtr` (alias) or
     *      `t.methodNamesPtr` (struct). Reference it by name through
     *      `ctx.getVarAccessIR(tirFuncName)`.
     *   2. **Built-in factory** (`program.builtinInterfaceImpls`) — for
     *      compiler-supplied impls like `ToData` on primitive / data-encoded
     *      types.
     *   3. Otherwise: throw — the constraint is unsatisfied.
     *
     * Currently picks the FIRST method of the interface, since this turn's
     * only constrained native template uses single-method interfaces (`ToData`).
     * Multi-method interfaces would pass each method's IRTerm separately.
     */
    function resolveInterfaceImpl(
        ctx: import("../../expressions/ToIRTermCtx").ToIRTermCtx,
        concreteType: TirType,
        interfaceName: string,
    ): IRTerm
    {
        // Pick the (single) method name to resolve. We grab it from the
        // built-in factory map if registered, else from the prelude's
        // interface signature map.
        const factories = program.builtinInterfaceImpls.get( interfaceName );
        const interfaceMethods = program.preludeScope.resolveInterface( interfaceName );
        const methodName: string | undefined =
            factories?.keys().next().value
            ?? interfaceMethods?.keys().next().value;

        if( !methodName ) {
            throw new Error(
                `resolveInterfaceImpl: interface '${interfaceName}' is not registered`
            );
        }

        // 1) user-impl path -- read methodNamesPtr / methodsNamesPtr off the
        //    concrete type (unwrap aliases as needed).
        const userTirFuncName = _findUserImplMethodName( concreteType, methodName );
        if( userTirFuncName )
        {
            const ir = ctx.getVarAccessIR( userTirFuncName );
            if( ir ) return ir;
            // It's expected the function is in scope at the call site. If
            // not (very unusual), fall through to the built-in factory.
        }

        // 2) built-in factory path
        if( factories )
        {
            const factory = factories.get( methodName );
            const irTerm = factory?.( concreteType );
            if( irTerm ) return irTerm;
        }

        throw new Error(
            `type '${concreteType.toString()}' does not implement '${interfaceName}'`
        );
    }

    /**
     * Walk a TirType to find a matching method name on its method-pointer
     * map. Looks through:
     *   - `TirAliasType.methodsNamesPtr`
     *   - `TirStructType.methodNamesPtr` (data + sop variants)
     * Unwraps aliases recursively.
     */
    function _findUserImplMethodName(
        t: TirType,
        methodName: string,
    ): string | undefined
    {
        // dynamic require to avoid bootstrap-time load order issues
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { TirAliasType }  = require( "../../types/TirAliasType" );
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { isTirStructType } = require( "../../types/TirStructType" );

        // `TirAliasType` and `isTirStructType` come back as `any` from the
        // dynamic require, so TypeScript cannot narrow `cur` by the guards
        // alone — cast through the relevant shapes explicitly.
        let cur: TirType | undefined = t;
        while( cur )
        {
            if( cur instanceof TirAliasType )
            {
                const aliasCur = cur as { methodsNamesPtr: Map<string, string>; aliased: TirType };
                const found = aliasCur.methodsNamesPtr.get( methodName );
                if( found ) return found;
                cur = aliasCur.aliased;
                continue;
            }
            if( isTirStructType( cur ) )
            {
                const structCur = cur as unknown as { methodNamesPtr: Map<string, string> };
                const found = structCur.methodNamesPtr.get( methodName );
                if( found ) return found;
                return undefined;
            }
            return undefined;
        }
        return undefined;
    }

    // ------------------------------------------------------------------
    // 3. std.crypto -- hashing & signature verification
    // ------------------------------------------------------------------
    const cryptoNs = "crypto";

    const hash_sig  = new TirFuncT([ bytes_t ], bytes_t);
    defineBuiltin( cryptoNsScope, "sha2_256",     IRNativeTag.sha2_256,     hash_sig, cryptoNs );
    defineBuiltin( cryptoNsScope, "sha3_256",     IRNativeTag.sha3_256,     hash_sig, cryptoNs );
    defineBuiltin( cryptoNsScope, "blake2b_256",  IRNativeTag.blake2b_256,  hash_sig, cryptoNs );
    defineBuiltin( cryptoNsScope, "blake2b_224",  IRNativeTag.blake2b_224,  hash_sig, cryptoNs );
    defineBuiltin( cryptoNsScope, "keccak_256",   IRNativeTag.keccak_256,   hash_sig, cryptoNs );
    defineBuiltin( cryptoNsScope, "ripemd_160",   IRNativeTag.ripemd_160,   hash_sig, cryptoNs );

    const verifySig = new TirFuncT([ bytes_t, bytes_t, bytes_t ], bool_t);
    defineBuiltin( cryptoNsScope, "verifyEd25519Signature",         IRNativeTag.verifyEd25519Signature,         verifySig, cryptoNs );
    defineBuiltin( cryptoNsScope, "verifyEcdsaSecp256k1Signature",  IRNativeTag.verifyEcdsaSecp256k1Signature,  verifySig, cryptoNs );
    defineBuiltin( cryptoNsScope, "verifySchnorrSecp256k1Signature",IRNativeTag.verifySchnorrSecp256k1Signature,verifySig, cryptoNs );

    // ------------------------------------------------------------------
    // 4. std.crypto.bls12_381 -- BLS12-381 ops
    // ------------------------------------------------------------------
    const blsNs = "crypto__bls12_381";
    defineBuiltin( blsNsScope, "g1Add",         IRNativeTag.bls12_381_G1_add,           new TirFuncT([ g1_t, g1_t ], g1_t), blsNs );
    defineBuiltin( blsNsScope, "g1Neg",         IRNativeTag.bls12_381_G1_neg,           new TirFuncT([ g1_t ], g1_t), blsNs );
    defineBuiltin( blsNsScope, "g1ScalarMul",   IRNativeTag.bls12_381_G1_scalarMul,     new TirFuncT([ int_t, g1_t ], g1_t), blsNs );
    defineBuiltin( blsNsScope, "g1Equal",       IRNativeTag.bls12_381_G1_equal,         new TirFuncT([ g1_t, g1_t ], bool_t), blsNs );
    defineBuiltin( blsNsScope, "g1HashToGroup", IRNativeTag.bls12_381_G1_hashToGroup,   new TirFuncT([ bytes_t, bytes_t ], g1_t), blsNs );
    defineBuiltin( blsNsScope, "g1Compress",    IRNativeTag.bls12_381_G1_compress,      new TirFuncT([ g1_t ], bytes_t), blsNs );
    defineBuiltin( blsNsScope, "g1Uncompress",  IRNativeTag.bls12_381_G1_uncompress,    new TirFuncT([ bytes_t ], g1_t), blsNs );

    defineBuiltin( blsNsScope, "g2Add",         IRNativeTag.bls12_381_G2_add,           new TirFuncT([ g2_t, g2_t ], g2_t), blsNs );
    defineBuiltin( blsNsScope, "g2Neg",         IRNativeTag.bls12_381_G2_neg,           new TirFuncT([ g2_t ], g2_t), blsNs );
    defineBuiltin( blsNsScope, "g2ScalarMul",   IRNativeTag.bls12_381_G2_scalarMul,     new TirFuncT([ int_t, g2_t ], g2_t), blsNs );
    defineBuiltin( blsNsScope, "g2Equal",       IRNativeTag.bls12_381_G2_equal,         new TirFuncT([ g2_t, g2_t ], bool_t), blsNs );
    defineBuiltin( blsNsScope, "g2HashToGroup", IRNativeTag.bls12_381_G2_hashToGroup,   new TirFuncT([ bytes_t, bytes_t ], g2_t), blsNs );
    defineBuiltin( blsNsScope, "g2Compress",    IRNativeTag.bls12_381_G2_compress,      new TirFuncT([ g2_t ], bytes_t), blsNs );
    defineBuiltin( blsNsScope, "g2Uncompress",  IRNativeTag.bls12_381_G2_uncompress,    new TirFuncT([ bytes_t ], g2_t), blsNs );

    defineBuiltin( blsNsScope, "millerLoop",    IRNativeTag.bls12_381_millerLoop,       new TirFuncT([ g1_t, g2_t ], ml_t), blsNs );
    defineBuiltin( blsNsScope, "mulMlResult",   IRNativeTag.bls12_381_mulMlResult,      new TirFuncT([ ml_t, ml_t ], ml_t), blsNs );
    defineBuiltin( blsNsScope, "finalVerify",   IRNativeTag.bls12_381_finalVerify,      new TirFuncT([ ml_t, ml_t ], bool_t), blsNs );

    // ------------------------------------------------------------------
    // 5. std.builtins -- general (monomorphic) builtins
    // ------------------------------------------------------------------
    const blt = "builtins";

    // arithmetic / comparison
    const intIntInt   = new TirFuncT([ int_t, int_t ], int_t);
    const intIntBool  = new TirFuncT([ int_t, int_t ], bool_t);
    defineBuiltin( builtinsNsScope, "addInteger",          IRNativeTag.addInteger,          intIntInt, blt );
    defineBuiltin( builtinsNsScope, "subtractInteger",     IRNativeTag.subtractInteger,     intIntInt, blt );
    defineBuiltin( builtinsNsScope, "multiplyInteger",     IRNativeTag.multiplyInteger,     intIntInt, blt );
    defineBuiltin( builtinsNsScope, "divideInteger",       IRNativeTag.divideInteger,       intIntInt, blt );
    defineBuiltin( builtinsNsScope, "quotientInteger",     IRNativeTag.quotientInteger,     intIntInt, blt );
    defineBuiltin( builtinsNsScope, "remainderInteger",    IRNativeTag.remainderInteger,    intIntInt, blt );
    defineBuiltin( builtinsNsScope, "modInteger",          IRNativeTag.modInteger,          intIntInt, blt );
    defineBuiltin( builtinsNsScope, "equalsInteger",       IRNativeTag.equalsInteger,       intIntBool, blt );
    defineBuiltin( builtinsNsScope, "lessThanInteger",     IRNativeTag.lessThanInteger,     intIntBool, blt );
    defineBuiltin( builtinsNsScope, "lessThanEqualInteger",IRNativeTag.lessThanEqualInteger,intIntBool, blt );

    // bytes
    const bbB  = new TirFuncT([ bytes_t, bytes_t ], bytes_t);
    const bbBool = new TirFuncT([ bytes_t, bytes_t ], bool_t);
    defineBuiltin( builtinsNsScope, "appendByteString",        IRNativeTag.appendByteString,        bbB,  blt );
    defineBuiltin( builtinsNsScope, "consByteString",          IRNativeTag.consByteString,          new TirFuncT([ int_t, bytes_t ], bytes_t), blt );
    defineBuiltin( builtinsNsScope, "sliceByteString",         IRNativeTag.sliceByteString,         new TirFuncT([ int_t, int_t, bytes_t ], bytes_t), blt );
    defineBuiltin( builtinsNsScope, "lengthOfByteString",      IRNativeTag.lengthOfByteString,      new TirFuncT([ bytes_t ], int_t), blt );
    defineBuiltin( builtinsNsScope, "indexByteString",         IRNativeTag.indexByteString,         new TirFuncT([ bytes_t, int_t ], int_t), blt );
    defineBuiltin( builtinsNsScope, "equalsByteString",        IRNativeTag.equalsByteString,        bbBool, blt );
    defineBuiltin( builtinsNsScope, "lessThanByteString",      IRNativeTag.lessThanByteString,      bbBool, blt );
    defineBuiltin( builtinsNsScope, "lessThanEqualsByteString",IRNativeTag.lessThanEqualsByteString,bbBool, blt );

    // bytes bitwise (v3)
    const flagBbB = new TirFuncT([ bool_t, bytes_t, bytes_t ], bytes_t);
    defineBuiltin( builtinsNsScope, "andByteString",        IRNativeTag.andByteString,        flagBbB, blt );
    defineBuiltin( builtinsNsScope, "orByteString",         IRNativeTag.orByteString,         flagBbB, blt );
    defineBuiltin( builtinsNsScope, "xorByteString",        IRNativeTag.xorByteString,        flagBbB, blt );
    defineBuiltin( builtinsNsScope, "complementByteString", IRNativeTag.complementByteString, new TirFuncT([ bytes_t ], bytes_t), blt );
    defineBuiltin( builtinsNsScope, "readBit",              IRNativeTag.readBit,              new TirFuncT([ bytes_t, int_t ], bool_t), blt );
    // writeBits in our wrapper: (bytes, List<int> positions, bool value) -> bytes
    defineBuiltin( builtinsNsScope, "writeBits",            IRNativeTag.writeBits,            new TirFuncT([ bytes_t, new TirListT( int_t ), bool_t ], bytes_t), blt );
    defineBuiltin( builtinsNsScope, "replicateByte",        IRNativeTag.replicateByte,        new TirFuncT([ int_t, int_t ], bytes_t), blt );
    defineBuiltin( builtinsNsScope, "shiftByteString",      IRNativeTag.shiftByteString,      new TirFuncT([ bytes_t, int_t ], bytes_t), blt );
    defineBuiltin( builtinsNsScope, "rotateByteString",     IRNativeTag.rotateByteString,     new TirFuncT([ bytes_t, int_t ], bytes_t), blt );
    defineBuiltin( builtinsNsScope, "countSetBits",         IRNativeTag.countSetBits,         new TirFuncT([ bytes_t ], int_t), blt );
    defineBuiltin( builtinsNsScope, "findFirstSetBit",      IRNativeTag.findFirstSetBit,      new TirFuncT([ bytes_t ], int_t), blt );

    // int <-> bytes (v3)
    defineBuiltin( builtinsNsScope, "integerToByteString",  IRNativeTag.integerToByteString, new TirFuncT([ bool_t, int_t, int_t ], bytes_t), blt );
    defineBuiltin( builtinsNsScope, "byteStringToInteger",  IRNativeTag.byteStringToInteger, new TirFuncT([ bool_t, bytes_t ], int_t), blt );

    // strings (v1)
    const ssS = new TirFuncT([ string_t, string_t ], string_t);
    const ssBool = new TirFuncT([ string_t, string_t ], bool_t);
    defineBuiltin( builtinsNsScope, "appendString", IRNativeTag.appendString, ssS, blt );
    defineBuiltin( builtinsNsScope, "equalsString", IRNativeTag.equalsString, ssBool, blt );
    defineBuiltin( builtinsNsScope, "encodeUtf8",   IRNativeTag.encodeUtf8,   new TirFuncT([ string_t ], bytes_t), blt );
    defineBuiltin( builtinsNsScope, "decodeUtf8",   IRNativeTag.decodeUtf8,   new TirFuncT([ bytes_t ], string_t), blt );

    // data constructors
    defineBuiltin( builtinsNsScope, "constrData", IRNativeTag.constrData, new TirFuncT([ int_t, new TirListT( data_t ) ], data_t), blt );
    defineBuiltin( builtinsNsScope, "mapData",    IRNativeTag.mapData,    new TirFuncT([ new TirLinearMapT( data_t, data_t ) ], data_t), blt );
    defineBuiltin( builtinsNsScope, "listData",   IRNativeTag.listData,   new TirFuncT([ new TirListT( data_t ) ], data_t), blt );
    defineBuiltin( builtinsNsScope, "iData",      IRNativeTag.iData,      new TirFuncT([ int_t ], data_t), blt );
    defineBuiltin( builtinsNsScope, "bData",      IRNativeTag.bData,      new TirFuncT([ bytes_t ], data_t), blt );
    defineBuiltin( builtinsNsScope, "mkNilData",  IRNativeTag.mkNilData,  new TirFuncT([], new TirListT( data_t ) ), blt );

    // data destructors
    defineBuiltin( builtinsNsScope, "unConstrData", IRNativeTag.unConstrData, new TirFuncT([ data_t ], rawConstr_t), blt );
    defineBuiltin( builtinsNsScope, "unMapData",    IRNativeTag.unMapData,    new TirFuncT([ data_t ], new TirLinearMapT( data_t, data_t )), blt );
    defineBuiltin( builtinsNsScope, "unListData",   IRNativeTag.unListData,   new TirFuncT([ data_t ], new TirListT( data_t )), blt );
    defineBuiltin( builtinsNsScope, "unIData",      IRNativeTag.unIData,      new TirFuncT([ data_t ], int_t), blt );
    defineBuiltin( builtinsNsScope, "unBData",      IRNativeTag.unBData,      new TirFuncT([ data_t ], bytes_t), blt );

    // data misc
    defineBuiltin( builtinsNsScope, "equalsData",     IRNativeTag.equalsData,     new TirFuncT([ data_t, data_t ], bool_t), blt );
    defineBuiltin( builtinsNsScope, "serialiseData",  IRNativeTag.serialiseData,  new TirFuncT([ data_t ], bytes_t), blt );

    // Chang2 / Plutus V4
    const value_native_t = new TirValueT();
    defineBuiltin( builtinsNsScope, "expModInteger",  IRNativeTag.expModInteger,  new TirFuncT([ int_t, int_t, int_t ], int_t), blt );
    defineBuiltin( builtinsNsScope, "insertCoin",     IRNativeTag.insertCoin,     new TirFuncT([ bytes_t, bytes_t, int_t, value_native_t ], value_native_t), blt );
    defineBuiltin( builtinsNsScope, "lookupCoin",     IRNativeTag.lookupCoin,     new TirFuncT([ bytes_t, bytes_t, value_native_t ], int_t), blt );
    defineBuiltin( builtinsNsScope, "unionValue",     IRNativeTag.unionValue,     new TirFuncT([ value_native_t, value_native_t ], value_native_t), blt );
    defineBuiltin( builtinsNsScope, "valueContains",  IRNativeTag.valueContains,  new TirFuncT([ value_native_t, value_native_t ], bool_t), blt );
    defineBuiltin( builtinsNsScope, "valueData",      IRNativeTag.valueData,      new TirFuncT([ value_native_t ], data_t), blt );
    defineBuiltin( builtinsNsScope, "unValueData",    IRNativeTag.unValueData,    new TirFuncT([ data_t ], value_native_t), blt );
    defineBuiltin( builtinsNsScope, "scaleValue",     IRNativeTag.scaleValue,     new TirFuncT([ int_t, value_native_t ], value_native_t), blt );

    // ------------------------------------------------------------------
    // 5b. std.builtins -- polymorphic intrinsics via native generic templates
    // ------------------------------------------------------------------
    //
    // These builtins are polymorphic over one or more type parameters. They
    // are registered as `NativeGenericTemplate`s; call sites go through the
    // same `monomorphizeGeneric` path as user-defined generic functions and
    // each instantiation produces a fresh `TirInlineClosedIR`.
    function defineGenericBuiltin(
        scope: AstScope,
        astName: string,
        nTypeParams: number,
        buildSig: ( typeArgs: TirType[] ) => TirFuncT,
        buildIr: ( typeArgs: TirType[] ) => IRNative,
        /**
         * Distinguishing path segment so multiple namespaces can each have a
         * `length` (etc.) without colliding in `program.genericTemplates`.
         * Defaults to `"builtins"` for backward compatibility with the
         * existing `std.builtins.*` polymorphic intrinsics.
         */
        namespacePath: string = "builtins"
    ): void
    {
        const canonicalTirName = `__pebble__std__${namespacePath}__${astName}`;
        const typeParams: TirTypeParam[] = [];
        for( let i = 0; i < nTypeParams; i++ )
        {
            // single-letter style names just for diagnostics
            typeParams.push( new TirTypeParam( String.fromCharCode( 0x41 + i ) ) );
        }
        const placeholderTirArgs = typeParams.map( tp => tp as TirType );
        const placeholderFuncType = buildSig( placeholderTirArgs );

        // Use the canonicalTirName as the template-registry key so per-namespace
        // entries with the same `astName` (`std.list.length` vs
        // `std.linearMap.length`) don't shadow each other.
        program.genericTemplates.set( canonicalTirName, {
            kind: "native",
            astFuncName: astName,
            typeParams,
            canonicalTirName,
            placeholderFuncType,
            // unconstrained native template
            constraints: new Array( nTypeParams ).fill( undefined ),
            instantiate: ( typeArgs: TirType[] ) => new TirInlineClosedIR(
                buildSig( typeArgs ),
                () => buildIr( typeArgs ),
                SourceRange.unknown
            ),
        });

        scope.defineValue({
            name: astName,
            type: placeholderFuncType,
            isConstant: true,
            genericTemplateName: canonicalTirName,
        });
        scope.functions.set( astName, canonicalTirName );
    }

    // ------------------------------------------------------------------
    // Constrained variant -- for native generic templates whose body needs
    // per-type-param dictionary IR (e.g. `std.linearMap.prepend<K implements
    // ToData, V implements ToData>` uses `_toDataUplcFunc` for K and V).
    //
    // `paramConstraints` is aligned by index with the type-param list;
    // `undefined` for unconstrained slots.
    //
    // `buildIr` receives the concrete typeArgs along with the resolved
    // dictionary `IRTerm` for each constrained param (same order, undefined
    // for unconstrained). It returns the raw IR (already a closure over its
    // call-time arguments).
    // ------------------------------------------------------------------
    function defineGenericBuiltinConstrained(
        scope: AstScope,
        astName: string,
        nTypeParams: number,
        paramConstraints: ( string | undefined )[],
        buildSig: ( typeArgs: TirType[] ) => TirFuncT,
        buildIr: ( typeArgs: TirType[], dicts: ( IRTerm | undefined )[] ) => IRTerm,
        namespacePath: string = "builtins"
    ): void
    {
        if( paramConstraints.length !== nTypeParams )
        {
            throw new Error(
                `defineGenericBuiltinConstrained: paramConstraints.length ` +
                `(${paramConstraints.length}) !== nTypeParams (${nTypeParams})`
            );
        }

        const canonicalTirName = `__pebble__std__${namespacePath}__${astName}`;
        const typeParams: TirTypeParam[] = [];
        for( let i = 0; i < nTypeParams; i++ )
        {
            typeParams.push( new TirTypeParam( String.fromCharCode( 0x41 + i ) ) );
        }
        const placeholderTirArgs = typeParams.map( tp => tp as TirType );
        const placeholderFuncType = buildSig( placeholderTirArgs );

        // Resolve constraints up-front. We look up each interface in the
        // prelude scope so monomorphization can validate at call-time.
        const constraints: ( TypeParamConstraint | undefined )[] =
            paramConstraints.map( name => {
                if( !name ) return undefined;
                const methods = program.preludeScope.resolveInterface( name );
                if( !methods )
                {
                    throw new Error(
                        `defineGenericBuiltinConstrained: interface '${name}' ` +
                        `is not registered in the prelude. Register it via ` +
                        `populateBuiltinInterfaces before this call.`
                    );
                }
                return { interfaceName: name, methods };
            });

        program.genericTemplates.set( canonicalTirName, {
            kind: "native",
            astFuncName: astName,
            typeParams,
            canonicalTirName,
            placeholderFuncType,
            constraints,
            instantiate: ( typeArgs: TirType[] ) => {
                // Dictionary resolution is deferred to `getIr` time so it
                // can consult the live `ToIRTermCtx` — this is necessary
                // when the impl is a top-level user function that must be
                // looked up by name (e.g. `type Foo implements ToData {
                // toData(self): data { ... } }` — the impl is a regular
                // user function whose IR-level reference is `IRVar(symbol)`
                // resolved through the codegen scope).
                return new TirInlineClosedIR(
                    buildSig( typeArgs ),
                    ( ctx ) => {
                        const dicts: ( IRTerm | undefined )[] = typeArgs.map(( t, i ) => {
                            const c = paramConstraints[i];
                            if( !c ) return undefined;
                            return resolveInterfaceImpl( ctx, t, c );
                        });
                        return buildIr( typeArgs, dicts );
                    },
                    SourceRange.unknown
                );
            },
        });

        scope.defineValue({
            name: astName,
            type: placeholderFuncType,
            isConstant: true,
            genericTemplateName: canonicalTirName,
        });
        scope.functions.set( astName, canonicalTirName );
    }

    // trace<T>( msg: bytes, x: T ): T
    defineGenericBuiltin( builtinsNsScope, "trace", 1,
        ( [ T ] ) => new TirFuncT([ bytes_t, T ], T),
        () => new IRNative( IRNativeTag.trace )
    );

    // ifThenElse<T>( cond: bool, then: T, else: T ): T  -- strict variant
    defineGenericBuiltin( builtinsNsScope, "ifThenElse", 1,
        ( [ T ] ) => new TirFuncT([ bool_t, T, T ], T),
        () => new IRNative( IRNativeTag.strictIfThenElse )
    );

    // chooseUnit<T>( u: void, x: T ): T
    defineGenericBuiltin( builtinsNsScope, "chooseUnit", 1,
        ( [ T ] ) => new TirFuncT([ void_t, T ], T),
        () => new IRNative( IRNativeTag.chooseUnit )
    );

    // mkCons<T>( head: T, tail: List<T> ): List<T>
    defineGenericBuiltin( builtinsNsScope, "mkCons", 1,
        ( [ T ] ) => new TirFuncT([ T, new TirListT( T ) ], new TirListT( T )),
        () => new IRNative( IRNativeTag.mkCons )
    );

    // headList<T>( xs: List<T> ): T
    defineGenericBuiltin( builtinsNsScope, "headList", 1,
        ( [ T ] ) => new TirFuncT([ new TirListT( T ) ], T),
        () => new IRNative( IRNativeTag.headList )
    );

    // tailList<T>( xs: List<T> ): List<T>
    defineGenericBuiltin( builtinsNsScope, "tailList", 1,
        ( [ T ] ) => new TirFuncT([ new TirListT( T ) ], new TirListT( T )),
        () => new IRNative( IRNativeTag.tailList )
    );

    // nullList<T>( xs: List<T> ): bool
    defineGenericBuiltin( builtinsNsScope, "nullList", 1,
        ( [ T ] ) => new TirFuncT([ new TirListT( T ) ], bool_t),
        () => new IRNative( IRNativeTag.nullList )
    );

    // chooseList<A,B>( xs: List<A>, caseNil: B, caseCons: B ): B  -- strict
    defineGenericBuiltin( builtinsNsScope, "chooseList", 2,
        ( [ A, B ] ) => new TirFuncT([ new TirListT( A ), B, B ], B),
        () => new IRNative( IRNativeTag.strictChooseList )
    );

    // chooseData<T>( d: data, caseConstr: T, caseMap: T, caseList: T,
    //                caseIData: T, caseBData: T ): T
    defineGenericBuiltin( builtinsNsScope, "chooseData", 1,
        ( [ T ] ) => new TirFuncT([ data_t, T, T, T, T, T ], T),
        () => new IRNative( IRNativeTag.chooseData )
    );

    // ------------------------------------------------------------------
    // 6. Per-type native namespaces -- std.list, std.linearMap, std.bytes,
    //    std.int, std.boolean, std.data, std.value, std.credential, plus
    //    the top-level std.id<T> / std.equals<T>.
    //
    //    These expose the compiler-internal "native" helpers (negative-tag
    //    IRNativeTag entries) as first-class values so users can pass them
    //    to higher-order code (`std.list.some(std.int.isZero, xs)`) — the
    //    motivation being partial application of operator-like functions
    //    which the operator forms (`>`, `+`, ...) do not allow.
    //
    //    Method-call surface (e.g. `xs.map(f)`) is unchanged.
    // ------------------------------------------------------------------
    const listNsScope       = new AstScope( stdNsScope, program, {} );
    const arrayNsScope      = new AstScope( stdNsScope, program, {} );
    const linearMapNsScope  = new AstScope( stdNsScope, program, {} );
    const bytesNsScope      = new AstScope( stdNsScope, program, {} );
    const intNsScope        = new AstScope( stdNsScope, program, {} );
    const boolNsScope       = new AstScope( stdNsScope, program, {} );
    const dataNsScope       = new AstScope( stdNsScope, program, {} );
    const valueNsScope      = new AstScope( stdNsScope, program, {} );
    const valueMapNsScope   = new AstScope( stdNsScope, program, {} );
    const credentialNsScope = new AstScope( stdNsScope, program, {} );

    // ---------- std.list (polymorphic) ----------
    const listNs = "list";
    defineGenericBuiltin( listNsScope, "length", 1,
        ( [ T ] ) => new TirFuncT([ new TirListT( T ) ], int_t),
        () => new IRNative( IRNativeTag._length ),
        listNs
    );
    defineGenericBuiltin( listNsScope, "isEmpty", 1,
        ( [ T ] ) => new TirFuncT([ new TirListT( T ) ], bool_t),
        () => new IRNative( IRNativeTag.nullList ),
        listNs
    );
    defineGenericBuiltin( listNsScope, "head", 1,
        ( [ T ] ) => new TirFuncT([ new TirListT( T ) ], T),
        () => new IRNative( IRNativeTag.headList ),
        listNs
    );
    defineGenericBuiltin( listNsScope, "tail", 1,
        ( [ T ] ) => new TirFuncT([ new TirListT( T ) ], new TirListT( T )),
        () => new IRNative( IRNativeTag.tailList ),
        listNs
    );
    defineGenericBuiltin( listNsScope, "prepend", 1,
        ( [ T ] ) => new TirFuncT([ T, new TirListT( T ) ], new TirListT( T )),
        () => new IRNative( IRNativeTag.mkCons ),
        listNs
    );
    defineGenericBuiltin( listNsScope, "drop", 1,
        ( [ T ] ) => new TirFuncT([ int_t, new TirListT( T ) ], new TirListT( T )),
        () => new IRNative( IRNativeTag._dropList ),
        listNs
    );
    defineGenericBuiltin( listNsScope, "foldr", 2,
        ( [ T, A ] ) => new TirFuncT([ new TirFuncT([ T, A ], A), A, new TirListT( T ) ], A),
        () => new IRNative( IRNativeTag._foldr ),
        listNs
    );
    defineGenericBuiltin( listNsScope, "foldl", 2,
        ( [ T, A ] ) => new TirFuncT([ new TirFuncT([ A, T ], A), A, new TirListT( T ) ], A),
        () => new IRNative( IRNativeTag._foldl ),
        listNs
    );
    defineGenericBuiltin( listNsScope, "filter", 1,
        ( [ T ] ) => new TirFuncT([ new TirFuncT([ T ], bool_t), new TirListT( T ) ], new TirListT( T )),
        () => new IRNative( IRNativeTag._filter ),
        listNs
    );
    defineGenericBuiltin( listNsScope, "some", 1,
        ( [ T ] ) => new TirFuncT([ new TirFuncT([ T ], bool_t), new TirListT( T ) ], bool_t),
        () => new IRNative( IRNativeTag._some ),
        listNs
    );
    defineGenericBuiltin( listNsScope, "every", 1,
        ( [ T ] ) => new TirFuncT([ new TirFuncT([ T ], bool_t), new TirListT( T ) ], bool_t),
        () => new IRNative( IRNativeTag._every ),
        listNs
    );
    defineGenericBuiltin( listNsScope, "find", 1,
        ( [ T ] ) => new TirFuncT([ new TirFuncT([ T ], bool_t), new TirListT( T ) ], new TirSopOptT( T )),
        () => new IRNative( IRNativeTag._findSopOptional ),
        listNs
    );
    defineGenericBuiltin( listNsScope, "equals", 1,
        ( [ T ] ) => new TirFuncT(
            [ new TirFuncT([ T, T ], bool_t), new TirListT( T ), new TirListT( T ) ],
            bool_t
        ),
        () => new IRNative( IRNativeTag._mkEqualsList ),
        listNs
    );
    // NOTE: `map` is intentionally not exposed here. _mkMapList requires a
    // nil-of-return-type literal as its first argument which the method-form
    // (`xs.map(f)`) constructs at the TIR level; reproducing that inside a
    // closed-IR thunk would need TIR-level composition which our current
    // namespace helpers don't provide. Users keep `xs.map(f)`.

    // ---------- std.linearMap (polymorphic) ----------
    const linearMapNs = "linearMap";
    defineGenericBuiltin( linearMapNsScope, "length", 2,
        ( [ K, V ] ) => new TirFuncT([ new TirLinearMapT( K, V ) ], int_t),
        () => new IRNative( IRNativeTag._length ),
        linearMapNs
    );
    defineGenericBuiltin( linearMapNsScope, "isEmpty", 2,
        ( [ K, V ] ) => new TirFuncT([ new TirLinearMapT( K, V ) ], bool_t),
        () => new IRNative( IRNativeTag.nullList ),
        linearMapNs
    );
    defineGenericBuiltin( linearMapNsScope, "head", 2,
        ( [ K, V ] ) => new TirFuncT([ new TirLinearMapT( K, V ) ], new TirLinearMapEntryT( K, V )),
        () => new IRNative( IRNativeTag.headList ),
        linearMapNs
    );
    defineGenericBuiltin( linearMapNsScope, "tail", 2,
        ( [ K, V ] ) => new TirFuncT([ new TirLinearMapT( K, V ) ], new TirLinearMapT( K, V )),
        () => new IRNative( IRNativeTag.tailList ),
        linearMapNs
    );
    // lookup<K,V>(k: K, m: LinearMap<K,V>): Optional<V>  -- mirrors
    // expressifyVars.ts:676 (passes raw K; relies on ambient data-encoding).
    defineGenericBuiltin( linearMapNsScope, "lookup", 2,
        ( [ K, V ] ) => new TirFuncT([ K, new TirLinearMapT( K, V ) ], new TirSopOptT( V )),
        () => new IRNative( IRNativeTag._lookupLinearMap ),
        linearMapNs
    );
    // prepend<K implements ToData, V implements ToData>
    //     (k: K, v: V, m: LinearMap<K,V>): LinearMap<K,V>
    //
    // Uses dictionary-passing for the ToData constraint: at instantiation
    // time the compiler resolves the right `toData_K` / `toData_V` impls
    // (via `program.builtinInterfaceImpls["ToData"]["toData"]`) — for the
    // built-in factory this is `_toDataUplcFunc(K)` / `_toDataUplcFunc(V)`.
    // Those IR closures are inlined into the body alongside `mkPairData`
    // and `mkCons`, mirroring `expressifyVars.ts:690`'s method-form lowering.
    defineGenericBuiltinConstrained( linearMapNsScope, "prepend", 2,
        [ "ToData", "ToData" ],
        ( [ K, V ] ) => new TirFuncT(
            [ K, V, new TirLinearMapT( K, V ) ],
            new TirLinearMapT( K, V )
        ),
        ( _typeArgs, dicts ) => {
            // Synthesize:  \k v m -> mkCons( mkPairData( toDataK(k), toDataV(v) ), m )
            const kSym = Symbol("k");
            const vSym = Symbol("v");
            const mSym = Symbol("m");
            const toDataK = dicts[0]!;
            const toDataV = dicts[1]!;
            return new IRFunc(
                [ kSym, vSym, mSym ],
                _ir_apps(
                    IRNative.mkCons,
                    _ir_apps(
                        IRNative.mkPairData,
                        _ir_apps( toDataK, new IRVar( kSym ) ),
                        _ir_apps( toDataV, new IRVar( vSym ) ),
                    ),
                    new IRVar( mSym ),
                ),
            );
        },
        linearMapNs
    );

    // ---------- std.bytes (monomorphic) ----------
    defineBuiltin( bytesNsScope, "length",           IRNativeTag.lengthOfByteString,        new TirFuncT([ bytes_t ], int_t), "bytes" );
    defineBuiltin( bytesNsScope, "slice",            IRNativeTag.sliceByteString,           new TirFuncT([ int_t, int_t, bytes_t ], bytes_t), "bytes" );
    defineBuiltin( bytesNsScope, "prepend",          IRNativeTag.consByteString,            new TirFuncT([ int_t, bytes_t ], bytes_t), "bytes" );
    defineBuiltin( bytesNsScope, "concat",           IRNativeTag.appendByteString,          new TirFuncT([ bytes_t, bytes_t ], bytes_t), "bytes" );
    defineBuiltin( bytesNsScope, "indexAt",          IRNativeTag.indexByteString,           new TirFuncT([ bytes_t, int_t ], int_t), "bytes" );
    defineBuiltin( bytesNsScope, "equals",           IRNativeTag.equalsByteString,          new TirFuncT([ bytes_t, bytes_t ], bool_t), "bytes" );
    defineBuiltin( bytesNsScope, "lessThan",         IRNativeTag.lessThanByteString,        new TirFuncT([ bytes_t, bytes_t ], bool_t), "bytes" );
    defineBuiltin( bytesNsScope, "lessThanEquals",   IRNativeTag.lessThanEqualsByteString,  new TirFuncT([ bytes_t, bytes_t ], bool_t), "bytes" );
    defineBuiltin( bytesNsScope, "greaterThan",      IRNativeTag._gtBS,                     new TirFuncT([ bytes_t, bytes_t ], bool_t), "bytes" );
    defineBuiltin( bytesNsScope, "greaterThanEquals",IRNativeTag._gtEqBS,                   new TirFuncT([ bytes_t, bytes_t ], bool_t), "bytes" );
    defineBuiltin( bytesNsScope, "toInt",            IRNativeTag._bytesToIntBE,             new TirFuncT([ bytes_t ], int_t), "bytes" );
    defineBuiltin( bytesNsScope, "fromInt",          IRNativeTag._intToBytesBE,             new TirFuncT([ int_t ], bytes_t), "bytes" );

    // ---------- std.int (monomorphic) ----------
    defineBuiltin( intNsScope, "add",                 IRNativeTag.addInteger,             new TirFuncT([ int_t, int_t ], int_t), "int" );
    defineBuiltin( intNsScope, "subtract",            IRNativeTag.subtractInteger,        new TirFuncT([ int_t, int_t ], int_t), "int" );
    defineBuiltin( intNsScope, "multiply",            IRNativeTag.multiplyInteger,        new TirFuncT([ int_t, int_t ], int_t), "int" );
    defineBuiltin( intNsScope, "divide",              IRNativeTag.divideInteger,          new TirFuncT([ int_t, int_t ], int_t), "int" );
    defineBuiltin( intNsScope, "quotient",            IRNativeTag.quotientInteger,        new TirFuncT([ int_t, int_t ], int_t), "int" );
    defineBuiltin( intNsScope, "remainder",           IRNativeTag.remainderInteger,       new TirFuncT([ int_t, int_t ], int_t), "int" );
    defineBuiltin( intNsScope, "mod",                 IRNativeTag.modInteger,             new TirFuncT([ int_t, int_t ], int_t), "int" );
    defineBuiltin( intNsScope, "equals",              IRNativeTag.equalsInteger,          new TirFuncT([ int_t, int_t ], bool_t), "int" );
    defineBuiltin( intNsScope, "lessThan",            IRNativeTag.lessThanInteger,        new TirFuncT([ int_t, int_t ], bool_t), "int" );
    defineBuiltin( intNsScope, "lessThanEquals",      IRNativeTag.lessThanEqualInteger,   new TirFuncT([ int_t, int_t ], bool_t), "int" );
    defineBuiltin( intNsScope, "greaterThan",         IRNativeTag._gtInt,                 new TirFuncT([ int_t, int_t ], bool_t), "int" );
    defineBuiltin( intNsScope, "greaterThanEquals",   IRNativeTag._gtEqInt,               new TirFuncT([ int_t, int_t ], bool_t), "int" );
    defineBuiltin( intNsScope, "negate",              IRNativeTag._negateInt,             new TirFuncT([ int_t ], int_t), "int" );
    defineBuiltin( intNsScope, "increment",           IRNativeTag._increment,             new TirFuncT([ int_t ], int_t), "int" );
    defineBuiltin( intNsScope, "decrement",           IRNativeTag._decrement,             new TirFuncT([ int_t ], int_t), "int" );
    defineBuiltin( intNsScope, "isZero",              IRNativeTag._isZero,                new TirFuncT([ int_t ], bool_t), "int" );
    defineBuiltin( intNsScope, "exponentiate",        IRNativeTag._exponentiateInteger,   new TirFuncT([ int_t, int_t ], int_t), "int" );
    defineBuiltin( intNsScope, "toBoolean",           IRNativeTag._intToBool,             new TirFuncT([ int_t ], bool_t), "int" );

    // ---------- std.boolean (monomorphic) ----------
    defineBuiltin( boolNsScope, "not",        IRNativeTag._not,           new TirFuncT([ bool_t ], bool_t), "boolean" );
    defineBuiltin( boolNsScope, "strictAnd",  IRNativeTag._strictAnd,     new TirFuncT([ bool_t, bool_t ], bool_t), "boolean" );
    defineBuiltin( boolNsScope, "strictOr",   IRNativeTag._strictOr,      new TirFuncT([ bool_t, bool_t ], bool_t), "boolean" );
    defineBuiltin( boolNsScope, "equals",     IRNativeTag._equalBoolean,  new TirFuncT([ bool_t, bool_t ], bool_t), "boolean" );
    defineBuiltin( boolNsScope, "toInt",      IRNativeTag._boolToInt,     new TirFuncT([ bool_t ], int_t), "boolean" );

    // ---------- std.data (monomorphic) ----------
    defineBuiltin( dataNsScope, "strToData",   IRNativeTag._strToData,   new TirFuncT([ string_t ], data_t), "data" );
    defineBuiltin( dataNsScope, "strFromData", IRNativeTag._strFromData, new TirFuncT([ data_t ], string_t), "data" );

    // ---------- std.value / std.credential ----------
    // These reuse the prelude-registered `TirInlineClosedIR`s for
    // `Value.amountOf`, `Value.lovelaces`, `Credential.hash`. We just point
    // the namespace member at the existing program.functions entry.
    function defineAliasFromProgram(
        scope: AstScope,
        astName: string,
        existingTirFuncName: string
    ): void
    {
        if( !program.functions.has( existingTirFuncName ) )
        {
            // Prelude didn't register the wrapper — shouldn't happen, but
            // skip cleanly so a missing prelude entry doesn't break boot.
            return;
        }
        scope.functions.set( astName, existingTirFuncName );
    }
    // std.value.* — methods on the V4 native Value
    defineAliasFromProgram( valueNsScope,      "amountOf",  valueAmountOfName );
    defineAliasFromProgram( valueNsScope,      "lovelaces", valueLovelacesName );
    defineAliasFromProgram( valueNsScope,      "insert",    valueInsertCoinName );
    defineAliasFromProgram( valueNsScope,      "union",     valueUnionName );
    defineAliasFromProgram( valueNsScope,      "contains",  valueContainsName );
    defineAliasFromProgram( valueNsScope,      "scale",     valueScaleName );
    defineAliasFromProgram( valueNsScope,      "toData",    valueToDataName );
    // std.valueMap.* — methods on the V3-style AssocMap-of-AssocMap representation
    defineAliasFromProgram( valueMapNsScope,   "amountOf",  valueMapAmountOfName );
    defineAliasFromProgram( valueMapNsScope,   "lovelaces", valueMapLovelacesName );
    defineAliasFromProgram( credentialNsScope, "hash",      getCredentialHashFuncName );

    // ---------- std.array (polymorphic; V4 native array) ----------
    const arrayNs = "array";
    defineGenericBuiltin( arrayNsScope, "length", 1,
        ( [ T ] ) => new TirFuncT([ new TirArrayT( T ) ], int_t),
        () => new IRNative( IRNativeTag.lengthOfArray ),
        arrayNs
    );
    defineGenericBuiltin( arrayNsScope, "at", 1,
        ( [ T ] ) => new TirFuncT([ new TirArrayT( T ), int_t ], T),
        () => new IRNative( IRNativeTag.indexArray ),
        arrayNs
    );
    defineGenericBuiltin( arrayNsScope, "fromList", 1,
        ( [ T ] ) => new TirFuncT([ new TirListT( T ) ], new TirArrayT( T )),
        () => new IRNative( IRNativeTag.listToArray ),
        arrayNs
    );

    // ---------- top-level std.id<T> / std.equals<T> ----------
    // id<T>(x: T): T  -- the polymorphic identity. Useful as a default
    // argument or "do-nothing" callback to higher-order code.
    defineGenericBuiltin( stdNsScope, "id", 1,
        ( [ T ] ) => new TirFuncT([ T ], T),
        () => new IRNative( IRNativeTag._id ),
        "top"
    );
    // equals<T>(a: T, b: T): bool  -- compile-time-dispatched equality.
    // The right IRNative is picked per instantiation (equalsInteger /
    // equalsByteString / equalsData / etc.).
    defineGenericBuiltin( stdNsScope, "equals", 1,
        ( [ T ] ) => new TirFuncT([ T, T ], bool_t),
        ( [ T ] ) => {
            const tirKey = T.toConcreteTirTypeName();
            switch( tirKey )
            {
                case "int":     return new IRNative( IRNativeTag.equalsInteger );
                case "bytes":   return new IRNative( IRNativeTag.equalsByteString );
                case "boolean": return new IRNative( IRNativeTag._equalBoolean );
                case "data":    return new IRNative( IRNativeTag.equalsData );
                default:
                    // Fall back to data equality — covers data-encoded
                    // structs, optionals, and most other Pebble types.
                    return new IRNative( IRNativeTag.equalsData );
            }
        },
        "top"
    );

    // ------------------------------------------------------------------
    // 7. Hook the namespaces together and attach `std` to the prelude
    // ------------------------------------------------------------------
    blsNsScope.readonly();
    cryptoNsScope.defineNamespace({ name: "bls12_381", publicScope: blsNsScope } as NamespaceSymbol);
    cryptoNsScope.readonly();

    builtinsNsScope.readonly();
    listNsScope.readonly();
    arrayNsScope.readonly();
    linearMapNsScope.readonly();
    bytesNsScope.readonly();
    intNsScope.readonly();
    boolNsScope.readonly();
    dataNsScope.readonly();
    valueNsScope.readonly();
    valueMapNsScope.readonly();
    credentialNsScope.readonly();

    stdNsScope.defineNamespace({ name: "crypto",     publicScope: cryptoNsScope }     as NamespaceSymbol);
    stdNsScope.defineNamespace({ name: "builtins",   publicScope: builtinsNsScope }   as NamespaceSymbol);
    stdNsScope.defineNamespace({ name: "list",       publicScope: listNsScope }       as NamespaceSymbol);
    stdNsScope.defineNamespace({ name: "array",      publicScope: arrayNsScope }      as NamespaceSymbol);
    stdNsScope.defineNamespace({ name: "linearMap",  publicScope: linearMapNsScope }  as NamespaceSymbol);
    stdNsScope.defineNamespace({ name: "bytes",      publicScope: bytesNsScope }      as NamespaceSymbol);
    stdNsScope.defineNamespace({ name: "int",        publicScope: intNsScope }        as NamespaceSymbol);
    stdNsScope.defineNamespace({ name: "boolean",    publicScope: boolNsScope }       as NamespaceSymbol);
    stdNsScope.defineNamespace({ name: "data",       publicScope: dataNsScope }       as NamespaceSymbol);
    stdNsScope.defineNamespace({ name: "value",      publicScope: valueNsScope }      as NamespaceSymbol);
    stdNsScope.defineNamespace({ name: "valueMap",   publicScope: valueMapNsScope }   as NamespaceSymbol);
    stdNsScope.defineNamespace({ name: "credential", publicScope: credentialNsScope } as NamespaceSymbol);
    stdNsScope.readonly();

    program.preludeScope.defineNamespace({ name: "std", publicScope: stdNsScope } as NamespaceSymbol);
}
