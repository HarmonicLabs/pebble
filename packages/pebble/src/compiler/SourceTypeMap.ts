import { SourceRange } from "../ast/Source/SourceRange";
import { DiagnosticMessage } from "../diagnostics/DiagnosticMessage";
import { isInternalName } from "./internalVar";
import { TirAliasType } from "./tir/types/TirAliasType";
import { TirType } from "./tir/types/TirType";
import { isTirStructType, TirStructType, TirStructField } from "./tir/types/TirStructType";
import { TirFuncT } from "./tir/types/TirNativeType/native/function";
import { TirListT } from "./tir/types/TirNativeType/native/list";
import { TirLinearMapT } from "./tir/types/TirNativeType/native/linearMap";
import { TirLinearMapEntryT } from "./tir/types/TirNativeType/native/linearMapEntry";
import { TirBytesT } from "./tir/types/TirNativeType/native/bytes";
import { TirStringT } from "./tir/types/TirNativeType/native/string";
import { TirBoolT } from "./tir/types/TirNativeType/native/bool";
import { TirIntT } from "./tir/types/TirNativeType/native/int";
import { TirDataT } from "./tir/types/TirNativeType/native/data";
import { TirVoidT } from "./tir/types/TirNativeType/native/void";
import { TirSopOptT } from "./tir/types/TirNativeType/native/Optional/sop";
import { int_t, bool_t, bytes_t, string_t } from "./tir/program/stdScope/stdScope";
import { TypedProgram } from "./tir/program/TypedProgram";
import { TirFuncExpr } from "./tir/expressions/TirFuncExpr";
import { TirInlineClosedIR } from "./tir/expressions/TirInlineClosedIR";
import { TirExpr } from "./tir/expressions/TirExpr";
import { TirStmt } from "./tir/statements/TirStmt";
import { TirBlockStmt } from "./tir/statements/TirBlockStmt";
import { TirIfStmt } from "./tir/statements/TirIfStmt";
import { TirReturnStmt } from "./tir/statements/TirReturnStmt";
import { TirAssertStmt } from "./tir/statements/TirAssertStmt";
import { TirForStmt } from "./tir/statements/TirForStmt";
import { TirForOfStmt } from "./tir/statements/TirForOfStmt";
import { TirWhileStmt } from "./tir/statements/TirWhileStmt";
import { TirMatchStmt } from "./tir/statements/TirMatchStmt";
import { TirAssignmentStmt } from "./tir/statements/TirAssignmentStmt";
import { TirTraceStmt } from "./tir/statements/TirTraceStmt";
import { TirSimpleVarDecl } from "./tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirNamedDeconstructVarDecl } from "./tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSingleDeconstructVarDecl } from "./tir/statements/TirVarDecl/TirSingleDeconstructVarDecl";
import { TirArrayLikeDeconstr } from "./tir/statements/TirVarDecl/TirArrayLikeDeconstr";
import { TirCallExpr } from "./tir/expressions/TirCallExpr";
import { TirPropAccessExpr } from "./tir/expressions/TirPropAccessExpr";
import { TirVariableAccessExpr } from "./tir/expressions/TirVariableAccessExpr";
import { TirCaseExpr } from "./tir/expressions/TirCaseExpr";
import { TirElemAccessExpr } from "./tir/expressions/TirElemAccessExpr";
import { TirTernaryExpr } from "./tir/expressions/TirTernaryExpr";
import { TirParentesizedExpr } from "./tir/expressions/TirParentesizedExpr";
import { TirTypeConversionExpr } from "./tir/expressions/TirTypeConversionExpr";
import { TirLettedExpr } from "./tir/expressions/TirLettedExpr";
import { TirHoistedExpr } from "./tir/expressions/TirHoistedExpr";
import { TirFromDataExpr } from "./tir/expressions/TirFromDataExpr";
import { TirToDataExpr } from "./tir/expressions/TirToDataExpr";
import { TirAssertAndContinueExpr } from "./tir/expressions/TirAssertAndContinueExpr";
import { TirTraceIfFalseExpr } from "./tir/expressions/TirTraceIfFalseExpr";
import { TirTraceExpr } from "./tir/expressions/TirTraceExpr";
import { isTirBinaryExpr } from "./tir/expressions/binary/TirBinaryExpr";
import { isTirUnaryPrefixExpr } from "./tir/expressions/unary/TirUnaryPrefixExpr";
import { isTirLitteralExpr } from "./tir/expressions/litteral/TirLitteralExpr";
import { TirTypeParam } from "./tir/types/TirTypeParam";
import { isTirOptType } from "./tir/types/TirNativeType/native/Optional/isTirOptType";

