import { AstFuncType } from "../../../ast/nodes/types/AstNativeTypeExpr";
import { SourceRange } from "../../../ast/Source/SourceRange";
import type { PebbleSymbol } from "../../SymbolIndex";
import { TypedProgram, TypeParamConstraint } from "../../tir/program/TypedProgram";
import { TirType } from "../../tir/types/TirType";
import { TirTypeParam } from "../../tir/types/TirTypeParam";
import { getStructType } from "../../tir/types/utils/canAssignTo";

export interface ScopeInfos {
    isFunctionDeclScope: boolean;
    isMethodScope: boolean;
}

const defauldScopeInfos: ScopeInfos = Object.freeze({
    isFunctionDeclScope: false,
    isMethodScope: false
});

function normalizeScopeInfos( infos: Partial<ScopeInfos> ): ScopeInfos
{
    const result = {
        ...defauldScopeInfos,
        ...infos
    };

    result.isFunctionDeclScope = !!result.isFunctionDeclScope;
    result.isMethodScope = !!result.isMethodScope;

    // method scope == true
    // implies function decl scope also == true
    result.isFunctionDeclScope = result.isFunctionDeclScope || result.isMethodScope;

    return result;
}

export type AstFuncName = string;
export type TirFuncName = string;

const invalidSymbolNames = new Set([
    "this"
]);

export interface IAvaiableConstructor {
    declaredName: string;
    originalName: string;
    structType: TirType;
}

export interface JsonScope {
    variables: { [x: string]: string };
    /** tir name -> unambigous function type */
    functions: { [x: string]: string };
    /** tir names of types */
    types: string[];
    child: JsonScope | undefined;
}

export interface ResolveValueResult {
    variableInfos: IVariableInfos;
    isDefinedOutsideFuncScope: boolean;
    /**
     * `true` iff resolving crossed the START of a function (a lambda /
     * function / method body scope): the binding belongs to an ENCLOSING
     * function and is being CAPTURED by a closure.
     * (unlike `isDefinedOutsideFuncScope`, block/branch/loop scopes inside
     * the same function do NOT count.)
     */
    crossesFunctionBoundary?: boolean;
}

export interface IVariableInfos {
    name: string;
    type: TirType;
    isConstant: boolean;
    /**
     * If set, this binding is a placeholder for a generic function template.
     * The actual TIR function does not exist yet; it must be instantiated
     * at the call site by `monomorphizeGeneric` using the template stored in
     * `TypedProgram.genericTemplates` under this name.
     *
     * `type` for a generic placeholder is the *un-substituted* TirFuncT —
     * i.e. it may contain `TirTypeParam` nodes for each declared type param.
     */
    genericTemplateName?: string;
    /** the declaration, in the program's symbol index (`TypedProgram.symbols`, a check) */
    symbol?: PebbleSymbol;
}

/**
 * A value of a module (or of a namespace) whose declaration is not compiled yet.
 *
 * The functions and the constants a module declares are visible in the WHOLE module, whatever
 * the order the source declares them in: a function can call one declared below it. So a
 * declaration is compiled by whichever comes first: its own statement, or the first use of
 * its name (see `AstScope.resolveValue`).
 */
export interface PendingValueDecl {
    /**
     * - `"pending"`: not compiled yet
     * - `"compiling"`: being compiled right now; a use of the name found in this state is a
     *   use inside the declaration's own definition, through the other declarations the
     *   definition uses (see `AstScope.isBeingDeclared`)
     * - `"done"`: compiled; the name is defined in the scope, or failed with its error reported
     */
    state: "pending" | "compiling" | "done";
    /** compiles the declaration: defines its name in the scope, or reports why it cannot */
    readonly compile: () => void;
}

/**
 * A namespace is a compile-time only construct that groups
 * symbols (values, types, functions, interfaces, and nested
 * namespaces) under a single name.
 *
 * Members of the namespace marked with `private` are NOT included
 * in `publicScope`; they only live in the namespace's body-compilation
 * scope and are unreachable from outside.
 */
