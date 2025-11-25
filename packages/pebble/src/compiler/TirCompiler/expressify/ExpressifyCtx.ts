import { isObject } from "@harmoniclabs/obj-utils";
import { SourceRange } from "../../../ast/Source/SourceRange";
import { getUniqueInternalName } from "../../internalVar";
import { TirEqualExpr } from "../../tir/expressions/binary/TirBinaryExpr";
import { TirLitIntExpr } from "../../tir/expressions/litteral/TirLitIntExpr";
import { TirCallExpr } from "../../tir/expressions/TirCallExpr";
import { TirElemAccessExpr } from "../../tir/expressions/TirElemAccessExpr";
import { TirExpr } from "../../tir/expressions/TirExpr";
import { TirFromDataExpr } from "../../tir/expressions/TirFromDataExpr";
import { TirHoistedExpr } from "../../tir/expressions/TirHoistedExpr";
import { TirLettedExpr } from "../../tir/expressions/TirLettedExpr";
import { TirNativeFunc } from "../../tir/expressions/TirNativeFunc";
import { data_t, int_t } from "../../tir/program/stdScope/stdScope";
import { TirAssertStmt } from "../../tir/statements/TirAssertStmt";
import { TirArrayLikeDeconstr } from "../../tir/statements/TirVarDecl/TirArrayLikeDeconstr";
import { TirNamedDeconstructVarDecl } from "../../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSimpleVarDecl } from "../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirSingleDeconstructVarDecl } from "../../tir/statements/TirVarDecl/TirSingleDeconstructVarDecl";
import { TirDataStructType } from "../../tir/types/TirStructType";
import { isTirType, TirType } from "../../tir/types/TirType";
import { getListTypeArg } from "../../tir/types/utils/getListTypeArg";
import { toNamedDeconstructVarDecl } from "./toNamedDeconstructVarDecl";
import { TirUnConstrDataResultT } from "../../tir/types/TirNativeType";
import { TirListT } from "../../tir/types/TirNativeType/native/list";
import { TypedProgram } from "../../tir/program/TypedProgram";
import { TirVarDecl } from "../../tir/statements/TirVarDecl/TirVarDecl";

/**
 * Static Single Assignment (SSA) variable name.
 * 
 * while expressifying, we convert mutable variables to constants,
 * where the latest shadows the previous ones.
 * 
 * each new constant introduced is given a new name, added to the context map, pointing to the same `LatestVarNameSSA`.
 * any following variable access that refers to the same variable, will be replaced to the latest name.
 */
export interface LatestVarNameSSA {
    latestName: string;
}

export interface ExpressifyFuncParam {
    name: string;
    type: TirType;
}

export function isExpressifyFuncParam( thing: any ): thing is ExpressifyFuncParam
{
    return isObject( thing ) && (
        typeof thing.name === "string"
        && isTirType( thing.type )
    );
}

export class ExpressifyCtx
{
    readonly hoisted: Map<string, TirHoistedExpr | TirNativeFunc>;

    constructor(
        readonly parent: ExpressifyCtx | undefined,
        public returnType: TirType,
        readonly program: TypedProgram,
        hoisted?: Map<string, TirHoistedExpr | TirNativeFunc>,
        /** var name -> latest constant name */
        private readonly variables: Map<string, LatestVarNameSSA> = new Map(),
        /** constant name -> func param name (to build var access) */
        readonly funcParams: Map<string, ExpressifyFuncParam> = new Map(),
        /** constant name -> letted expr */
        private readonly lettedConstants: Map<string, TirLettedExpr> = new Map(),
        /** var name -> prop name -> constant name (letted field extraction expr or var access for SoP)*/
        readonly properties: Map<string, Map<string, string>> = new Map(),
    ) {
        this.hoisted = (
            hoisted
            ?? this.parent?.hoisted
            ?? new Map<string, TirHoistedExpr>(
                [ ...program.constants.entries() ]
                .map(([ name, decl ]) => {
                    if( !decl.initExpr ) throw new Error(`expected init expr in hoisted constant '${name}'`);
                    const expr = decl.initExpr instanceof TirHoistedExpr ? decl.initExpr : new TirHoistedExpr( name, decl.initExpr );
                    return [ name, expr ];
                })
                .concat(
                    [ ...program.functions.entries() ].map( ([ name, func ]) => {
                        return [ name, new TirHoistedExpr( name, func ) ];
                    }) as [string, TirHoistedExpr][]
                ) as [string, TirHoistedExpr][]
            )
        );
    }

