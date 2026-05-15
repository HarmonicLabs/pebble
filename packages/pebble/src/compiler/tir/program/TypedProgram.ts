import { DiagnosticEmitter } from "../../../diagnostics/DiagnosticEmitter";
import { DiagnosticMessage } from "../../../diagnostics/DiagnosticMessage";
import { FuncExpr } from "../../../ast/nodes/expr/functions/FuncExpr";
import { AstScope } from "../../AstCompiler/scope/AstScope";
import { UidGenerator } from "../../internalVar";
import { TirExpr } from "../expressions/TirExpr";
import { TirFuncExpr } from "../expressions/TirFuncExpr";
import { TirInlineClosedIR } from "../expressions/TirInlineClosedIR";
import { TirSimpleVarDecl } from "../statements/TirVarDecl/TirSimpleVarDecl";
import { TirTestStmt } from "../statements/TirTestStmt";
import { TirTypeParam } from "../types/TirTypeParam";
import { isTirType, TirType } from "../types/TirType";
import { populatePreludeScope, populateStdScope } from "./stdScope/stdScope";
import { populateStdNamespace } from "./stdScope/populateStdNamespace";
import { populateBuiltinInterfaces } from "./stdScope/populateBuiltinInterfaces";
import { StdTypes } from "./stdScope/StdTypes";

export interface IGenericType {
    arity: number;
    apply: ( argsTirNames: string[] ) => (TirType | undefined);
}

/**
 * A pending generic function template registered at AST→TIR collection time.
 *
 * Two flavors are supported:
 * - "user" templates wrap a Pebble `function f<T>(...) { body }` AST node.
 *   `monomorphizeGeneric` instantiates one by re-compiling a clone of the
 *   AST in a scope where each type-param name aliases its concrete type.
 * - "native" templates wrap a polymorphic UPLC builtin (e.g. `mkCons<T>`).
 *   Each instantiation produces a fresh `TirInlineClosedIR` directly; there
 *   is no AST involved.
 *
 * Both flavors share the same monomorphization memoization on
 * `program.monomorphizationCache`.
 */
/**
 * An interface-constraint on a type parameter of a generic function.
 * Captured at template-registration time so `monomorphizeGeneric` doesn't
 * have to re-resolve the interface at each call site.
 */
export interface TypeParamConstraint {
    /** e.g. "ToData" */
    interfaceName: string;
    /** method-name -> AstFuncType signature (as registered in `scope.interfaces`) */
    methods: Map<string, import("../../../ast/nodes/types/AstNativeTypeExpr").AstFuncType>;
}

export interface BaseGenericTemplate {
    /** the AST function name (e.g. "id") or the canonical synthetic name (e.g. "mkCons") */
    astFuncName: string;
    /** the type-param symbols in declaration order */
    typeParams: TirTypeParam[];
    /** the canonical (pre-monomorphization) tir-name registered on the placeholder value */
    canonicalTirName: string;
    /** the placeholder TirFuncT (with TirTypeParams) used to type the generic identifier in scope */
    placeholderFuncType: import("../types/TirNativeType/native/function").TirFuncT;
    /**
     * One slot per type param, aligned by index with `typeParams`.
     * `undefined` for unconstrained params.
     */
    constraints: ( TypeParamConstraint | undefined )[];
}

export interface UserGenericTemplate extends BaseGenericTemplate {
    kind: "user";
    /** the FuncExpr AST node — cloned and re-compiled per instantiation */
    astFuncExpr: FuncExpr;
    /** the lexical scope where this template was declared */
    definingScope: AstScope;
}

export interface NativeGenericTemplate extends BaseGenericTemplate {
    kind: "native";
    /** produces a fresh closed-IR for a given type-arg vector */
    instantiate: ( typeArgs: TirType[] ) => TirInlineClosedIR;
}

export type GenericTemplate = UserGenericTemplate | NativeGenericTemplate;