export interface NamespaceSymbol {
    name: string;
    publicScope: AstScope;
}

export interface PossibleTirTypes {
    sopTirName: string;
    dataTirName: string | undefined;
    allTirNames: Set<string>;
    methodsNames: Map<AstFuncName, TirFuncName>;
    isGeneric: boolean;
    /**
     * `true` for USER-DECLARED generic structs. Named-type resolution for
     * user structs prefers the DATA encoding in EVERY position (both type
     * compilers' non-generic tails read `dataTirName`); generic user structs
     * must follow the same convention or a `Box<int>` var annotation (sop
     * path) and a `Box<int>` function param (data path) would resolve to
     * different encodings and fail to unify. Native generics (`Optional`)
     * intentionally keep the per-position sop/data split.
     */
    isGenericStruct?: boolean;
    /** the declaration, in the program's symbol index (a check); here, an import of it */
    symbol?: PebbleSymbol;
}

/**
 * type-level symbols of an `export contract` declaration
 * (`redeemerof C` / `redeemerof C.State` resolve through this).
 */
export interface AstContractSymbol {
    name: string;
    /** data-encoded state-datum union TIR key; `undefined` if the contract has no states */
    datumTirName: string | undefined;
    /** merged direct-methods redeemer union TIR key; `undefined` if no direct methods */
    directRedeemerTirName: string | undefined;
    /** state name -> that state's spend redeemer union TIR key */
    stateRedeemerTirNames: ReadonlyMap<string, string>;
    /** all state names, including spend-less ones (for diagnostics) */
    stateNames: readonly string[];
}

export class AstScope
{
    readonly parent: AstScope | undefined;
    /**
     * ast name -> Set<tir name>
     * 
     * a single ast name can correspond to multiple tir names
     * eg. a struct can have either SoP or data encoding
     * so those are 2 different tir names
     **/
    readonly types: Map<string, PossibleTirTypes> = new Map();
    /**
     * interfaces are not a thing in tir
     */
    readonly interfaces: Map<string, Map<string, AstFuncType>> = new Map();
    /**
     * ast name -> tir name
     * 
     * the process is:
     * (->) 1 to 1
     * (=>) 1 to many
     * 
     * ast name
     * -> tir name (in program)
     * => signatures (different encodings) (ast node saved here)
     * => func values (registered in the program)
     * 
     * user overloads NOT SUPPORTED
     **/
    readonly functions: Map<AstFuncName, TirFuncName> = new Map();
    /**
     * ast name -> variable infos (name, type, isConstant)
     */
    readonly variables: Map<string, IVariableInfos> = new Map();
    /**
     * ast name -> the declaration of that value in this scope, while it may still have to
     * be compiled (see `PendingValueDecl`). Only a module's (or a namespace's) top level
     * has any.
     */
    readonly pendingValues: Map<string, PendingValueDecl> = new Map();
    /**
     * Flow-sensitive type narrowings active in this scope.
     * Variable name -> narrowed type (overrides the type recorded in `variables`
     * or any parent scope's narrowing/binding when resolving this variable).
     */
    readonly narrowings: Map<string, TirType> = new Map();
    /**
     * names declared here whose declaration failed, with no type to give them (its error is
     * reported): using one reports nothing more (see `resolvesToFailedValue`)
     */
    readonly failedValues: Map<string, PebbleSymbol | undefined> = new Map();
    readonly aviableConstructors: Map<string, IAvaiableConstructor> = new Map();
    /**
     * ast name -> namespace symbol
     *
     * namespaces are compile-time only; they do not emit IR
     */
    readonly namespaces: Map<string, NamespaceSymbol> = new Map();
    /**
     * ast name -> exported-contract symbol (see `AstContractSymbol`);
     * compile-time only, like namespaces
     */
    readonly contracts: Map<string, AstContractSymbol> = new Map();