export interface TypeEntry {
    start: number;
    end: number;
    type: TirType;
    name?: string;
    /** "type-reference" marks constructor/type names; default is "expression" */
    kind?: "expression" | "type-reference";
}

export interface MemberInfo {
    name: string;
    type: TirType;
    kind: "field" | "method";
}

export interface CheckResult {
    diagnostics: DiagnosticMessage[];
    program: TypedProgram;
    sourceTypeMap: SourceTypeMap;
}

export class SourceTypeMap
{
    private entries: TypeEntry[] = [];
    private sorted = false;

    constructor(
        readonly program: TypedProgram
    ) {}

    buildFromProgram(): void
    {
        this.entries = [];
        for( const [name, func] of this.program.functions )
        {
            if( func instanceof TirFuncExpr )
            {
                this.walkFuncExpr( func );
            }
        }
        for( const [name, cnst] of this.program.constants )
        {
            this.walkVarDecl( cnst );
        }
        this.sorted = false;
    }

    private addEntry( start: number, end: number, type: TirType, name?: string, kind?: "expression" | "type-reference" ): void
    {
        if( start >= 0 && end > start )
        {
            this.entries.push({ start, end, type, name, kind });
        }
    }

    private ensureSorted(): void
    {
        if( !this.sorted )
        {
            // sort by start ascending, then by range size ascending (smallest/most specific first for ties)
            this.entries.sort(( a, b ) => a.start - b.start || (a.end - a.start) - (b.end - b.start) );
            this.sorted = true;
        }
    }

    typeAtOffset( offset: number ): TypeEntry | undefined
    {
        this.ensureSorted();
        // find the most specific (smallest range) entry containing the offset
        let best: TypeEntry | undefined = undefined;
        for( const entry of this.entries )
        {
            if( entry.start > offset ) break; // sorted by start, so no more matches
            if( offset >= entry.start && offset < entry.end )
            {
                if( !best || (entry.end - entry.start) < (best.end - best.start) )
                {
                    best = entry;
                }
            }
        }
        return best;
    }

    allEntries(): readonly TypeEntry[]
    {
        this.ensureSorted();
        return this.entries;
    }

    membersOfType( type: TirType ): MemberInfo[]
    {
        // unwrap aliases
        while( type instanceof TirAliasType )
        {
            const aliasMembers = this.methodsFromMap( type.methodsNamesPtr );
            if( aliasMembers.length > 0 )
            {
                // get fields from aliased + methods from alias
                const innerMembers = this.membersOfType( type.aliased );
                const fieldMembers = innerMembers.filter( m => m.kind === "field" );
                return [ ...fieldMembers, ...aliasMembers ];
            }
            type = type.aliased;
        }

        if( type instanceof TirTypeParam ) return [];

        if( isTirStructType( type ) ) return this.structMembers( type );
        if( type instanceof TirVoidT ) return [];
        if( type instanceof TirBoolT ) return [];
        if( type instanceof TirIntT ) return [];
        if( type instanceof TirBytesT ) return this.bytesMembers();
        if( type instanceof TirStringT ) return this.stringMembers();
        if( type instanceof TirDataT ) return [];
        if( isTirOptType( type ) ) return [];
        if( type instanceof TirFuncT ) return [];
        if( type instanceof TirListT ) return this.listMembers( type.typeArg );
        if( type instanceof TirLinearMapEntryT ) return this.linearMapEntryMembers( type );
        if( type instanceof TirLinearMapT ) return this.linearMapMembers( type.keyTypeArg, type.valTypeArg );

        return [];
    }