    allVariablesNoLetted(): string[]
    {
        return (
            this.parent?.allVariablesNoLetted() ?? []
        ).concat( ...this.variables.keys() );
    }
    allVariables(): string[]
    {
        const thisVars = new Set([
            ...this.variables.keys(),
            ...this.lettedConstants.keys(),
            ...this.hoisted.keys(),
        ]);
        return (this.parent?.allVariables() ?? []).concat( ...thisVars )
    }

    newChild(): ExpressifyCtx
    {
        return new ExpressifyCtx( this, this.returnType, this.program );
    }

    setNewVariableName(
        oldName: string,
        newName: string
    ): void
    {
        let latestNameSSA = this.variables.get( oldName );
        if( !latestNameSSA ) this.variables.set( oldName, { latestName: newName } );
        else {
            const prevName = latestNameSSA.latestName;
            if( prevName === newName ) return; // no change
            latestNameSSA.latestName = newName;
            this.setNewVariableName( prevName, newName );
            this.setNewVariableName( newName, newName );
        }
    }

    setFuncParam(
        name: string,
        type: TirType
    ): void
    {
        this.setNewVariableName( name, name );
        this.funcParams.set( name, { name, type } );
    }

    /**
     * `undefined` means the variable is not in the local context.
     */
    getLocalVariable( name: string ): TirLettedExpr | ExpressifyFuncParam | undefined
    {
        // declared as variable or param
        const latestConstName = this.variables.get( name )?.latestName;
        // no such variable (mutable at least)
        if( !latestConstName ) {
            // try to get var declared as constant
            // return undefined if not present
            return this.lettedConstants.get( name );
        };

        return (
            this.lettedConstants.get( latestConstName )
            ?? this.funcParams.get( latestConstName )
        );
    }

    /**
     * 
     * `undefined` means the variable is not in the function context.
     * 
     * so it is assumed to be an external (hoisted) variable.
     */
    private _getNonHoistedVariable( name: string ): TirLettedExpr | ExpressifyFuncParam | undefined
    {
        return (
            this.getLocalVariable( name )
            ?? this.parent?._getNonHoistedVariable( name )
        );
    }

    getVariable(
        name: string
    ): ExpressifyFuncParam | TirHoistedExpr | TirNativeFunc | TirLettedExpr
    {
        const result = (
            this._getNonHoistedVariable( name )
            ?? this.hoisted.get( name )
        );
        if( !result ) {
            console.log( "[error log]: allVariables", this.allVariables(), "; get:", name );
            throw new Error(`variable '${name}' not found in the context`);
        }
        return result;
    }

    getVariableSSA( name : string ): LatestVarNameSSA | undefined
    {
        return (
            this.variables.get( name )
            ?? this.parent?.getVariableSSA( name )
        );
    }

    introduceFuncParams(
        params: readonly TirSimpleVarDecl[]
    ): void
    {
        for( const param of params ) {
            param.isConst = true;
            this.setFuncParam( param.name, param.type );
        }
    }

    introduceLettedConstant(
        name: string,
        lettedExpr: TirExpr,
        declRange: SourceRange
    ): TirLettedExpr
    {
        // if( this.lettedConstants.has( name ) ) throw new Error(`constant '${name}' already introduced in the context`);
        const existing = this.lettedConstants.get( name );
        if( existing ) return existing.clone() as TirLettedExpr;
        const result = new TirLettedExpr(
            name,
            lettedExpr,
            declRange
        );
        this.lettedConstants.set(
            name,
            result
        );
        return result.clone() as TirLettedExpr;
    }