    /**
     * Generic type parameters in scope, e.g. while compiling the signature
     * (and later the body) of a generic function `function f<T>(...)`. These
     * are NOT real types — they only mark positions that must be substituted
     * by `monomorphizeGeneric` at each call site.
     *
     * When `_compileDataEncodedConcreteType` / `_compileSopEncodedConcreteType`
     * encounter an `AstNamedTypeExpr` whose name is here, it returns the
     * corresponding `TirTypeParam` directly instead of going through the
     * regular `resolveType` path.
     */
    readonly typeParams: Map<string, TirTypeParam> = new Map();

    private _isReadonly = false;
    readonly infos: ScopeInfos;
    /**
     * the source this scope covers (a block, a function, a loop, a branch): a name declared in
     * it can be used from its declaration to the end of it. `undefined` for scopes the source
     * does not delimit (a file's top level: the whole file)
     */
    range: SourceRange | undefined = undefined;
    
    constructor(
        parent: AstScope | undefined,
        readonly program: TypedProgram,
        infos: Partial<ScopeInfos>,
        /** `true` ONLY for the scope where a function/lambda/method BODY starts */
        readonly isFunctionBoundary: boolean = false,
    ) {
        this.infos = normalizeScopeInfos( infos );
        this._isReadonly = false;

        this.parent = parent;
    }

    /**
     * @param astName the name the source uses; `valueInfos.name` is the TIR name, the same
     * unless the declaration shadows a variable of its function (see `shadowsFunctionLocal`)
     */
    defineValue( valueInfos: IVariableInfos, astName: string = valueInfos.name ): boolean
    {
        if( this._isReadonly ) return false;

        if(
            invalidSymbolNames.has( astName )
            && !( astName === "this" && this.infos.isMethodScope )
        ) return false;
        if( this.variables.has( astName ) ) return false; // already defined

        this.variables.set( astName, valueInfos );
        return true;
    }

    /** `astName` is declared here, but its declaration failed and gives it no type */
    defineFailedValue( astName: string, symbol?: PebbleSymbol ): void
    {
        if( this._isReadonly || this.variables.has( astName ) ) return;
        this.failedValues.set( astName, symbol );
    }

    /**
     * whether `name` names a declaration that failed (`defineFailedValue`): it is not undefined,
     * and its error is reported already
     */
    resolvesToFailedValue( name: string ): boolean
    {
        for( let scope: AstScope | undefined = this; scope !== undefined; scope = scope.parent )
        {
            if( scope.variables.has( name ) ) return false;
            if( scope.failedValues.has( name ) ) return true;
        }
        return false;
    }

    /** the declaration a failed `name` stands for, in the symbol index (a check) */
    failedValueSymbol( name: string ): PebbleSymbol | undefined
    {
        for( let scope: AstScope | undefined = this; scope !== undefined; scope = scope.parent )
        {
            if( scope.variables.has( name ) ) return undefined;
            if( scope.failedValues.has( name ) ) return scope.failedValues.get( name );
        }
        return undefined;
    }

    /**
     * `true` iff a declaration of `name` in this scope shadows a variable (or parameter) of
     * the same function, declared in an enclosing block. The two need different TIR names:
     * a block is compiled inline in the enclosing body, where they would be one variable.
     *
     * `false` outside functions, and for variables of enclosing functions (closures get
     * their own context).
     */
    shadowsFunctionLocal( name: string ): boolean
    {
        if( this.isFunctionBoundary ) return false;
        let found = false;
        for( let scope = this.parent; scope !== undefined; scope = scope.parent )
        {
            if( !found && scope.variables.has( name ) ) found = true;
            if( scope.isFunctionBoundary ) return found;
        }
        return false;
    }

    /**
     * declares that `astName` is a value of this scope, compiled by `compile` (see
     * `PendingValueDecl`).
     *
     * @returns the declaration, or `undefined` if the scope has one for the name already: the
     * statement is a redeclaration, to compile (and refuse) where the source has it
     */
    declarePendingValue( astName: string, compile: () => void ): PendingValueDecl | undefined
    {
        if( this._isReadonly || this.pendingValues.has( astName ) ) return undefined;
        const decl: PendingValueDecl = { state: "pending", compile };
        this.pendingValues.set( astName, decl );
        return decl;
    }

