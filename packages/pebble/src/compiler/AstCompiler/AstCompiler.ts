import { StructDecl, StructDeclAstFlags } from "../../ast/nodes/statements/declarations/StructDecl";
import { TypeAliasDecl } from "../../ast/nodes/statements/declarations/TypeAliasDecl";
import { ExportStarStmt } from "../../ast/nodes/statements/ExportStarStmt";
import { ImportStarStmt } from "../../ast/nodes/statements/ImportStarStmt";
import { ImportStmt } from "../../ast/nodes/statements/ImportStmt";
import { Source, SourceKind } from "../../ast/Source/Source";
import { SourceRange } from "../../ast/Source/SourceRange";
import { DiagnosticEmitter } from "../../diagnostics/DiagnosticEmitter";
import { DiagnosticMessage } from "../../diagnostics/DiagnosticMessage";
import { DiagnosticCode } from "../../diagnostics/diagnosticMessages.generated";
import { CompilerOptions } from "../../IR/toUPLC/CompilerOptions";
import { Parser } from "../../parser/Parser";
import { CompilerIoApi, createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { AstFuncName, PossibleTirTypes, AstScope, TirFuncName } from "./scope/AstScope";
import { TypedProgram } from "../tir/program/TypedProgram";
import { TirAliasType } from "../tir/types/TirAliasType";
import { TirDataStructType, TirSoPStructType, TirStructConstr, TirStructField } from "../tir/types/TirStructType";
import { ExportStmt } from "../../ast/nodes/statements/ExportStmt";
import { ResolveStackNode } from "./utils/deps/ResolveStackNode";
import { AstCompilationCtx } from "./AstCompilationCtx";
import { _compileStatement } from "./internal/statements/_compileStatement";
import { _compileExpr } from "./internal/exprs/_compileExpr";
import { _compileDataEncodedConcreteType } from "./internal/types/_compileDataEncodedConcreteType";
import { getAbsolutePath, getEnvRelativePath } from "../path/getAbsolutePath";
import { TirType } from "../tir/types/TirType";
import { _compileSopEncodedConcreteType } from "./internal/types/_compileSopEncodedConcreteType";
import { InterfaceDecl } from "../../ast/nodes/statements/declarations/InterfaceDecl";
import { AstFuncType, AstVoidType } from "../../ast/nodes/types/AstNativeTypeExpr";
import { FuncDecl } from "../../ast/nodes/statements/declarations/FuncDecl";
import { InterfaceMethodImpl, TypeImplementsStmt } from "../../ast/nodes/statements/TypeImplementsStmt";
import { getUniqueInternalName, PEBBLE_INTERNAL_IDENTIFIER_PREFIX } from "../internalVar";
import { AstNamedTypeExpr } from "../../ast/nodes/types/AstNamedTypeExpr";
import { FuncExpr } from "../../ast/nodes/expr/functions/FuncExpr";
import { CommonFlags } from "../../common";
import { SimpleVarDecl } from "../../ast/nodes/statements/declarations/VarDecl/SimpleVarDecl";
import { Identifier } from "../../ast/nodes/common/Identifier";
import { ArrowKind } from "../../ast/nodes/expr/functions/ArrowKind";
import { _compileFuncExpr } from "./internal/exprs/_compileFuncExpr";
import { BodyStmt, TopLevelStmt } from "../../ast/nodes/statements/PebbleStmt";
import { ContractDecl } from "../../ast/nodes/statements/declarations/ContractDecl";
import { BlockStmt } from "../../ast/nodes/statements/BlockStmt";
import { FailStmt } from "../../ast/nodes/statements/FailStmt";
import { SingleDeconstructVarDecl } from "../../ast/nodes/statements/declarations/VarDecl/SingleDeconstructVarDecl";
import { VarDecl } from "../../ast/nodes/statements/declarations/VarDecl/VarDecl";
import { MatchStmt, MatchStmtCase, MatchStmtElseCase } from "../../ast/nodes/statements/MatchStmt";
import { NamedDeconstructVarDecl } from "../../ast/nodes/statements/declarations/VarDecl/NamedDeconstructVarDecl";
import { _deriveContractBody } from "./internal/_deriveContractBody/_deriveContractBody";
import { DiagnosticCategory } from "../../diagnostics/DiagnosticCategory";
import { VarStmt } from "../../ast/nodes/statements/VarStmt";
import { _compileSimpleVarDecl } from "./internal/statements/_compileVarStmt";
import { isIdentifier } from "../../utils/text";

export interface AstTypeDefCompilationResult {
    sop: TirType | undefined,
    data: TirType | undefined
    methodsNames: Map<AstFuncName, TirFuncName>
}
/*
Handling type expressions that depend on other types 
(such as generics, function return types, and inferred types from complex expressions)
requires a more structured approach. 

This typically involves a two-pass system:

    1) First Pass (Declaration & Collection): 
        Collect all type information and dependencies.

    2) Second Pass (Resolution & Inference): 
        Resolve dependent types, infer missing types, 
        and enforce type consistency.
*/
 
/**
 * compiles Pebble AST to a Typed IR program (TypedProgram).
 * 
 * AST -> TypedProgram (astCompiler.program)
 * 
 * The AST is simply the result of tokenization and parsing.
 * 
 * Therefore the AST is only syntactically correct, but not necessarily semantically correct.
 * 
 * During the compilation from AST to TIR,
 * missing types are inferred and the resulting TIR is checked for semantic correctness.
 * 
 * In short, here is where type checking happens.
 */
export class AstCompiler extends DiagnosticEmitter
{
    /** 
     * The standard library scope.
     * 
     * (ScriptContext, built-in functions, etc.)
    **/
    get preludeScope(): AstScope
    {
        return this.program.preludeScope;
    }
    readonly program: TypedProgram;
    readonly parsedAstSources: Map<string, Source> = new Map();

    get rootPath(): string
    {
        return this.cfg.root;
    }

    constructor(
        readonly cfg: CompilerOptions,
        readonly io: CompilerIoApi = createMemoryCompilerIoApi({ useConsoleAsOutput: true }),
        diagnostics?: DiagnosticMessage[]
    )
    {
        super( diagnostics );
        this.program = new TypedProgram( this.diagnostics );
        this._isExporting = false;
    }

    private _isExporting: boolean;
    async export( funcName: string, modulePath?: string ): Promise<TypedProgram>
    {
        this._isExporting = true;
        if( typeof funcName !== "string" ) throw new Error("AstCompiler.export: funcName must be a string" );

        funcName = funcName.trim();
        if( funcName === "" || !isIdentifier( funcName ) ) throw new Error("AstCompiler.export: funcName must be a valid function identifier" );

        if( typeof modulePath === "string" ) {
            const nextEntryPath = modulePath;
            if( !nextEntryPath ) throw new Error("AstCompiler.export: modulePath not found: " + modulePath );
            this.cfg.entry = nextEntryPath;
        }

        this.program.contractTirFuncName = funcName;

        return await this.compile();
    }

    /**
     * compiles the entry file specified in the config
     * 
     * the result is store in `this.program`
     */
    async compile(): Promise<TypedProgram>
    {
        const filePath = this.cfg.entry; // getEnvRelativePath( this.cfg.entry, this.rootPath );
        if( !filePath )
        {
            this.error(
                DiagnosticCode.File_0_not_found,
                undefined, this.cfg.entry
            );
            throw new Error("entry file not found");
        }

        if( !this.io.exsistSync( filePath ) )
            throw new Error("AstCompiler.compile: entry file does not exist: " + filePath );

        const entrySrc = await this.compileFile( filePath, true );
        if( this.diagnostics.length > 0 || !entrySrc ) {
            let msg: DiagnosticMessage;
            const fstErrorMsg = this.diagnostics[0].toString();
            const nDiags = this.diagnostics.length;
            while( msg = this.diagnostics.shift()! ) {
                /*
                this.io.stdout.write( msg.toString() + "\n" );
                /*/
                console.log( msg );
                console.log( msg.toString() );
                //*/
            }
            throw new Error("AstCompiler.compile: failed with " + nDiags + " diagnostic messages; first message: " + fstErrorMsg );
        }

        const mainFuncExpr = this.program.functions.get( this.program.contractTirFuncName );
        if( this.program.contractTirFuncName === "" || !mainFuncExpr ) {
            console.log( [...this.program.functions.keys()])
            console.error( mainFuncExpr, `"${this.program.contractTirFuncName}"` );
            this.error(
                DiagnosticCode.Contract_is_missing,
                undefined
            );
            return this.program;
        }

        if( !mainFuncExpr ) this.error(
            DiagnosticCode._0_is_not_defined,
            entrySrc.range.atStart(),
            "main"
        );
        
        return this.program;
    }

    // mutually recursive
    async compileFile( path: string, isEntryFile = false ): Promise<Source | undefined>
    {
        const src = await this.getAbsoulteProjPathSource( path );
        if( !src ) return;

        // parse imports first
        await this.compileAllDeps(
            ResolveStackNode.entry( src ),
            isEntryFile
        );
        
        // if there were errors
        if( this.diagnostics.some( d => d.category === DiagnosticCategory.Error ) ) return;

        await this._compileParsedSource( src, isEntryFile );

        return src;
    }

    private readonly _srcDonelogUids = new Set<string>();
    /**
     * translates the source AST statements
     * to TIR statements; and saves the result in `this.program`
     */
    private async _compileParsedSource( src: Source, isEntryFile = false ): Promise<void>
    {
        if( this._srcDonelogUids.has( src.uid ) ) return;

        // clone array so we don't remove stmts from the original AST
        const stmts = src.statements.slice();

        const importsScope = this.preludeScope.newChildScope({ isFunctionDeclScope: false });

        // defines imported symbols on top level scope, modifies stmts array
        this._consumeImportsAddSymsInScope( stmts, src.absoluteProjPath, importsScope );

        const topLevelScope = importsScope.newChildScope({ isFunctionDeclScope: false });

        const srcExports = this.preludeScope.newChildScope({ isFunctionDeclScope: false });

        // collect top level **type** (struct and aliases) declarations
        this._collectTypeDeclarations(
            stmts,
            src.uid,
            topLevelScope,
            srcExports
        );

        // collect top level **interface** declarations (NOT implementations)
        this._collectInterfaceDeclarations(
            stmts,
            topLevelScope,
            srcExports,
        );

        // collects top level functions, methods (interface impls), and consts types
        this._collectAllTopLevelSignatures(
            stmts,
            src.uid,
            topLevelScope,
            srcExports,
            isEntryFile
        );

        /*
        this._compileTopLevelFunctionsAndConsts(
            stmts,
            src.uid,
            topLevelScope,
            srcExports
        );
        //*/

        this.program.setExportedSymbols(
            src.absoluteProjPath,
            srcExports
        );

        this._srcDonelogUids.add( src.uid );
    }

    private _collectAllTopLevelSignatures(
        stmts: TopLevelStmt[],
        srcUid: string,
        topLevelScope: AstScope,
        srcExports: AstScope,
        isEntryFile: boolean = false
    ): void
    {
        top_level_stmts_iter: for( let i = 0; i < stmts.length; i++ )
        {
            let stmt = stmts[i];

            let exported = false;
            let exportRange: SourceRange | undefined = undefined;
            if( stmt instanceof ExportStmt )
            {
                exported = true;
                exportRange = stmt.range;
                stmt = stmt.stmt;
            }

            if(!(
                stmt instanceof FuncDecl
                || stmt instanceof TypeImplementsStmt
                || stmt instanceof ContractDecl
                || stmt instanceof VarStmt
            )) continue;

            if( stmt instanceof VarStmt )
            {
                const nDecl = stmt.declarations.length;
                for( let dI = 0; dI < nDecl; dI++ )
                {
                    const decl = stmt.declarations[dI] as SimpleVarDecl;
                    if(!(
                        decl.isConst()
                        && decl instanceof SimpleVarDecl
                    )) {
                        this.error(
                            DiagnosticCode.Only_constants_can_be_declared_outside_of_a_function,
                            stmt.range
                        );
                        // remove from array so we don't process it again
                        void stmts.splice( i, 1 );
                        i--;
                        continue top_level_stmts_iter;
                    }

                    this._collectTopLevelConst(
                        decl,
                        srcUid,
                        topLevelScope,
                        srcExports,
                        exportRange,
                        isEntryFile
                    );
                }

                // remove from array so we don't process it again
                void stmts.splice( i, 1 );
                i--;
                continue;
            }

            if( exported && stmt instanceof TypeImplementsStmt )
            this.error(
                DiagnosticCode.Interface_implementations_cannot_be_exported,
                exportRange ?? stmt.range,
            );

            if( stmt instanceof ContractDecl )
            {
                if(!(
                    // ignore contract declarations if not in the entry file
                    isEntryFile
                    // ignore contract decalarations if we are exporting a specific function
                    || this._isExporting
                )) {
                    // remove from array so we don't process it again
                    void stmts.splice( i, 1 );
                    i--;
                    continue;
                }

                const funcDeclContract = this._contractDeclToFuncDecl( stmt );
                if( !funcDeclContract ) {
                    // remove from array so we don't process it again
                    void stmts.splice( i, 1 );
                    i--;
                    continue;
                }

                this._collectTopLevelFuncDeclSig(
                    funcDeclContract,
                    srcUid,
                    topLevelScope,
                    srcExports,
                    exportRange,
                    // set main
                    true // isEntryFile
                );

                // remove from array so we don't process it again
                void stmts.splice( i, 1 );
                i--;
                continue;
            }

            if( stmt instanceof FuncDecl )
            this._collectTopLevelFuncDeclSig(
                stmt,
                srcUid,
                topLevelScope,
                srcExports,
                exportRange,
                // don't set main
                false // isEntryFile
            );
            else
            this._collectInterfaceImplSigs(
                stmt,
                srcUid,
                topLevelScope
            );

            // remove from array so we don't process it again
            void stmts.splice( i, 1 );
            i--;
        }
    }

    private _collectInterfaceImplSigs(
        stmt: TypeImplementsStmt,
        srcUid: string,
        topLevelScope: AstScope
    ): void
    {
        stmt.typeIdentifier;
        stmt.interfaceType;
        stmt.methodImplementations;
        // stmt.range;

        if(
            stmt.typeIdentifier instanceof AstNamedTypeExpr
            && stmt.typeIdentifier.tyArgs.length > 0
        ) return this.error(
            DiagnosticCode.Not_implemented_0,
            stmt.typeIdentifier.range,
            "generic types interface implementations"
        );

        const typeAstName = stmt.typeIdentifier.toAstName();
        const possibleTirTypes = topLevelScope.resolveLocalType( typeAstName );
        if( !possibleTirTypes )
        return this.error(
            DiagnosticCode.Method_implementations_are_only_allowed_for_types_declared_locally,
            stmt.typeIdentifier.range
        );

        const uniqueTypeAstName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + typeAstName + "_" + srcUid;
        const typeMethodsMap = possibleTirTypes.methodsNames;

        for( const method of stmt.methodImplementations )
        {
            if(!( method instanceof InterfaceMethodImpl )) continue;

            if( method.typeParameters.length > 0 )
            {
                this.error(
                    DiagnosticCode.Not_implemented_0,
                    method.methodName.range,
                    "generic methods"
                );
                continue;
            }

            const astMethodName = method.methodName.text;
            const tirMethodName = uniqueTypeAstName + "." + astMethodName;

            if( typeMethodsMap.has( astMethodName ) )
            {
                this.error(
                    DiagnosticCode.Method_0_is_already_implemented,
                    method.methodName.range,
                    astMethodName
                );
                continue;
            }
            typeMethodsMap.set( astMethodName, tirMethodName );

            const completeSig = new AstFuncType([
                    new SimpleVarDecl(
                        new Identifier("this", stmt.typeIdentifier.range),
                        stmt.typeIdentifier,
                        undefined, // initExpr
                        CommonFlags.None,
                        stmt.typeIdentifier.range
                    ),
                    ...method.signature.params
                ],
                method.signature.returnType,
                method.signature.range,
            );
            const astFuncExpr = new FuncExpr(
                method.methodName,
                CommonFlags.None,
                [], // method.typeParameters,
                completeSig,
                method.body,
                ArrowKind.None,
                method.range
            );

            const funcExpr = _compileFuncExpr(
                AstCompilationCtx.fromScope( this.program, topLevelScope ),
                astFuncExpr,
                undefined,
                true, // isMethod
            );
            if( !funcExpr ) return undefined;

            this.program.functions.set(
                tirMethodName,
                funcExpr
            );
        }

    }

    private _collectTopLevelConst(
        decl: SimpleVarDecl,
        srcUid: string,
        topLevelScope: AstScope,
        srcExports: AstScope | undefined = undefined,
        exportRange: SourceRange | undefined = undefined,
        isEntryFile: boolean = false
    ): void
    {
        const astName = decl.name.text;
        // const tirConstName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + astName + "_" + srcUid;
        const declContext = AstCompilationCtx.fromScope( this.program, topLevelScope );

        const tirVarDecl = _compileSimpleVarDecl(
            declContext,
            decl,
            undefined // type hint (extracted from init expr if explicit, or inferred from expression)
        );
        if( !tirVarDecl ) return undefined;
        if( !tirVarDecl.initExpr ) return this.error(
            DiagnosticCode._const_declarations_must_be_initialized,
            tirVarDecl.range,
        );

        if( this.program.constants.has( astName ) ) {
            throw new Error("not_implemented::AstCompiler::_collectTopLevelConst::const_redefinition_check");
        }

        this.program.constants.set(
            astName,
            tirVarDecl
        );
    }

    private _collectTopLevelFuncDeclSig(
        stmt: FuncDecl,
        srcUid: string,
        topLevelScope: AstScope,
        srcExports: AstScope | undefined = undefined,
        exportRange: SourceRange | undefined = undefined,
        isEntryFile: boolean = false
    ): void
    {
        const astFuncExpr = stmt.expr;
        const astFuncName = astFuncExpr.name.text;
        const tirFuncName = PEBBLE_INTERNAL_IDENTIFIER_PREFIX + astFuncName + "_" + srcUid;

        if( this._isExporting && astFuncName === this.program.contractTirFuncName )
        {
            this.program.contractTirFuncName = tirFuncName;
        }
        
        const declContext = AstCompilationCtx.fromScope( this.program, topLevelScope );

        const funcExpr = _compileFuncExpr(
            declContext,
            astFuncExpr,
            undefined, // sig
            false // isMethod
        );
        if( !funcExpr ) return undefined;

        this.program.functions.set(
            tirFuncName,
            funcExpr
        );
        this.program.functions.set(
            astFuncName,
            funcExpr
        );

        if( topLevelScope.functions.has( astFuncName ) )
        return this.error(
            DiagnosticCode._0_is_already_defined,
            astFuncExpr.name.range,
            astFuncName
        );

        topLevelScope.functions.set(
            astFuncName,
            tirFuncName
        );
        topLevelScope.defineValue({
            isConstant: true,
            name: astFuncName,
            type: funcExpr.type,
        });

        if( exportRange && srcExports )
        {
            if(
                srcExports.functions.has( astFuncName )
                || srcExports.variables.has( astFuncName )
            )
            return this.error(
                DiagnosticCode._0_is_already_exported,
                exportRange,
                astFuncName
            );
            else
            {
                srcExports.functions.set(
                    astFuncName,
                    tirFuncName
                );
            }
        }

        if(
            isEntryFile
            && this.program.contractTirFuncName === ""
        ) this.program.contractTirFuncName = tirFuncName;
    }

    private _collectInterfaceDeclarations(
        stmts: TopLevelStmt[],
        topLevelScope: AstScope,
        srcExports: AstScope
    ): void
    {
        for( let i = 0; i < stmts.length; i++ )
        {
            let stmt = stmts[i];
            let exported = false;
            if( stmt instanceof ExportStmt )
            {
                exported = true;
                stmt = stmt.stmt;
            }
            if(!(
                stmt instanceof InterfaceDecl
            )) continue;

            const isGeneric = stmt.typeParams.length > 0;
            if( isGeneric ) throw new Error("not implemented; generic interfaces");

            const methods: Map<string, AstFuncType> = new Map();
            for( const astMethod of stmt.methods ) {
                if( astMethod.body ) this.warning(
                    DiagnosticCode.Default_method_implementatitons_are_not_supported_default_implementation_will_be_ignored,
                    astMethod.body.range
                );
                methods.set( astMethod.name.text, astMethod.signature )
            }

            topLevelScope.interfaces.set( stmt.name.text, methods );

            if( exported ) srcExports.interfaces.set( stmt.name.text, new Map( methods ) );

            // remove from array so we don't process it again
            void stmts.splice( i, 1 );
            i--;
        }
    }

    registerInternalTypeDecl(
        decl: StructDecl | TypeAliasDecl
    ): void
    {
        this._collectTypeDeclarations(
            [ decl ],
            "",
            this.preludeScope,
            this.preludeScope
        );
    }

    private _collectTypeDeclarations(
        stmts: TopLevelStmt[],
        srcUid: string,
        topLevelScope: AstScope,
        srcExports: AstScope
    ): void
    {
        for( let i = 0; i < stmts.length; i++ )
        {
            let stmt = stmts[i];
            let exported = false;
            if( stmt instanceof ExportStmt )
            {
                exported = true;
                stmt = stmt.stmt;
            }
            if(!(
                stmt instanceof StructDecl
                || stmt instanceof TypeAliasDecl
            )) continue;

            const isGeneric = stmt.typeParams.length > 0;

            const tirTypes = stmt instanceof StructDecl
                ? this._compileStructDecl( stmt, srcUid, topLevelScope )
                : this._compileTypeAliasDecl( stmt, srcUid, topLevelScope );

            if(
                !tirTypes // undefined
                || !(tirTypes.sop || tirTypes.data) // or both undefined
            ) continue; // ignore type decl

            // define on program
            if( tirTypes.sop  ) this.program.registerType( tirTypes.sop  );
            if( tirTypes.data ) this.program.registerType( tirTypes.data );

            const sopTirName = tirTypes.sop?.toTirTypeKey() ?? tirTypes.data!.toTirTypeKey();
            const dataTirName = tirTypes.data?.toTirTypeKey();

            const possibleTirTypes: PossibleTirTypes = Object.freeze({
                sopTirName,
                dataTirName,
                allTirNames: new Set([
                    sopTirName,
                    dataTirName,
                ].filter( str => typeof str === "string" )) as Set<string>,
                methodsNames: tirTypes.methodsNames,
                isGeneric,
            } as PossibleTirTypes);

            // define on scope
            void topLevelScope.defineType(
                stmt.name.text,
                possibleTirTypes
            );

            if( exported )
            {
                if( srcExports.types.has( stmt.name.text ) ) this.error(
                    DiagnosticCode._0_is_already_exported,
                    stmt.name.range,
                    stmt.name.text
                );
                else if( isGeneric ) {
                    this.error(
                        DiagnosticCode.Not_implemented_0,
                        stmt.name.range,
                        "typeParams"
                    );
                    continue;
                }
                else {
                    void srcExports.types.set(
                        stmt.name.text,
                        possibleTirTypes
                    );
                }
            }

            // remove from array so we don't process it again
            void stmts.splice( i, 1 );
            i--;
        }
    }

    private _compileStructDecl(
        stmt: StructDecl,
        srcUid: string,
        topLevelScope: AstScope
    ): AstTypeDefCompilationResult | undefined
    {
        if( stmt.typeParams.length > 0 ) throw new Error("not_implemented::AstCompiler::_compileStructDecl::typeParams");
        const compiler = this;

        const methodsNames: Map<AstFuncName, TirFuncName> = new Map();

        let sop: TirSoPStructType | undefined = undefined;
        let data: TirDataStructType | undefined = undefined;

        // sop encoded type
        if( !stmt.hasFlag( StructDeclAstFlags.onlyDataEncoding ) )
        {
            sop = (
                new TirSoPStructType(
                    stmt.name.text,
                    srcUid,
                    stmt.constrs.map( ctor =>
                        new TirStructConstr(
                            ctor.name.text,
                            ctor.fields.map( field => {
                                if( !field.type ) return compiler.error(
                                    DiagnosticCode.Type_expected,
                                    field.name.range.atEnd()
                                );

                                // TODO: recursive struct definitions
                                const fieldType  = _compileSopEncodedConcreteType(
                                    AstCompilationCtx.fromScope( compiler.program, topLevelScope ),
                                    field.type
                                );
                                if( !fieldType ) return undefined

                                return new TirStructField(
                                    field.name.text,
                                    fieldType
                                );
                            })
                            .filter( f => f instanceof TirStructField ) as TirStructField[]
                        )
                    ),
                    methodsNames
                )
            );
        }

        // data encoded type
        if( !stmt.hasFlag( StructDeclAstFlags.onlySopEncoding ) )
        {
            let canEncodeToData = true;
            const dataType = new TirDataStructType(
                stmt.name.text,
                srcUid,
                stmt.constrs.map( ctor =>
                    new TirStructConstr(
                        ctor.name.text,
                        ctor.fields.map( field => {
                            if( !field.type ) return compiler.error(
                                DiagnosticCode.Type_expected,
                                field.name.range.atEnd()
                            );
                            if( !canEncodeToData ) return undefined;

                            // TODO: recursive struct definitions
                            const fieldType  = _compileDataEncodedConcreteType(
                                AstCompilationCtx.fromScope( compiler.program, topLevelScope ),
                                field.type
                            );
                            if( !fieldType ) {
                                canEncodeToData = false;
                                return undefined;
                            }

                            return new TirStructField(
                                field.name.text,
                                fieldType
                            );
                        })
                        .filter( f => f instanceof TirStructField ) as TirStructField[]
                    )
                ),
                methodsNames
            );

            if( canEncodeToData ) data = dataType;
            else if( stmt.hasFlag( StructDeclAstFlags.onlyDataEncoding ) )
                this.error(
                    DiagnosticCode.Type_0_cannot_be_encoded_as_data,
                    stmt.name.range,
                    stmt.name.text
                );
            else
                this.warning(
                    DiagnosticCode.Type_0_cannot_be_encoded_as_data_but_it_has_a_runtime_encoding_Use_runtime_keyword_modifier_for_the_declaration,
                    stmt.range,
                    stmt.name.text
                );
        }

        return (sop || data) ? { sop, data, methodsNames } : undefined;
    }

    private _compileTypeAliasDecl(
        stmt: TypeAliasDecl,
        srcUid: string,
        topLevelScope: AstScope
    ): AstTypeDefCompilationResult | undefined
    {
        if( stmt.typeParams.length > 0 ) throw new Error("not_implemented::AstCompiler::_compileTypeAliasDecl::typeParams");
        const compiler = this;
        const sopAliasedT = _compileSopEncodedConcreteType(
            AstCompilationCtx.fromScope( compiler.program, topLevelScope ),
            stmt.aliasedType
        );
        const dataAliasedT = _compileDataEncodedConcreteType(
            AstCompilationCtx.fromScope( compiler.program, topLevelScope ),
            stmt.aliasedType
        );

        const methodsNames: Map<AstFuncName, TirFuncName> = new Map();

        const sop = sopAliasedT ? new TirAliasType(
            stmt.name.text,
            srcUid,
            sopAliasedT,
            methodsNames // interface implementations
        ) : undefined;
        const data = dataAliasedT ? new TirAliasType(
            stmt.name.text,
            srcUid,
            dataAliasedT,
            methodsNames // interface implementations
        ) : undefined;

        return sop || data ? { sop, data, methodsNames } : undefined;
    }

    private _consumeImportsAddSymsInScope(
        stmts: TopLevelStmt[],
        srcAbsPath: string,
        srcImportsScope: AstScope
    ): void
    {
        for( let i = 0; i < stmts.length; i++ )
        {
            const stmt = stmts[i];
            if( stmt instanceof ImportStarStmt )
            {
                this.error(
                    DiagnosticCode.Not_implemented_0,
                    stmt.range, "import *"
                );
                continue;
            }
            if(!(
                stmt instanceof ImportStmt
            )) continue;

            const importAbsPath = getAbsolutePath( stmt.fromPath.string, srcAbsPath ) ?? "";
            const importedSymbols = this.program.getExportedSymbols( importAbsPath );
            if( !importedSymbols )
            {
                return this.error(
                    DiagnosticCode.File_0_not_found,
                    stmt.fromPath.range,
                    importAbsPath // stmt.fromPath.string
                );
            }

            for( const importDecl of stmt.members )
            {
                const declName = importDecl.identifier.text;
                const isValue = importedSymbols.variables.has( declName );
                const isType = importedSymbols.types.has( declName );
                const isFunction = importedSymbols.functions.has( declName );
                const isInterface = importedSymbols.interfaces.has( declName );

                if(!(
                    isValue
                    || isType
                    || isFunction
                    || isInterface
                )) {
                    this.error(
                        DiagnosticCode.Module_0_has_no_exported_member_1,
                        importDecl.identifier.range,
                        stmt.fromPath.string,
                        declName,
                    );
                    continue;
                }

                // define on source top level scope
                if( isValue ) srcImportsScope.variables.set( declName, importedSymbols.variables.get( declName )! );
                if( isFunction ) srcImportsScope.functions.set( declName, importedSymbols.functions.get( declName )! );
                if( isType ) srcImportsScope.types.set( declName, importedSymbols.types.get( declName )! );
                if( isInterface ) srcImportsScope.interfaces.set( declName, importedSymbols.interfaces.get( declName )! )
            }

            // remove from array so we don't process it again
            void stmts.splice( i, 1 );
            i--;
        }
    }

    private async _readFile( path: string ): Promise<string | undefined>
    {
        path = getEnvRelativePath( path, this.rootPath )!;
        if( typeof path !== "string" ) return undefined;
        return await this.io.readFile( path, this.rootPath );
    }
    /** MUST NOT be used as a "seen" log */
    private readonly _sourceCache = new Map<string, Source>();
    async getAbsoulteProjPathSource(
        absoluteProjPath: string
    ): Promise<Source | undefined>
    {
        const cached = this.parsedAstSources.get( absoluteProjPath ) ?? this._sourceCache.get( absoluteProjPath );
        if( cached ) return cached;

        const srcText = await this._readFile( absoluteProjPath );
        if( !srcText ) return this.error(
            DiagnosticCode.File_0_not_found,
            undefined, absoluteProjPath
        );

        const src = new Source(
            SourceKind.User,
            absoluteProjPath,
            this.program.getFilePrefix( absoluteProjPath ),
            srcText
        );
        this._sourceCache.set( absoluteProjPath, src );
        return src;
    }

    /**
     * @returns `true` if there were no errors. `false` otherwise.
     */
    async compileAllDeps(
        _resolveStackNode: ResolveStackNode,
        isEntryFile: boolean = false
    ): Promise<boolean>
    {
        const src = _resolveStackNode.dependent; // resolveStackNode instanceof ResolveStackNode ? source.dependent : source;
        const resolveStack = _resolveStackNode; // source instanceof ResolveStackNode ? source : new ResolveStackNode( undefined, src );

        const isCycle = resolveStack.parent?.includesInternalPath( src.absoluteProjPath ) ?? false;

        if( isCycle )
        {
            this._reportCircularDependency( src, resolveStack );
            return false;
        }

        // if already parsed
        if( this.parsedAstSources.has( src.absoluteProjPath ) ) return true;

        Parser.parseSource( src, this.diagnostics );
        this.parsedAstSources.set( src.absoluteProjPath, src );

        if( this.diagnostics.length > 0 ) return false;

        // get all imports to parse recursively
        const imports = src.statements.filter( isImportStmtLike );

        const srcPath = resolveStack.dependent.absoluteProjPath;
        const paths = this.importPathsFromStmts( imports, srcPath );
        const importedSources = await Promise.all(
            paths.map( this.getAbsoulteProjPathSource.bind( this ) )
        );
        
        for( const src of importedSources )
        {
            if( !src ) continue; // error already reported in `importPathsFromStmts`

            const nextStack = new ResolveStackNode( resolveStack, src );
            // recursively parse imported files
            if( !await this.compileAllDeps( nextStack ) ) return false;
        }

        this._compileParsedSource( src, isEntryFile );

        return true;
    }

    private importPathsFromStmts(
        stmts: ImportStmtLike[],
        requestingPath: string
    ): string[]
    {
        return stmts
        .map( imp => {
            const absoluteProjPath = getAbsolutePath(
                imp.fromPath.string,
                requestingPath
            );
            if( !absoluteProjPath )
            {
                this.error(
                    DiagnosticCode.File_0_not_found,
                    imp.fromPath.range, imp.fromPath.string
                );
                return "";
            }
            return absoluteProjPath;
        })
        .filter( path => path !== "" );
    }

    private _reportCircularDependency(
        src: Source,
        resolveStack: ResolveStackNode
    ): void
    {
        const offendingPath = src.absoluteProjPath;
        let prevPath = offendingPath;
        let req: ResolveStackNode = resolveStack;
        const pathsInCycle: string[] = [];
        const seen = new Set<string>();

        // we go through the loop so we can signal the error
        // at every offending import
        while( req = req.parent! ) {
            const importStmt = req.dependent.statements.find( stmt => {
                if( !isImportStmtLike( stmt ) ) return false;

                const asRootPath = getAbsolutePath(
                    stmt.fromPath.string,
                    req.dependent.absoluteProjPath
                );
                if( !asRootPath ) return false;

                return asRootPath === prevPath
            }) as ImportStmtLike | undefined;

            prevPath = req.dependent.absoluteProjPath; 
            if( !importStmt )
            {
                this.error(
                    DiagnosticCode.Import_path_0_is_part_of_a_circular_dependency,
                    new SourceRange( req.dependent, 0, 0 ),
                    offendingPath
                );
                continue;
            }
            
            const thePath = importStmt.fromPath.string;
            const last = seen.has( thePath ) 
            
            if( !last )
            {
                pathsInCycle.push( thePath );
                seen.add( thePath );
            }

            pathsInCycle.push( thePath );
            this.error(
                DiagnosticCode.Import_path_0_is_part_of_a_circular_dependency,
                importStmt.range, thePath
            );
            if( last ) break;
        };
    }

    private _contractDeclToFuncDecl(
        contractDecl: ContractDecl
    ): FuncDecl | undefined
    {
        const funcName = getUniqueInternalName( contractDecl.name.text );

        const paramsInternalNamesMap = new Map<string, string>();
        const funcParams: SimpleVarDecl[] = new Array( contractDecl.params.length + 1 );
        
        for( const [i,param] of contractDecl.params.entries() )
        {
            if( !param.type ) {
                this.error(
                    DiagnosticCode.Type_expected,
                    param.name.range.atEnd()
                );
                return undefined;
            }
            const astType = param.type;

            const astName = param.name.text;
            if( paramsInternalNamesMap.has( astName ) ) {
                this.error(
                    DiagnosticCode.Duplicate_identifier_0,
                    param.name.range,
                    param.name.text
                );
                return undefined;
            }

            const internalName = getUniqueInternalName( param.name.text );
            paramsInternalNamesMap.set( astName, internalName );

            funcParams[i] = new SimpleVarDecl(
                new Identifier( internalName, param.name.range ),
                astType,
                undefined, // initExpr
                CommonFlags.Const,
                param.range
            );
        }

        const scriptContextName = getUniqueInternalName("ctx");
        funcParams[ contractDecl.params.length ] = new SimpleVarDecl(
            new Identifier( scriptContextName, contractDecl.name.range ),
            new AstNamedTypeExpr(
                new Identifier( "ScriptContext", contractDecl.name.range ),
                [],
                contractDecl.name.range
            ),
            undefined, // initExpr
            CommonFlags.Const,
            contractDecl.name.range
        );

        const funcSig = new AstFuncType(
            funcParams,
            new AstVoidType( contractDecl.name.range ),
            contractDecl.name.range
        );

        const contractBody = _deriveContractBody(
            this,
            contractDecl,
            paramsInternalNamesMap,
            scriptContextName
        );
        if( !contractBody ) return undefined;

        return new FuncDecl(
            new FuncExpr(
                new Identifier( funcName, contractDecl.name.range ),
                CommonFlags.None,
                [], // typeParameters
                funcSig,
                contractBody,
                ArrowKind.None,
                contractDecl.range
            )
        );
    }
}

type ImportStmtLike = ImportStarStmt | ImportStmt | ExportStarStmt;

function isImportStmtLike( stmt: any ): stmt is ImportStmtLike
{
    return (
        stmt instanceof ImportStmt
        || stmt instanceof ImportStarStmt
        || stmt instanceof ExportStarStmt
    );
}