    introduceSopConstrFieldsAsProperties(
        sopName: string,
        destructuredPattern: TirNamedDeconstructVarDecl,
    ): void
    {
        const fieldsMap: Map<string, string> = new Map();
        for( const [ fName, varDecl ] of destructuredPattern.fields )
        {
            if(!( varDecl instanceof TirSimpleVarDecl ))
            throw new Error("expected simple var decl in single constr field extraction");

            this.setFuncParam(
                varDecl.name,
                varDecl.type
            );
            fieldsMap.set(
                fName,
                varDecl.name
            );
        }
        this.properties.set(
            sopName,
            fieldsMap
        );
    }

    introduceSopConstrFieldsAsParamsOnly(
        destructuredPattern: TirNamedDeconstructVarDecl
    ): void
    {
        for( const [ fName, varDecl ] of destructuredPattern.fields )
        {
            if(!( varDecl instanceof TirSimpleVarDecl ))
            throw new Error("expected simple var decl in single constr field extraction");

            this.setFuncParam(
                varDecl.name,
                varDecl.type
            );
        }
    }

    introduceSingleConstrDataLettedFields(
        varName: string,
        structExpr: TirExpr,
        structType: TirDataStructType
    ): void
    {
        const constr = structType.constructors[0];
        if( constr.fields.length === 0 ) return; // no fields to extract

        const lettedRawFieldsName = getUniqueInternalName(`${varName}_fields`);
        const lettedFields = this.introduceLettedConstant(
            lettedRawFieldsName,
            new TirLettedExpr(
                lettedRawFieldsName,
                new TirCallExpr(
                    TirNativeFunc.unConstrDataResultFields,
                    [new TirCallExpr(
                        TirNativeFunc.unConstrData,
                        [ structExpr ],
                        new TirUnConstrDataResultT(),
                        structExpr.range
                    )],
                    new TirListT( data_t ),
                    structExpr.range,
                ),
                structExpr.range
            ),
            structExpr.range
        );

        const fieldsMap: Map<string, string> = new Map();
        for( let i = 0; i < constr.fields.length; i++ )
        {
            const field = constr.fields[i];
            const fieldName = field.name;
            const fieldVarName = getUniqueInternalName(`${varName}_${fieldName}`);
            const fieldType = field.type;

            const lettedField = this.introduceLettedConstant(
                fieldVarName,
                // FieldType.fromData( lettedFields[i] )
                new TirFromDataExpr(
                    new TirElemAccessExpr(
                        lettedFields,
                        new TirLitIntExpr(
                            BigInt(i),
                            structExpr.range
                        ),
                        data_t,
                        structExpr.range
                    ),
                    fieldType,
                    structExpr.range
                ),
                structExpr.range,
            );

            fieldsMap.set(
                fieldName,
                fieldVarName
            );

            // data structs cannot have sop-encoded fields (thanks god)
            // recursively introduce letted fields for nested single-constructor data structs
            if(
                fieldType instanceof TirDataStructType
                && fieldType.constructors.length === 1
            )
            {
                this.introduceSingleConstrDataLettedFields(
                    fieldVarName,
                    lettedField,
                    fieldType
                );
            }
        }

        this.properties.set(
            varName,
            fieldsMap
        );
    }