    /**
     * makes `decl`, a declaration of another scope, reachable by `astName` here too: the
     * scope of a namespace's exported members holds the declarations of the namespace's own
     */
    sharePendingValue( astName: string, decl: PendingValueDecl ): void
    {
        if( this._isReadonly || this.pendingValues.has( astName ) ) return;
        this.pendingValues.set( astName, decl );
    }

    /**
     * for a member of this scope read DIRECTLY, not through `resolveValue` (a namespace's
     * member, `Ns.member`): compiles its declaration, if it still has to be.
     *
     * @returns `false` if the declaration is being compiled right now: the read is part of
     * the member's own definition (see `isBeingDeclared`)
     */
    ensureValueDeclared( name: string ): boolean
    {
        const pending = this.pendingValues.get( name );
        if( !pending ) return true;
        if( pending.state === "compiling" ) return false;
        AstScope.compilePendingValue( pending );
        return true;
    }

    /** compiles `decl`, unless it is compiled (or being compiled) already */
    static compilePendingValue( decl: PendingValueDecl ): void
    {
        if( decl.state !== "pending" ) return;
        decl.state = "compiling";
        try { decl.compile(); }
        finally { decl.state = "done"; }
    }

    /**
     * `true` iff `name` resolves to a declaration of a module (or a namespace) that is being
     * compiled right now.
     *
     * Declarations compile one inside the other only when the outer one USES the inner one,
     * so the use asking is inside the definition of `name`: `name` is defined in terms of
     * itself. (A function calling itself does not get here: its own name resolves to the
     * function's scope, see `_compileFuncExpr`.)
     */
    isBeingDeclared( name: string ): boolean
    {
        for( let scope: AstScope | undefined = this; scope !== undefined; scope = scope.parent )
        {
            const pending = scope.pendingValues.get( name );
            if( pending ) return pending.state === "compiling";
            if( scope.variables.has( name ) ) return false;
        }
        return false;
    }

    /**
     * the module-unique name (the key in `TypedProgram.functions`) of the function `name`
     * stands for in this scope: one declared here, or imported, under that name
     */
    resolveFunctionName( name: string ): TirFuncName | undefined
    {
        return (
            this.functions.get( name )
            ?? this.parent?.resolveFunctionName( name )
        );
    }

    resolveValue( name: string ): ResolveValueResult | undefined
    {
        // a value this scope declares, not compiled yet: this use is the first one
        if( !this.variables.has( name ) )
        {
            const pending = this.pendingValues.get( name );
            if( pending ) AstScope.compilePendingValue( pending );
        }

        const narrowed = this.narrowings.get( name );
        const localValue = this.variables.get( name );
        if( localValue ) return {
            variableInfos: narrowed
                ? { ...localValue, type: narrowed }
                : localValue,
            isDefinedOutsideFuncScope: false,
            crossesFunctionBoundary: false
        };

        if( this.parent )
        {
            const parentValue = this.parent.resolveValue( name );
            if( !parentValue ) return undefined;

            return {
                variableInfos: narrowed
                    ? { ...parentValue.variableInfos, type: narrowed }
                    : parentValue.variableInfos,
                isDefinedOutsideFuncScope: parentValue.isDefinedOutsideFuncScope || this.infos.isFunctionDeclScope,
                // the binding lives above; if THIS scope starts a function
                // body, the access captures it from an enclosing function
                crossesFunctionBoundary: parentValue.crossesFunctionBoundary || this.isFunctionBoundary
            };
        }

        return undefined;
    }

    /**
     * Records a flow-sensitive narrowing for `name` in THIS scope.
     * Subsequent `resolveValue(name)` calls (in this scope or its
     * descendants, until shadowed) will return the narrowed type.
     */
    narrowVariable( name: string, narrowedType: TirType ): void
    {
        if( this._isReadonly ) return;
        this.narrowings.set( name, narrowedType );
    }

    allVariables(): string[]
    {
        return ( this.parent?.allVariables() ?? [] ).concat(
            Array.from( this.variables.keys() )
        );
    }