    private structMembers( type: TirStructType ): MemberInfo[]
    {
        const result: MemberInfo[] = [];

        // single-constructor structs expose fields directly
        if( type.constructors.length === 1 )
        {
            const constr = type.constructors[0];
            for( const field of constr.fields )
            {
                result.push({ name: field.name, type: field.type, kind: "field" });
            }
        }

        // constructor accessor methods for multi-constructor structs
        // e.g. ExtendedInteger.finite() returns int
        if( type.constructors.length > 1 )
        {
            for( const ctor of type.constructors )
            {
                if( ctor.fields.length === 1 )
                {
                    result.push({
                        name: ctor.name.toLowerCase(),
                        type: new TirFuncT([], ctor.fields[0].type),
                        kind: "method"
                    });
                }
            }
        }

        // methods
        result.push( ...this.methodsFromMap( type.methodNamesPtr ) );
        return result;
    }

    private methodsFromMap( methodsPtr: Map<string, string> ): MemberInfo[]
    {
        const result: MemberInfo[] = [];
        for( const [astName, tirName] of methodsPtr )
        {
            const funcExpr = this.program.functions.get( tirName );
            if( !funcExpr ) continue;
            const fullSig = funcExpr.sig();
            // method sig: drop first arg (self)
            const methodSig = new TirFuncT(
                fullSig.argTypes.slice( 1 ),
                fullSig.returnType
            );
            result.push({ name: astName, type: methodSig, kind: "method" });
        }
        return result;
    }

    private listMembers( elemType: TirType ): MemberInfo[]
    {
        const mapReturnT = new TirTypeParam("T");
        return [
            { name: "length",  type: new TirFuncT( [], int_t ),  kind: "method" },
            { name: "isEmpty", type: new TirFuncT( [], bool_t ), kind: "method" },
            { name: "show",    type: new TirFuncT( [], bytes_t ), kind: "method" },
            { name: "head",    type: new TirFuncT( [], elemType ), kind: "method" },
            { name: "tail",    type: new TirFuncT( [], new TirListT( elemType ) ), kind: "method" },
            { name: "reverse", type: new TirFuncT( [], new TirListT( elemType ) ), kind: "method" },
            { name: "find",    type: new TirFuncT([ new TirFuncT([elemType], bool_t) ], new TirSopOptT(elemType)), kind: "method" },
            { name: "filter",  type: new TirFuncT([ new TirFuncT([elemType], bool_t) ], new TirListT(elemType)), kind: "method" },
            { name: "prepend", type: new TirFuncT([ elemType ], new TirListT(elemType)), kind: "method" },
            { name: "map",     type: new TirFuncT([ new TirFuncT([elemType], mapReturnT) ], new TirListT(mapReturnT)), kind: "method" },
            { name: "every",   type: new TirFuncT([ new TirFuncT([elemType], bool_t) ], bool_t), kind: "method" },
            { name: "some",    type: new TirFuncT([ new TirFuncT([elemType], bool_t) ], bool_t), kind: "method" },
            { name: "includes", type: new TirFuncT([ elemType ], bool_t), kind: "method" },
        ];
    }

    private bytesMembers(): MemberInfo[]
    {
        return [
            { name: "length",       type: new TirFuncT([], int_t), kind: "method" },
            { name: "subByteString", type: new TirFuncT([int_t, int_t], bytes_t), kind: "method" },
            { name: "slice",        type: new TirFuncT([int_t, int_t], bytes_t), kind: "method" },
            { name: "show",         type: new TirFuncT([], bytes_t), kind: "method" },
            { name: "decodeUtf8",   type: new TirFuncT([], string_t), kind: "method" },
            { name: "prepend",      type: new TirFuncT([int_t], bytes_t), kind: "method" },
        ];
    }

