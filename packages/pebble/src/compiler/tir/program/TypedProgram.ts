import { DiagnosticEmitter } from "../../../diagnostics/DiagnosticEmitter";
import { DiagnosticMessage } from "../../../diagnostics/DiagnosticMessage";
import { AstScope } from "../../AstCompiler/scope/AstScope";
import { UidGenerator } from "../../internalVar";
import { TirExpr } from "../expressions/TirExpr";
import { TirFuncExpr } from "../expressions/TirFuncExpr";
import { TirInlineClosedIR } from "../expressions/TirInlineClosedIR";
import { TirSimpleVarDecl } from "../statements/TirVarDecl/TirSimpleVarDecl";
import { TirTestStmt } from "../statements/TirTestStmt";
import { isTirType, TirType } from "../types/TirType";
import { populatePreludeScope, populateStdScope } from "./stdScope/stdScope";
import { StdTypes } from "./stdScope/StdTypes";

export interface IGenericType {
    arity: number;
    apply: ( argsTirNames: string[] ) => (TirType | undefined);
}

/**
 * for now we only care about "executables"
 * 
 * TODO: support libraries
 */
export class TypedProgram extends DiagnosticEmitter
{
    readonly constants: Map<string, TirSimpleVarDecl>;

    readonly functions: Map<string, TirFuncExpr | TirInlineClosedIR>;

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