    introduceDeconstrDataLettedFields(
        stmt: TirNamedDeconstructVarDecl,
        lettedInitExpr: TirLettedExpr
    ): {
        implicitAssertions: TirAssertStmt[],
        nestedDeconstructs: TirVarDecl[]
    } {
        const structType = stmt.type;
        if(!( stmt.initExpr )) throw new Error("expected init expr in deconstruct data statement");
        if(!( structType instanceof TirDataStructType )) throw new Error("expected data struct type in deconstruct data statement");

        const varName = lettedInitExpr.varName ?? getUniqueInternalName( structType.toString().toLowerCase() );

        const constrName = stmt.constrName;
        const constrIdx = structType.constructors.findIndex( c => c.name === constrName );
        if( constrIdx < 0 ) throw new Error(`constructor ${constrName} not found in data struct ${structType.name}`);

        const constr = structType.constructors[constrIdx];
        if( constr.fields.length === 0 ) return { implicitAssertions: [], nestedDeconstructs: [] }; // no fields to extract, no assertions

        const structExpr = lettedInitExpr ?? stmt.initExpr;

        const lettedUnconstrName = getUniqueInternalName(`${varName}_unconstrPair`);
        const lettedUnconstr = this.introduceLettedConstant(
            lettedUnconstrName,
            new TirCallExpr(
                TirNativeFunc.unConstrData,
                [ structExpr ],
                new TirUnConstrDataResultT(),
                stmt.range
            ),
            stmt.range
        );

        const assertions: TirAssertStmt[] = [];
        const nestedDeconstructs: TirVarDecl[] = [];

        if( structType.constructors.length > 1 )
        assertions.push( 
            new TirAssertStmt(
                new TirEqualExpr(
                    new TirCallExpr(
                        TirNativeFunc.unConstrDataResultIndex,
                        [ lettedUnconstr ],
                        int_t,
                        stmt.range
                    ),
                    new TirLitIntExpr(
                        BigInt(constrIdx),
                        stmt.range
                    ),
                    stmt.range
                ),
                undefined, // no trace message
                stmt.range
            )
        );

        const lettedRawFieldsName = getUniqueInternalName(`${varName}_fields`);
        const lettedFields = this.introduceLettedConstant(
            lettedRawFieldsName,
            new TirCallExpr(
                TirNativeFunc.unConstrDataResultFields,
                [ lettedUnconstr ],
                new TirListT( data_t ),
                stmt.range
            ),
            stmt.range
        );

        const fieldsToIntroduce: string[] = [ ...stmt.fields.keys() ]
        const hasRest = typeof stmt.rest === "string";

        const fieldsMap: Map<string, string> = new Map();
        for( let i = 0; i < constr.fields.length; i++ )
        {
            const field = constr.fields[i];
            const fieldName = field.name;
            let fieldType = field.type;

            const isFieldToIntroduce = fieldsToIntroduce.includes( fieldName )
            if( !hasRest && !isFieldToIntroduce ) continue; // skip unused field

            const fieldVarDecl = stmt.fields.get( fieldName );

            const fieldVarName = getUniqueInternalName(`${varName}_${fieldName}`);
            
            const lettedField = this.introduceLettedConstant(
                fieldVarName,
                // FieldType.fromData( lettedFields[i] )
                new TirFromDataExpr(
                    new TirElemAccessExpr(
                        lettedFields,
                        new TirLitIntExpr(
                            BigInt(i),
                            structExpr.range
                        ),
                        data_t,
                        structExpr.range
                    ),
                    fieldType,
                    structExpr.range
                ),
                structExpr.range,
            );

            if( hasRest )
            fieldsMap.set(
                fieldName,
                fieldVarName
            );

            if( !isFieldToIntroduce ) {
                continue; // we only needed to add it as "rest"
            }
            if( !fieldVarDecl )
            throw new Error(`field '${fieldName}' not found in deconstruct data statement`);
 
            if( fieldVarDecl instanceof TirSimpleVarDecl )
            {
                this.setNewVariableName(
                    fieldVarDecl.name,
                    lettedField.varName
                );
            }
            else {
                // fieldVarDecl.type ??= fieldType;
                fieldVarDecl.initExpr = lettedField;
                nestedDeconstructs.push( fieldVarDecl );
            }
        }

        if( hasRest )
        this.properties.set(
            stmt.rest,
            fieldsMap
        );

        return {
            implicitAssertions: assertions,
            nestedDeconstructs
        };
    }

