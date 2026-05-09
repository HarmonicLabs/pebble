import { AstFuncType } from "../../../ast/nodes/types/AstNativeTypeExpr";
import { TypedProgram } from "../../tir/program/TypedProgram";
import { TirType } from "../../tir/types/TirType";
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
}

export interface IVariableInfos {
    name: string;
    type: TirType;
    isConstant: boolean;
}

export interface PossibleTirTypes {
    sopTirName: string;
    dataTirName: string | undefined;
    allTirNames: Set<string>;
    methodsNames: Map<AstFuncName, TirFuncName>;
    isGeneric: boolean;
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
     * Flow-sensitive type narrowings active in this scope.
     * Variable name -> narrowed type (overrides the type recorded in `variables`
     * or any parent scope's narrowing/binding when resolving this variable).
     */
    readonly narrowings: Map<string, TirType> = new Map();
    readonly aviableConstructors: Map<string, IAvaiableConstructor> = new Map();

    private _isReadonly = false;
    readonly infos: ScopeInfos;
    
    constructor(
        parent: AstScope | undefined,
        readonly program: TypedProgram,
        infos: Partial<ScopeInfos>,
    ) {
        this.infos = normalizeScopeInfos( infos );
        this._isReadonly = false;

        this.parent = parent;
    }

    defineValue( valueInfos: IVariableInfos ): boolean
    {
        if( valueInfos.name === "§tx_3" ) console.log( "Defining variable tx3" );
        if( this._isReadonly ) return false;

        if(
            invalidSymbolNames.has( valueInfos.name )
            && !( valueInfos.name === "this" && this.infos.isMethodScope )
        ) return false;
        if( this.variables.has( valueInfos.name ) ) return false; // already defined

        this.variables.set( valueInfos.name, valueInfos );
        return true;
    }

    resolveValue( name: string ): ResolveValueResult | undefined
    {
        const narrowed = this.narrowings.get( name );
        const localValue = this.variables.get( name );
        if( localValue ) return {
            variableInfos: narrowed
                ? { ...localValue, type: narrowed }
                : localValue,
            isDefinedOutsideFuncScope: false
        };

        if( this.parent )
        {
            const parentValue = this.parent.resolveValue( name );
            if( !parentValue ) return undefined;

            return {
                variableInfos: narrowed
                    ? { ...parentValue.variableInfos, type: narrowed }
                    : parentValue.variableInfos,
                isDefinedOutsideFuncScope: parentValue.isDefinedOutsideFuncScope || this.infos.isFunctionDeclScope
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

    newChildScope( infos: Partial<ScopeInfos> ): AstScope
    {
        return new AstScope( this, this.program, infos );
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

        return cloned;
    }
}