    private stringMembers(): MemberInfo[]
    {
        return [
            ...this.bytesMembers(),
            { name: "encodeUtf8", type: new TirFuncT([], bytes_t), kind: "method" },
        ];
    }

    private linearMapEntryMembers( type: TirLinearMapEntryT ): MemberInfo[]
    {
        return [
            { name: "key",   type: type.keyTypeArg, kind: "field" },
            { name: "value", type: type.valTypeArg, kind: "field" },
        ];
    }

    private linearMapMembers( kT: TirType, vT: TirType ): MemberInfo[]
    {
        const entryType = new TirLinearMapEntryT( kT, vT );
        const mapType = new TirLinearMapT( kT, vT );
        const mapReturnT = new TirTypeParam("T");
        return [
            { name: "length",   type: new TirFuncT( [], int_t ), kind: "method" },
            { name: "isEmpty",  type: new TirFuncT( [], bool_t ), kind: "method" },
            { name: "show",     type: new TirFuncT( [], bytes_t ), kind: "method" },
            { name: "head",     type: new TirFuncT( [], entryType ), kind: "method" },
            { name: "tail",     type: new TirFuncT( [], mapType ), kind: "method" },
            { name: "reverse",  type: new TirFuncT( [], mapType ), kind: "method" },
            { name: "find",     type: new TirFuncT( [ new TirFuncT([entryType], bool_t) ], new TirSopOptT(entryType) ), kind: "method" },
            { name: "filter",   type: new TirFuncT( [ new TirFuncT([entryType], bool_t) ], mapType ), kind: "method" },
            { name: "prepend",  type: new TirFuncT( [ kT, vT ], mapType ), kind: "method" },
            { name: "map",      type: new TirFuncT( [ new TirFuncT([entryType], mapReturnT) ], new TirListT(mapReturnT) ), kind: "method" },
            { name: "every",    type: new TirFuncT( [ new TirFuncT([entryType], bool_t) ], bool_t ), kind: "method" },
            { name: "some",     type: new TirFuncT( [ new TirFuncT([entryType], bool_t) ], bool_t ), kind: "method" },
            { name: "includes", type: new TirFuncT( [ entryType ], bool_t ), kind: "method" },
            { name: "lookup",   type: new TirFuncT( [ kT ], new TirSopOptT(vT) ), kind: "method" },
        ];
    }

    // --- TIR tree walkers ---

    private walkFuncExpr( func: TirFuncExpr ): void
    {
        // skip top-level entry for internal/compiler-generated functions
        // (names starting with § or other internal prefixes)
        // their range covers the whole contract body and pollutes typeAtOffset
        if( !func.name || !func.name.startsWith("§") )
        {
            this.addEntry( func.range.start, func.range.end, func.type, func.name );
        }
        for( const param of func.params )
        {
            this.walkVarDecl( param );
        }
        this.walkStmt( func.body );
    }