    introduceArrayDeconstr(
        stmt: TirArrayLikeDeconstr,
        isDestructuredField: boolean = false
    ): {
        implicitAssertions: TirAssertStmt[],
        nestedDeconstructs: TirVarDecl[]
    }
    {
        if(!( stmt.initExpr )) throw new Error("expected init expr in array-like deconstruct statement");

        const elemsType = getListTypeArg( stmt.type );
        if( !elemsType )
        throw new Error("expected list type in array-like deconstruct statement");

        let lettedArrayExpr: TirLettedExpr;
        if( stmt.initExpr instanceof TirLettedExpr )
        {
            lettedArrayExpr = stmt.initExpr;
        }
        else
        {
            const lettedArrayName = getUniqueInternalName( stmt.type.toString().toLowerCase() );
            lettedArrayExpr = this.introduceLettedConstant(
                lettedArrayName,
                stmt.initExpr,
                stmt.range
            );
        }

        const assertions: TirAssertStmt[] = [];
        const nestedDeconstructs: TirVarDecl[] = [];

        const nElems = stmt.elements.length;
        for( let i = 0; i < nElems; i++ )
        {
            const elemVarDecl = stmt.elements[i];

            const lettedElemName = getUniqueInternalName(`${lettedArrayExpr.varName}_elem_${i}`);
            let lettedExpr: TirExpr = new TirElemAccessExpr(
                lettedArrayExpr,
                new TirLitIntExpr(
                    BigInt(i),
                    elemVarDecl.range
                ),
                isDestructuredField ? data_t : elemVarDecl.type,
                elemVarDecl.range
            );
            if( isDestructuredField )
            lettedExpr = new TirFromDataExpr(
                lettedExpr,
                elemVarDecl.type,
                elemVarDecl.range
            );
            const lettedElem = this.introduceLettedConstant(
                lettedElemName,
                lettedExpr,
                elemVarDecl.range
            );

            if( elemVarDecl instanceof TirSimpleVarDecl )
            {
                this.setNewVariableName(
                    elemVarDecl.name,
                    lettedElem.varName
                );

                if(
                    lettedElem.type instanceof TirDataStructType
                    && lettedElem.type.constructors.length === 1
                ) 
                {
                    // if the element is a single-constructor data struct,
                    // we need to introduce its fields as well
                    this.introduceSingleConstrDataLettedFields(
                        elemVarDecl.name,
                        lettedElem,
                        lettedElem.type
                    );
                }
            }
            else if(
                elemVarDecl instanceof TirNamedDeconstructVarDecl
                || elemVarDecl instanceof TirSingleDeconstructVarDecl
            )
            {
                const namedVarDecl = toNamedDeconstructVarDecl( elemVarDecl );
                namedVarDecl.initExpr = lettedElem;
                const introduceFieldsResult = this.introduceDeconstrDataLettedFields(
                    namedVarDecl,
                    lettedElem
                )
                assertions.push( ...introduceFieldsResult.implicitAssertions );
                nestedDeconstructs.push( ...introduceFieldsResult.nestedDeconstructs );
            }
            else if( elemVarDecl instanceof TirArrayLikeDeconstr )
            {
                elemVarDecl.initExpr = lettedElem;
                const introduceFieldsResult = this.introduceArrayDeconstr(
                    elemVarDecl,
                    true // is destructured field
                );
                assertions.push( ...introduceFieldsResult.implicitAssertions );
                nestedDeconstructs.push( ...introduceFieldsResult.nestedDeconstructs );
            }
        }

        if( stmt.rest )
        {
            if( isDestructuredField )
            throw new Error(
                "rest is not implemented in destructured field array-like deconstruct. TODO: map data elems to elem type"
            );


            const lettedRest = this.introduceLettedConstant(
                stmt.rest,
                new TirCallExpr(
                    TirNativeFunc._dropList( elemsType ),
                    [
                        new TirLitIntExpr(
                            BigInt(nElems),
                            stmt.range
                        ),
                        lettedArrayExpr
                    ],
                    new TirListT( elemsType ),
                    stmt.range
                ),
                stmt.range
            );
        }

        return {
            implicitAssertions: assertions,
            nestedDeconstructs
        };
    }
}