    defineUnambigousType(
        name: string,
        tirTypeKey: string,
        allowsDataEncoding: boolean,
        methodsNames: Map<AstFuncName, TirFuncName>
    ): boolean
    {
        if( this._isReadonly ) return false;

        if( invalidSymbolNames.has( name ) ) return false;
        if( this.types.has( name ) ) return false; // already defined

        this.types.set( name, {
            sopTirName: tirTypeKey,
            dataTirName: allowsDataEncoding ? tirTypeKey : undefined,
            allTirNames: new Set([ tirTypeKey ]),
            methodsNames,
            isGeneric: false
        });
        return true;
    }

    defineType(
        name: string,
        possibleTirTypes: PossibleTirTypes
    ): boolean
    {
        if( this._isReadonly ) {
            throw new Error("Cannot define type on readonly scope");
        }

        if( invalidSymbolNames.has( name ) ) return false;
        if( this.types.has( name ) ) return false; // already defined

        this.types.set( name, possibleTirTypes );
        return true;
    }

    resolveLocalType(
        name: string
    ): PossibleTirTypes | undefined
    {
        return this.types.get( name );
    }
    
    resolveType(
        name: string
    ): PossibleTirTypes | undefined
    {
        return (
            this.resolveLocalType( name )
            ?? this.parent?.resolveType( name )
        );
    }

    toJSON(): JsonScope { return this.toJson(); }
    toJson( child: JsonScope | undefined = undefined ): JsonScope
    {
        const localValues: { [x: string]: string } = {};
        for( const [key, value] of this.variables ) localValues[key] = value.type.toConcreteTirTypeName();

        const localFunctions: { [x: string]: string } = {};
        for( const [_key, value] of this.functions )
            for( const [tirName, tirType] of value )
                localFunctions[tirName] = tirType.toString();

        const localTypes: string[] = [];
        for( const [ astTypeName, _possibleTirTypeNames ] of this.types )
            localTypes.push( astTypeName );

        const thisResult: JsonScope = {
            variables: localValues,
            functions: localFunctions,
            types: localTypes,
            child
        };

        if( this.parent ) return this.parent.toJson( thisResult );
        else return thisResult;
    }

    readonly(): void { this._isReadonly = true; }

    newChildScope( infos: Partial<ScopeInfos>, isFunctionBoundary: boolean = false ): AstScope
    {
        return new AstScope( this, this.program, infos, isFunctionBoundary );
    }

    /**
     * @returns `true` if the constructor was defined successfully
     * 
     * @returns `false`
     *      if it was already defined in this scope (shadows any similar definitions in parent scopes),
     *      or if the type symbol is not assignable to a struct,
     *      or if it is a struct but is not concrete
     */
    defineAviableConstructorIfValid(
        declaredName: string,
        originalName: string,
        structOrAliasType: TirType,
        // genericTypeSymbol: PebbleGenericSym | undefined
    ): boolean
    {
        const structType = getStructType( structOrAliasType );
        if( !structType || !structType.isConcrete() || !structOrAliasType.isConcrete() )
            return false; // not a concrete struct

        if( this.aviableConstructors.has( declaredName ) ) return false; // already defined

        this.aviableConstructors.set( declaredName, {
            declaredName,
            originalName,
            structType: structOrAliasType
        });
        return true;
    }
    inferStructTypeFromConstructorName( name: string ): IAvaiableConstructor | undefined
    {
        return (
            this.aviableConstructors.get( name )
            ?? this.parent?.inferStructTypeFromConstructorName( name )
        );
    }

    /** define a namespace in this scope; returns `false` if shadowed in current scope */
    defineNamespace( ns: NamespaceSymbol ): boolean
    {
        if( this._isReadonly ) return false;
        if( invalidSymbolNames.has( ns.name ) ) return false;
        if( this.namespaces.has( ns.name ) ) return false;
        this.namespaces.set( ns.name, ns );
        return true;
    }