    private walkExpr( expr: TirExpr ): void
    {
        if( !expr ) return;

        // all expressions have range and type
        try {
            this.addEntry( expr.range.start, expr.range.end, expr.type );
        } catch {}

        // recurse into sub-expressions
        if( expr instanceof TirCallExpr )
        {
            this.walkExpr( expr.func );
            for( const arg of expr.args ) this.walkExpr( arg );
        }
        else if( expr instanceof TirPropAccessExpr )
        {
            this.walkExpr( expr.object );
        }
        else if( expr instanceof TirVariableAccessExpr )
        {
            // leaf — name is the variable name
            this.addEntry( expr.range.start, expr.range.end, expr.type, expr.resolvedValue.variableInfos.name );
        }
        else if( expr instanceof TirFuncExpr )
        {
            this.walkFuncExpr( expr );
        }
        else if( expr instanceof TirCaseExpr )
        {
            this.walkExpr( expr.matchExpr );
            for( const c of expr.cases )
            {
                if( c.pattern ) this.walkVarDecl( c.pattern );
                this.walkExpr( c.body );
            }
            if( expr.wildcardCase )
            {
                this.walkExpr( expr.wildcardCase.body );
            }
        }
        else if( expr instanceof TirElemAccessExpr )
        {
            this.walkExpr( expr.arrLikeExpr );
            this.walkExpr( expr.indexExpr );
        }
        else if( expr instanceof TirTernaryExpr )
        {
            this.walkExpr( expr.condition );
            this.walkExpr( expr.ifTrue );
            this.walkExpr( expr.ifFalse );
        }
        else if( expr instanceof TirParentesizedExpr )
        {
            this.walkExpr( expr.expr );
        }
        else if( expr instanceof TirTypeConversionExpr )
        {
            this.walkExpr( expr.expr );
        }
        else if( expr instanceof TirLettedExpr )
        {
            this.walkExpr( expr.expr );
        }
        else if( expr instanceof TirHoistedExpr )
        {
            this.walkExpr( expr.expr );
        }
        else if( expr instanceof TirFromDataExpr )
        {
            this.walkExpr( (expr as any).expr );
        }
        else if( expr instanceof TirToDataExpr )
        {
            this.walkExpr( (expr as any).expr );
        }
        else if( expr instanceof TirAssertAndContinueExpr )
        {
            this.walkExpr( (expr as any).condition );
            this.walkExpr( (expr as any).continuation );
        }
        else if( expr instanceof TirTraceIfFalseExpr )
        {
            this.walkExpr( (expr as any).condition );
            this.walkExpr( (expr as any).traceMsg );
        }
        else if( expr instanceof TirTraceExpr )
        {
            this.walkExpr( (expr as any).traceMsg );
            this.walkExpr( (expr as any).continuation );
        }
        else if( isTirBinaryExpr( expr ) )
        {
            this.walkExpr( (expr as any).left );
            this.walkExpr( (expr as any).right );
        }
        else if( isTirUnaryPrefixExpr( expr ) )
        {
            this.walkExpr( (expr as any).operand );
        }
        // TirLitteralExpr, TirNativeFunc, TirFailExpr, TirInlineClosedIR — leaf nodes
    }

    private walkStmt( stmt: TirStmt ): void
    {
        if( !stmt ) return;

        if( stmt instanceof TirBlockStmt )
        {
            for( const s of stmt.stmts ) this.walkStmt( s );
        }
        else if( stmt instanceof TirIfStmt )
        {
            this.walkExpr( stmt.condition );
            this.walkStmt( stmt.thenBranch );
            if( stmt.elseBranch ) this.walkStmt( stmt.elseBranch );
        }
        else if( stmt instanceof TirReturnStmt )
        {
            this.walkExpr( stmt.value );
        }
        else if( stmt instanceof TirAssertStmt )
        {
            this.walkExpr( stmt.condition );
            if( stmt.elseExpr ) this.walkExpr( stmt.elseExpr );
        }
        else if( stmt instanceof TirForStmt )
        {
            for( const v of stmt.init ) this.walkVarDecl( v );
            if( stmt.condition ) this.walkExpr( stmt.condition );
            if( stmt.update ) for( const s of stmt.update ) this.walkStmt( s );
            this.walkStmt( stmt.body );
        }
        else if( stmt instanceof TirForOfStmt )
        {
            this.walkVarDecl( stmt.elemDeclaration );
            this.walkExpr( stmt.iterable );
            this.walkStmt( stmt.body );
        }
        else if( stmt instanceof TirWhileStmt )
        {
            this.walkExpr( stmt.condition );
            this.walkStmt( stmt.body );
        }
        else if( stmt instanceof TirMatchStmt )
        {
            this.walkExpr( stmt.matchExpr );
            for( const c of stmt.cases )
            {
                this.walkVarDecl( c.pattern );
                this.walkStmt( c.body );
            }
            if( stmt.wildcardCase ) this.walkStmt( stmt.wildcardCase.body );
        }
        else if( stmt instanceof TirAssignmentStmt )
        {
            this.walkExpr( stmt.varIdentifier );
            this.walkExpr( stmt.assignedExpr );
        }
        else if( stmt instanceof TirTraceStmt )
        {
            this.walkExpr( stmt.expr );
        }
        else if( stmt instanceof TirSimpleVarDecl )
        {
            this.walkVarDecl( stmt );
        }
        else if( stmt instanceof TirNamedDeconstructVarDecl )
        {
            this.walkVarDecl( stmt );
        }
        else if( stmt instanceof TirSingleDeconstructVarDecl )
        {
            this.walkVarDecl( stmt );
        }
        else if( stmt instanceof TirArrayLikeDeconstr )
        {
            this.walkVarDecl( stmt );
        }
        // TirBreakStmt, TirContinueStmt, TirFailStmt — no sub-expressions to walk
    }

