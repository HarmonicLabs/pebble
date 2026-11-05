import type { SourceRange } from "../ast/Source/SourceRange";
import { isInternalName } from "./internalVar";
import type { TirType } from "./tir/types/TirType";

export type PebbleSymbolKind
    = "function"
    | "parameter"
    | "constant"
    | "variable"
    | "struct"
    | "constructor"
    | "field"
    | "method"
    | "type"
    | "typeParameter"
    | "enum"
    | "enumMember"
    | "interface"
    | "namespace"
    | "contract"
    | "contractParam"
    | "contractMethod"
    | "test"
    | "import";

/** kinds that are named through what contains them (`x.field`), never on their own */
const memberKinds: ReadonlySet<PebbleSymbolKind> = new Set<PebbleSymbolKind>([
    "constructor", "field", "method", "enumMember", "contractMethod",
]);

export interface PebbleSymbol {
    readonly name: string;
    readonly kind: PebbleSymbolKind;
    /** the file (`Source.absoluteProjPath`) */
    readonly source: string;
    /** the name, where it is declared */
    readonly nameRange: SourceRange;
    /** the whole declaration */
    readonly range: SourceRange;
    /** the offsets of `source` where the name can be used; a top-level name, the whole file */
    readonly visibleIn: { readonly start: number; readonly end: number };
    /** the struct of a field, the contract of a method */
    readonly container?: PebbleSymbol;
    exported: boolean;
    type?: TirType;
    /** an import (or a re-export): the declaration it names, in the other file */
    target?: PebbleSymbol;
}

export interface PebbleSymbolRef {
    readonly range: SourceRange;
    readonly symbol: PebbleSymbol;
    /** an assignment */
    readonly write: boolean;
}

export interface DeclareSymbol {
    name: string;
    kind: PebbleSymbolKind;
    nameRange: SourceRange;
    range: SourceRange;
    visibleIn?: { start: number; end: number };
    container?: PebbleSymbol;
    exported?: boolean;
    type?: TirType;
}

/**
 * The declarations of a checked program and the uses of each, by position: what an editor needs
 * for definitions, references, renames and completion. `check()` builds it while names resolve
 * (`TypedProgram.symbols`), over the entry and every file it imports.
 */
export class SymbolIndex
{
    /** key: file, name start */
    private readonly declared = new Map<string, PebbleSymbol>();
    /** key: file, start, end */
    private readonly refs = new Map<string, PebbleSymbolRef>();
    /** what each symbol contains (a struct's constructors, a constructor's fields, methods) */
    private readonly members = new Map<PebbleSymbol, PebbleSymbol[]>();
    /** key: a struct's name and file uid, the same for both its TIR types (data and SoP) */
    private readonly structs = new Map<string, PebbleSymbol>();
    /** key: a file; the files it exports everything of (`export * from`) */
    private readonly starExports = new Map<string, string[]>();
    /** the names `context` can be destructured into, in each contract method's body */
    private readonly contextFields: { range: SourceRange; names: readonly string[] }[] = [];
    /** key: a TIR name the compiler gave a declaration (a method's function, a contract param) */
    private readonly tirNames = new Map<string, PebbleSymbol>();

    /**
     * The symbol declared at `nameRange`. A name declares one symbol: one compiled again (a
     * generic body, once per instantiation) or declared again in another form (a contract method's
     * parameter, then the redeemer field the compiler makes of it) gets the first one. A name the
     * source does not have at `nameRange` (made up by the compiler, anonymous) declares nothing.
     */
    declare( info: DeclareSymbol ): PebbleSymbol | undefined
    {
        const { name, kind, nameRange, range } = info;
        const source = sourceOf( nameRange );
        if( source === undefined || name.length === 0 || isInternalName( name ) ) return undefined;
        if( nameRange.source.text.slice( nameRange.start, nameRange.end ) !== name ) return undefined;

        const key = `${source}:${nameRange.start}`;
        const existing = this.declared.get( key );
        if( existing )
        {
            if( info.exported ) existing.exported = true;
            if( existing.type === undefined ) existing.type = info.type;
            return existing;
        }
        const symbol: PebbleSymbol = {
            name,
            kind,
            source,
            nameRange,
            range: sourceOf( range ) === source ? range : nameRange,
            visibleIn: info.visibleIn ?? { start: 0, end: nameRange.source.text.length },
            container: info.container,
            exported: info.exported === true,
            type: info.type,
        };
        this.declared.set( key, symbol );
        if( symbol.container )
        {
            const members = this.members.get( symbol.container );
            if( members ) members.push( symbol );
            else this.members.set( symbol.container, [ symbol ] );
        }
        return symbol;
    }