/**
 * Factory for one method of an interface, evaluated against a concrete type
 * at monomorphization time. Returns the raw `IRTerm` callable as the method
 * dictionary — a closed IR closure `(self: ConcreteT, ...) -> ReturnT`.
 *
 * For the built-in `ToData` interface this is `_toDataUplcFunc(t)` from
 * `TirToDataExpr.ts` — a hoisted `IRFunc` that converts its argument to data
 * using the right per-type encoding (iData / bData / inline-struct-encoder / etc).
 *
 * Returning `undefined` signals "this type doesn't implement the interface",
 * which the caller turns into a diagnostic.
 */
export type BuiltinInterfaceImplFactory =
    ( concreteType: TirType ) => ( import("../../../IR/IRTerm").IRTerm | undefined );

/**
 * for now we only care about "executables"
 * 
 * TODO: support libraries
 */
export class TypedProgram extends DiagnosticEmitter
{
    readonly constants: Map<string, TirSimpleVarDecl>;

    readonly functions: Map<string, TirFuncExpr | TirInlineClosedIR>;

    /**
     * Generic function templates awaiting monomorphization. Keyed by the
     * canonical AST function name (e.g. "id" for `function id<T>(...)`).
     */
    readonly genericTemplates: Map<string, GenericTemplate> = new Map();

    /**
     * Monomorphization memo: `templateName + "$$" + concreteArgs.join("$$")`
     * → the TIR function name of the previously-compiled instance.
     */
    readonly monomorphizationCache: Map<string, string> = new Map();

    /**
     * Stack of monomorphizations currently in-flight, used to detect
     * polymorphic recursion (a generic instantiating itself with different
     * type arguments mid-compile).
     */
    readonly monomorphizationInFlight: Set<string> = new Set();

    /**
     * Built-in interface implementations.
     *
     *   builtinInterfaceImpls[interfaceName][methodName] = factory
     *
     * The factory, given a concrete TIR type, returns a `TirExpr` callable
     * as the method's dictionary entry (typed `(self: T, ...) -> ReturnT`).
     *
     * Populated by `populateBuiltinInterfaces` for `ToData` and any other
     * compiler-supplied interface that user types can implicitly satisfy.
     * User-declared `type Foo implements I { ... }` impls live on the
     * struct's `methodNamesPtr` instead.
     */
    readonly builtinInterfaceImpls: Map<string,
        Map<string, BuiltinInterfaceImplFactory>>
        = new Map();

    readonly types: Map<string, TirType>;
    private readonly genericTypes: Map<string, IGenericType>;

    /** Top-level `test name() { ... }` declarations collected from the entry file. */
    readonly tests: TirTestStmt[];

    /** main */
    public contractTirFuncName: string = "";

    readonly stdTypes: StdTypes;

    /** to every file is assigned a unique string used to prefix exported value,
     * to guarantee we have unique keys in the `this.constants` map 
    **/
    readonly filePrefix: Map<string, string>;

    readonly uid: UidGenerator

    readonly stdScope: AstScope;
    readonly preludeScope: AstScope;

    constructor(
        diagnostics: DiagnosticMessage[] = []
    )
    {
        super( diagnostics );
        
        this.uid = new UidGenerator();

        this.constants = new Map();

        this.functions = new Map();
        
        this.types = new Map();
        this.genericTypes = new Map();

        this.tests = [];

        this.filePrefix = new Map();

        this.stdScope = new AstScope( undefined, this, { isFunctionDeclScope: false, isMethodScope: false } );
        populateStdScope( this );

        this.stdTypes = new StdTypes( this );

        this.preludeScope = new AstScope( this.stdScope, this, { isFunctionDeclScope: false, isMethodScope: false } );
        populatePreludeScope( this );

        // Register built-in interfaces (currently: `ToData`) and their
        // compiler-supplied impl factories. Must precede `populateStdNamespace`
        // so constrained native templates (`std.linearMap.prepend`) can
        // reference `ToData` at registration time.
        populateBuiltinInterfaces( this );

        // The `std`, `std.crypto`, `std.crypto.bls12_381`, `std.builtins`
        // namespaces and all their members live on the prelude scope.
        populateStdNamespace( this );
    }

    registerType( tirType: TirType ): boolean
    {
        if( !isTirType( tirType ) ) return false;
        const tirTypeName = tirType.toConcreteTirTypeName();
        if( this.types.has( tirTypeName ) ) return false;
        this.types.set( tirTypeName, tirType );
        return true;
    }