    private walkVarDecl( decl: TirSimpleVarDecl | TirNamedDeconstructVarDecl | TirSingleDeconstructVarDecl | TirArrayLikeDeconstr, isDeconstructField: boolean = false ): void
    {
        if( decl instanceof TirSimpleVarDecl )
        {
            // skip full-range entry for deconstruct fields — their parent's fieldLabelRanges provides correct tight-range entries
            if( !isDeconstructField )
            {
                // internal-named params (§-prefixed) use sourceName if available
                const displayName = decl.sourceName ?? ( isInternalName( decl.name ) ? undefined : decl.name );
                if( displayName !== undefined )
                {
                    this.addEntry( decl.range.start, decl.range.end, decl.type, displayName );
                }
            }
            // add entry for explicit type annotation as a type reference
            if( decl.typeAnnotationRange )
            {
                this.addEntry(
                    decl.typeAnnotationRange.start, decl.typeAnnotationRange.end,
                    decl.type, undefined, "type-reference"
                );
            }
            if( decl.initExpr ) this.walkExpr( decl.initExpr );
        }
        else if( decl instanceof TirNamedDeconstructVarDecl )
        {
            // add entry for the constructor name as a type reference (for LSP coloring)
            if( decl.constrNameRange )
            {
                this.addEntry(
                    decl.constrNameRange.start, decl.constrNameRange.end,
                    decl.type, decl.constrName, "type-reference"
                );
            }
            // add entry for explicit type annotation as a type reference
            if( decl.typeAnnotationRange )
            {
                this.addEntry(
                    decl.typeAnnotationRange.start, decl.typeAnnotationRange.end,
                    decl.type, undefined, "type-reference"
                );
            }
            // add entries for field labels (hovering field name shows the field's type from the constructor definition)
            if( decl.fieldLabelRanges )
            {
                for( const [ fieldName, labelInfo ] of decl.fieldLabelRanges )
                {
                    this.addEntry( labelInfo.range.start, labelInfo.range.end, labelInfo.type, fieldName );
                }
            }
            if( decl.initExpr ) this.walkExpr( decl.initExpr );
            for( const field of decl.fields.values() )
            {
                this.walkVarDecl( field, true );
            }
        }
        else if( decl instanceof TirSingleDeconstructVarDecl )
        {
            // add entry for explicit type annotation as a type reference
            if( decl.typeAnnotationRange )
            {
                this.addEntry(
                    decl.typeAnnotationRange.start, decl.typeAnnotationRange.end,
                    decl.type, undefined, "type-reference"
                );
            }
            // add entries for field labels (hovering field name shows the field's type from the constructor definition)
            if( decl.fieldLabelRanges )
            {
                for( const [ fieldName, labelInfo ] of decl.fieldLabelRanges )
                {
                    this.addEntry( labelInfo.range.start, labelInfo.range.end, labelInfo.type, fieldName );
                }
            }
            if( decl.initExpr ) this.walkExpr( decl.initExpr );
            for( const field of decl.fields.values() )
            {
                this.walkVarDecl( field, true );
            }
        }
        else if( decl instanceof TirArrayLikeDeconstr )
        {
            this.addEntry( decl.range.start, decl.range.end, decl.type );
            if( decl.initExpr ) this.walkExpr( decl.initExpr );
            for( const elem of decl.elements )
            {
                this.walkVarDecl( elem );
            }
        }
    }
}