    /** `symbol` is the struct whose TIR types have this `name` and `fileUid` */
    registerStruct( name: string, fileUid: string, symbol: PebbleSymbol ): void
    {
        this.structs.set( `${name}_${fileUid}`, symbol );
    }

    /** the struct a TIR struct type was declared by */
    structOf( type: { name: string; fileUid: string } | undefined ): PebbleSymbol | undefined
    {
        return type === undefined ? undefined : this.structs.get( `${type.name}_${type.fileUid}` );
    }

    /** the compiler calls `symbol` `tirName` (a method's function, a contract param's variable) */
    registerTirName( tirName: string, symbol: PebbleSymbol ): void
    {
        this.tirNames.set( tirName, symbol );
    }

    symbolOfTirName( tirName: string ): PebbleSymbol | undefined
    {
        return this.tirNames.get( tirName );
    }

    /** in `range` (a contract method's body), `context` has the fields `names` */
    registerContextFields( range: SourceRange, names: readonly string[] ): void
    {
        if( sourceOf( range ) !== undefined ) this.contextFields.push({ range, names });
    }

    /** the fields `context` has at `offset` of `file` (a contract method's body), if any */
    contextFieldsAt( file: string, offset: number ): readonly string[] | undefined
    {
        let best: { range: SourceRange; names: readonly string[] } | undefined = undefined;
        for( const entry of this.contextFields )
        {
            if( sourceOf( entry.range ) !== file || !contains( entry.range, offset ) ) continue;
            if( !best || span( entry.range ) < span( best.range ) ) best = entry;
        }
        return best?.names;
    }

    /** what `symbol` contains: a struct's constructors and methods, a constructor's fields */
    membersOf( symbol: PebbleSymbol ): readonly PebbleSymbol[]
    {
        return this.members.get( symbol ) ?? [];
    }

    /**
     * `struct`'s constructor `name`. One named by the struct's own name is the struct itself; a
     * contract's datum has its states as constructors.
     */
    constructorOf( struct: PebbleSymbol | undefined, name: string ): PebbleSymbol | undefined
    {
        if( struct === undefined ) return undefined;
        const ctor = this.membersOf( struct ).find( m => ( m.kind === "constructor" || m.kind === "struct" ) && m.name === name );
        return ctor ?? ( struct.name === name ? struct : undefined );
    }

    /** the field `name` of the constructor `ctorName` of `struct` */
    fieldOf( struct: PebbleSymbol | undefined, ctorName: string, name: string ): PebbleSymbol | undefined
    {
        const ctor = this.constructorOf( struct, ctorName );
        return ctor === undefined ? undefined : this.membersOf( ctor ).find( m => m.kind === "field" && m.name === name );
    }

    /** `range` names `symbol` */
    reference( range: SourceRange, symbol: PebbleSymbol | undefined, write: boolean = false ): void
    {
        if( symbol === undefined ) return;
        const source = sourceOf( range );
        if( source === undefined ) return;
        // the declaration's own name is not a use of it
        if( source === symbol.source && range.start === symbol.nameRange.start ) return;
        const key = `${source}:${range.start}:${range.end}`;
        if( !this.refs.has( key ) ) this.refs.set( key, { range, symbol, write } );
    }

    /** the uses in `file`, by position */
    referencesIn( file: string ): PebbleSymbolRef[]
    {
        const result: PebbleSymbolRef[] = [];
        for( const ref of this.refs.values() ) if( sourceOf( ref.range ) === file ) result.push( ref );
        return result.sort( byPosition );
    }

    /** the (innermost) use at `offset` of `file` */
    referenceAt( file: string, offset: number ): PebbleSymbolRef | undefined
    {
        let best: PebbleSymbolRef | undefined = undefined;
        for( const ref of this.refs.values() )
        {
            if( sourceOf( ref.range ) !== file || !contains( ref.range, offset ) ) continue;
            if( !best || span( ref.range ) < span( best.range ) ) best = ref;
        }
        return best;
    }

    /** the symbol named at `offset` of `file`: by a use there, or by its declaration */
    symbolAt( file: string, offset: number ): PebbleSymbol | undefined
    {
        const ref = this.referenceAt( file, offset );
        if( ref ) return ref.symbol;
        for( const symbol of this.declared.values() )
            if( symbol.source === file && contains( symbol.nameRange, offset ) ) return symbol;
        return undefined;
    }

    /** the declaration `symbol` names: through imports and re-exports, the original */
    definitionOf( symbol: PebbleSymbol ): PebbleSymbol
    {
        const seen = new Set<PebbleSymbol>();
        while( symbol.target && !seen.has( symbol ) )
        {
            seen.add( symbol );
            symbol = symbol.target;
        }
        return symbol;
    }