    /** resolve a namespace by walking the scope chain */
    resolveNamespace( name: string ): NamespaceSymbol | undefined
    {
        return (
            this.namespaces.get( name )
            ?? this.parent?.resolveNamespace( name )
        );
    }

    /** define an exported-contract symbol; returns `false` if shadowed in current scope */
    defineContract( sym: AstContractSymbol ): boolean
    {
        if( this._isReadonly ) return false;
        if( invalidSymbolNames.has( sym.name ) ) return false;
        if( this.contracts.has( sym.name ) ) return false;
        this.contracts.set( sym.name, sym );
        return true;
    }

    /** resolve an exported-contract symbol by walking the scope chain */
    resolveContract( name: string ): AstContractSymbol | undefined
    {
        return (
            this.contracts.get( name )
            ?? this.parent?.resolveContract( name )
        );
    }

    /** define a generic type parameter in this scope; returns `false` if shadowed */
    defineTypeParam( name: string, param: TirTypeParam ): boolean
    {
        if( this._isReadonly ) return false;
        if( this.typeParams.has( name ) ) return false;
        this.typeParams.set( name, param );
        return true;
    }

    /** resolve a generic type parameter by walking the scope chain */
    resolveTypeParam( name: string ): TirTypeParam | undefined
    {
        return (
            this.typeParams.get( name )
            ?? this.parent?.resolveTypeParam( name )
        );
    }

    /**
     * Type-parameter constraints declared via `<T implements I>` syntax.
     * Populated by `AstCompiler._registerGenericTemplate` for the function
     * template's compilation scope. `resolveTypeParamConstraint` walks the
     * parent chain like the other resolvers.
     */
    readonly typeParamConstraints: Map<string, TypeParamConstraint> = new Map();

    defineTypeParamConstraint( name: string, constraint: TypeParamConstraint ): boolean
    {
        if( this._isReadonly ) return false;
        if( this.typeParamConstraints.has( name ) ) return false;
        this.typeParamConstraints.set( name, constraint );
        return true;
    }

    resolveTypeParamConstraint( name: string ): TypeParamConstraint | undefined
    {
        return (
            this.typeParamConstraints.get( name )
            ?? this.parent?.resolveTypeParamConstraint( name )
        );
    }

    /**
     * Walk the scope chain to resolve an interface by name. Returns the
     * method-name -> AstFuncType signature map.
     */
    resolveInterface( name: string ): Map<string, AstFuncType> | undefined
    {
        return (
            this.interfaces.get( name )
            ?? this.parent?.resolveInterface( name )
        );
    }

    /**
     * `true` if `name` is bound in this scope (or any parent) under any kind.
     * Used to detect shadowing across symbol categories when defining a new symbol.
     */
    hasAnySymbol( name: string ): boolean
    {
        if(
            this.variables.has( name )
            || this.types.has( name )
            || this.functions.has( name )
            || this.interfaces.has( name )
            || this.namespaces.has( name )
            || this.aviableConstructors.has( name )
        ) return true;
        return this.parent?.hasAnySymbol( name ) ?? false;
    }

    clone(): AstScope
    {
        const cloned = new AstScope(
            this.parent,
            this.program,
            this.infos
        );
        for( const [key, value] of this.variables )
            cloned.variables.set(
                key,
                { ...value }
            );

        for( const [key, value] of this.narrowings )
            cloned.narrowings.set( key, value.clone() );

        for( const [key, value] of this.functions )
            cloned.functions.set(
                key,
                value
            );

        for( const [key, value] of this.types )
            cloned.types.set(
                key,
                value
            );

        for( const [key, value] of this.aviableConstructors )
            cloned.aviableConstructors.set(
                key,
                {
                    ...value,
                    structType: value.structType.clone(),
                }
            );

        for( const [ name, methods ] of this.interfaces )
            cloned.interfaces.set( name, new Map( methods ) );

        for( const [ name, ns ] of this.namespaces )
            cloned.namespaces.set( name, ns );

        for( const [ name, sym ] of this.contracts )
            cloned.contracts.set( name, sym );

        cloned.range = this.range;
        return cloned;
    }
}