    getMainOrThrow(): TirFuncExpr
    {
        if( this.contractTirFuncName === "" ) 
        throw new Error("TypedProgram: main function name not set");

        const mainFuncExpr = this.functions.get( this.contractTirFuncName );
        if(!( mainFuncExpr instanceof TirFuncExpr ))
        throw new Error(`TypedProgram: main function '${this.contractTirFuncName}' not found or not a function`);

        return mainFuncExpr;
    }

    getFilePrefix( path: string ): string
    {
        if( !this.filePrefix.has( path ) )
        {
            const prefix = this.uid.getUid();
            this.filePrefix.set( path, prefix );
        }
        return this.filePrefix.get( path )!;
    }

    defineGenericType(
        tirKey: string,
        arity: number,
        mkApplied: ( tyArgs: TirType[] ) => TirType
    ): boolean
    {
        if(!(
            typeof tirKey === "string" && tirKey.length > 0
            && Number.isSafeInteger( arity ) && arity > 0
            && typeof mkApplied === "function"
        )) return false;
        if( this.genericTypes.has( tirKey ) ) return false;

        this.genericTypes.set(
            tirKey,
            this._mkGenericInfos( tirKey, arity, mkApplied )
        );
        return true;
    }
    getAppliedGeneric( genericTirKey: string, concreteArgsNames: (string | TirType)[] ): TirType | undefined
    {
        const genericInfos = this.genericTypes.get( genericTirKey );
        if( typeof genericInfos !== "object" ) return undefined;
        const { arity, apply } = genericInfos;
        if( concreteArgsNames.length < arity ) return undefined;
        concreteArgsNames = concreteArgsNames.slice( 0, arity );
        // `apply` also defines the applied concrete type
        const applied = apply( concreteArgsNames.map( t => typeof t === "string" ? t : t.toConcreteTirTypeName() ) );
        if( !applied ) return undefined;
        return applied;
    }

    private  _mkGenericInfos(
        tirKey: string,
        arity: number,
        mkApplied: ( tyArgs: TirType[] ) => TirType
    ): IGenericType
    {
        return {
            arity,
            apply: _genericInfosApply.bind({
                program: this,
                tirKey,
                arity,
                mkApplied
            })
        };
    }

    private _fileExports: Map<string, AstScope> = new Map();
    getExportedSymbols( srcAbsPathsrcAbsPath: string ): AstScope | undefined
    {
        return this._fileExports.get( srcAbsPathsrcAbsPath );
    }
    setExportedSymbols( srcAbsPathsrcAbsPath: string, scope: AstScope ): void
    {
        this._fileExports.set( srcAbsPathsrcAbsPath, scope );
    }
}

// if htis is causing problems
// (such as not resulting in the same name for the same type)
// it can be removed,
// and in `_genericInfosApply` the method `.toConcreteTirTypeName()`
// should be used to save the type in the program
export function getAppliedTirTypeName(
    baseName: string,
    args: string[]
): string
{
    return `${baseName}<${args.join(",")}>`;
}

interface GenericInfosApplyScope {
    program: TypedProgram;
    tirKey: string;
    arity: number;
    mkApplied: ( tyArgs: TirType[] ) => TirType;
}
function _genericInfosApply( this: GenericInfosApplyScope, argsTirNames: string[] ): TirType | undefined
{
    const { program, tirKey, arity, mkApplied } = this;

    if( argsTirNames.length < arity ) return undefined;

    argsTirNames = argsTirNames.slice( 0, arity );

    const appliedConcreteName = getAppliedTirTypeName(
        tirKey,
        argsTirNames
    );
    if( program.types.has( appliedConcreteName ) ) return program.types.get( appliedConcreteName )!;

    const args = argsTirNames.map( t => program.types.get( t )! );
    if( args.some( t => !(t && t.isConcrete()) ) ) return undefined;
    
    const applied = mkApplied( args );
    if(!(
        isTirType( applied )
        && applied.isConcrete()
    )) return undefined;

    // !!! DO NOT REMOVE !!!
    program.types.set( appliedConcreteName, applied );

    return applied;
}