    /**
     * Every place naming what `symbol` names, in the files of this check: the uses of its
     * declaration, and the imports of it under the same name with their uses (what a rename
     * changes). An alias (`import { a as b }`) is a name of its own: the references of `b` are
     * the uses of `b`, and those of `a` include the `a` in the import. The declaration itself is
     * not included; by file, then position.
     */
    references( symbol: PebbleSymbol ): PebbleSymbolRef[]
    {
        const root = this.nameRootOf( symbol );
        const named = new Set<PebbleSymbol>();
        for( const s of this.declared.values() ) if( this.nameRootOf( s ) === root ) named.add( s );
        const result: PebbleSymbolRef[] = [];
        for( const ref of this.refs.values() ) if( named.has( ref.symbol ) ) result.push( ref );
        for( const s of named ) if( s !== root ) result.push({ range: s.nameRange, symbol: s, write: false });
        return result.sort( byPosition );
    }

    /** the declaration `symbol` imports under its own name, through imports of the same name */
    private nameRootOf( symbol: PebbleSymbol ): PebbleSymbol
    {
        const seen = new Set<PebbleSymbol>();
        while( symbol.target && symbol.target.name === symbol.name && !seen.has( symbol ) )
        {
            seen.add( symbol );
            symbol = symbol.target;
        }
        return symbol;
    }

    /** the declarations of `file`, by position */
    declarationsOf( file: string ): PebbleSymbol[]
    {
        const result: PebbleSymbol[] = [];
        for( const symbol of this.declared.values() ) if( symbol.source === file ) result.push( symbol );
        return result.sort( ( a, b ) => a.nameRange.start - b.nameRange.start );
    }

    /**
     * The names that can be used at `offset` of `file`, innermost first: one per name, the one a
     * use there resolves to. Members (fields, methods, constructors) are named through what has
     * them, and are not listed.
     */
    visibleAt( file: string, offset: number ): PebbleSymbol[]
    {
        const byName = new Map<string, PebbleSymbol>();
        for( const symbol of this.declared.values() )
        {
            if( symbol.source !== file || memberKinds.has( symbol.kind ) ) continue;
            if( offset < symbol.visibleIn.start || offset >= symbol.visibleIn.end ) continue;
            const other = byName.get( symbol.name );
            if( !other || visibleSpan( symbol ) < visibleSpan( other ) ) byName.set( symbol.name, symbol );
        }
        return [ ...byName.values() ].sort( ( a, b ) => visibleSpan( a ) - visibleSpan( b ) );
    }

    /** `file` exports everything `from` exports (`export * from`) */
    registerStarExport( file: string, from: string ): void
    {
        const froms = this.starExports.get( file );
        if( froms ) froms.push( from );
        else this.starExports.set( file, [ from ] );
    }

    /**
     * the top-level declaration `name` of `file` (an import's target): one of its own, or one it
     * exports from another file with `export * from`
     */
    topLevel( file: string, name: string, seen: Set<string> = new Set() ): PebbleSymbol | undefined
    {
        seen.add( file );
        const own = this.ownTopLevel( file, name );
        if( own ) return own;
        for( const from of this.starExports.get( file ) ?? [] )
        {
            if( seen.has( from ) ) continue;
            const found = this.topLevel( from, name, seen );
            if( found ) return found;
        }
        return undefined;
    }

    private ownTopLevel( file: string, name: string ): PebbleSymbol | undefined
    {
        let found: PebbleSymbol | undefined = undefined;
        for( const symbol of this.declared.values() )
        {
            if( symbol.source !== file || symbol.name !== name || memberKinds.has( symbol.kind ) ) continue;
            if( symbol.visibleIn.start !== 0 || symbol.visibleIn.end !== symbol.nameRange.source.text.length ) continue;
            // a type and a function of the same name: either is the import's target
            if( !found || found.kind === "import" ) found = symbol;
        }
        return found;
    }
}

function sourceOf( range: SourceRange | undefined ): string | undefined
{
    const source = range?.source?.absoluteProjPath;
    if( typeof source !== "string" || source.length === 0 ) return undefined;
    if( !( range!.start >= 0 && range!.end > range!.start ) ) return undefined;
    return source;
}

function contains( range: SourceRange, offset: number ): boolean
{
    return range.start <= offset && offset < range.end;
}

function span( range: SourceRange ): number
{
    return range.end - range.start;
}

function visibleSpan( symbol: PebbleSymbol ): number
{
    return symbol.visibleIn.end - symbol.visibleIn.start;
}

function byPosition( a: PebbleSymbolRef, b: PebbleSymbolRef ): number
{
    const fa = a.range.source.absoluteProjPath, fb = b.range.source.absoluteProjPath;
    return fa < fb ? -1 : fa > fb ? 1 : a.range.start - b.range.start;
}
