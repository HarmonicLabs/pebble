import { CEKConst, CEKConstr, CEKDelay, CEKLambda, CEKValueObj, PartialBuiltin } from "@harmoniclabs/plutus-machine";
import { DataB, DataConstr, DataI, DataList, DataMap, Data } from "@harmoniclabs/plutus-data";
import { ConstTyTag } from "@harmoniclabs/uplc";
import { toHex } from "@harmoniclabs/uint8array-utils";
import type { TirType } from "../compiler/tir/types/TirType";
import { getUnaliased } from "../compiler/tir/types/utils/getUnaliased";
import { TirDataStructType, TirSoPStructType, TirStructConstr } from "../compiler/tir/types/TirStructType";
import { TirEnumType } from "../compiler/tir/types/TirEnumType";
import { TirDataOptT } from "../compiler/tir/types/TirNativeType/native/Optional/data";
import { TirSopOptT } from "../compiler/tir/types/TirNativeType/native/Optional/sop";
import { TirListT } from "../compiler/tir/types/TirNativeType/native/list";
import { TirArrayT } from "../compiler/tir/types/TirNativeType/native/array";
import { TirLinearMapT } from "../compiler/tir/types/TirNativeType/native/linearMap";
import { TirLinearMapEntryT } from "../compiler/tir/types/TirNativeType/native/linearMapEntry";
import { TirBoolT } from "../compiler/tir/types/TirNativeType/native/bool";
import { TirStringT } from "../compiler/tir/types/TirNativeType/native/string";
import { TirFuncT } from "../compiler/tir/types/TirNativeType/native/function";

/**
 * A value as a debugger shows it: decoded with the variable's Pebble type, so a data struct
 * shows its constructor and field names, a SoP optional `Some{ value: ... }`, a boolean read from
 * data `true`. Without a type, or when the value does not fit it, data shows as data.
 */
export type ValueNode =
    | { readonly kind: "int", readonly value: bigint, readonly member?: string }
    | { readonly kind: "bool", readonly value: boolean }
    | { readonly kind: "bytes", readonly hex: string }
    | { readonly kind: "string", readonly value: string }
    | { readonly kind: "unit" }
    | { readonly kind: "struct", readonly name: string, readonly fields: readonly ( readonly [ string, ValueNode ] )[] }
    | { readonly kind: "list", readonly items: readonly ValueNode[] }
    | { readonly kind: "map", readonly entries: readonly ( readonly [ ValueNode, ValueNode ] )[] }
    | { readonly kind: "data", readonly node: ValueNode }
    | { readonly kind: "function" }
    | { readonly kind: "other", readonly text: string };

/** how deep structured values are decoded at most */
const MAX_DEPTH = 64;

export function decodeValue( value: CEKValueObj, type: TirType | undefined ): ValueNode
{
    return decode( value, type, 0 );
}

function decode( v: CEKValueObj, type: TirType | undefined, depth: number ): ValueNode
{
    const t = type === undefined ? undefined : unalias( type );
    if( v instanceof CEKConstr )
    {
        if( t instanceof TirSopOptT )
        {
            // the payload of a SoP optional stays data (see `_inlineFromData`)
            if( v.index === BigInt( 0 ) && v.values.length === 1 )
            return struct( "Some", [[ "value", decode( v.values[0], t.typeArg, depth + 1 ) ]] );
            if( v.index === BigInt( 1 ) ) return struct( "None", [] );
        }
        if( t instanceof TirSoPStructType )
        {
            const ctor = ctorAt( t, Number( v.index ) );
            if( ctor !== undefined && ctor.fields.length === v.values.length )
            return struct( ctor.name, ctor.fields.map( ( f, k ) => [ f.name, decode( v.values[k], f.type, depth + 1 ) ] as const ) );
        }
        return struct( "constr " + v.index.toString(), v.values.map( ( x, k ) => [ String( k ), decode( x, undefined, depth + 1 ) ] as const ) );
    }
    if( v instanceof CEKConst ) return decodeConst( v.type as ConstTyTag[], v.value, t, depth );
    if( v instanceof CEKLambda || v instanceof CEKDelay || v instanceof PartialBuiltin || t instanceof TirFuncT ) return { kind: "function" };
    return { kind: "other", text: "<" + ( ( v as any )?.constructor?.name ?? typeof v ) + ">" };
}

function decodeConst( type: readonly ConstTyTag[], value: any, t: TirType | undefined, depth: number ): ValueNode
{
    switch( type[0] )
    {
        case ConstTyTag.int: return intNode( BigInt( value ), t );
        case ConstTyTag.bool: return { kind: "bool", value: value === true };
        case ConstTyTag.byteStr: return { kind: "bytes", hex: bytesHex( value ) };
        case ConstTyTag.str: return { kind: "string", value: String( value ) };
        case ConstTyTag.unit: return { kind: "unit" };
        case ConstTyTag.data: return decodeData( value as Data, t, depth );
        case ConstTyTag.list: {
            const elemType = type.slice( 1 );
            const items: any[] = Array.isArray( value ) ? value : [];
            // a map is a list of data pairs
            if( t instanceof TirLinearMapT && elemType[0] === ConstTyTag.pair )
            return {
                kind: "map",
                entries: items.map( p => [
                    decodeData( p.fst, t.keyTypeArg, depth + 1 ),
                    decodeData( p.snd, t.valTypeArg, depth + 1 )
                ] as const )
            };
            const elemT = t instanceof TirListT || t instanceof TirArrayT ? t.typeArg : undefined;
            return { kind: "list", items: items.map( x => decodeConst( elemType, x, elemT, depth + 1 ) ) };
        }
        case ConstTyTag.pair: {
            const [ fstType, sndType ] = splitPairType( type );
            if( t instanceof TirLinearMapEntryT )
            return struct( "Entry", [
                [ "key", decodeConst( fstType, value?.fst, t.keyTypeArg, depth + 1 ) ],
                [ "value", decodeConst( sndType, value?.snd, t.valTypeArg, depth + 1 ) ],
            ]);
            return struct( "Pair", [
                [ "fst", decodeConst( fstType, value?.fst, undefined, depth + 1 ) ],
                [ "snd", decodeConst( sndType, value?.snd, undefined, depth + 1 ) ],
            ]);
        }
        default: {
            const json = typeof value?.toJson === "function" ? value.toJson() : value;
            return { kind: "other", text: safeJson( json ) };
        }
    }
}

/** data decoded as `t` says, or as plain data when it does not fit */
function decodeData( d: Data, type: TirType | undefined, depth: number ): ValueNode
{
    const t = type === undefined ? undefined : unalias( type );
    if( depth > MAX_DEPTH ) return { kind: "other", text: "…" };
    if( t !== undefined )
    {
        const typed = decodeTypedData( d, t, depth );
        if( typed !== undefined ) return typed;
    }
    return { kind: "data", node: plainData( d, depth ) };
}

function decodeTypedData( d: Data, t: TirType, depth: number ): ValueNode | undefined
{
    if( t instanceof TirDataOptT )
    {
        if( d instanceof DataConstr && d.constr === BigInt( 0 ) && d.fields.length === 1 )
        return struct( "Some", [[ "value", decodeData( d.fields[0], t.typeArg, depth + 1 ) ]] );
        if( d instanceof DataConstr && d.constr === BigInt( 1 ) ) return struct( "None", [] );
        return undefined;
    }
    if( t instanceof TirDataStructType )
    {
        if( t.untagged )
        {
            const ctor = t.constructors[0];
            if( d instanceof DataList && ctor !== undefined && ctor.fields.length === d.list.length )
            return struct( ctor.name, ctor.fields.map( ( f, k ) => [ f.name, decodeData( d.list[k], f.type, depth + 1 ) ] as const ) );
            return undefined;
        }
        if(!( d instanceof DataConstr )) return undefined;
        const ctor = ctorAt( t, Number( d.constr ) );
        if( ctor === undefined || ctor.fields.length !== d.fields.length ) return undefined;
        return struct( ctor.name, ctor.fields.map( ( f, k ) => [ f.name, decodeData( d.fields[k], f.type, depth + 1 ) ] as const ) );
    }
    if( t instanceof TirBoolT )
    {
        // pebble's own encoding: constructor 0 is `true`
        if( d instanceof DataConstr && d.fields.length === 0 && d.constr <= BigInt( 1 ) )
        return { kind: "bool", value: d.constr === BigInt( 0 ) };
        return undefined;
    }
    if( t instanceof TirStringT )
    {
        if( d instanceof DataB ) return { kind: "string", value: utf8( d.bytes ) };
        return undefined;
    }
    if( t instanceof TirListT || t instanceof TirArrayT )
    {
        if( d instanceof DataList ) return { kind: "list", items: d.list.map( x => decodeData( x, t.typeArg, depth + 1 ) ) };
        return undefined;
    }
    if( t instanceof TirLinearMapT )
    {
        if( d instanceof DataMap ) return {
            kind: "map",
            entries: d.map.map( kv => [ decodeData( kv.fst, t.keyTypeArg, depth + 1 ), decodeData( kv.snd, t.valTypeArg, depth + 1 ) ] as const )
        };
        return undefined;
    }
    if( d instanceof DataI ) return intNode( d.int, t );
    if( d instanceof DataB ) return { kind: "bytes", hex: toHex( d.bytes ) };
    return undefined;
}

/** data as data: `Constr 0 [I 1, B #ab]` shapes */
function plainData( d: Data, depth: number ): ValueNode
{
    if( depth > MAX_DEPTH ) return { kind: "other", text: "…" };
    if( d instanceof DataConstr ) return struct( "Constr " + d.constr.toString(), d.fields.map( ( x, k ) => [ String( k ), plainData( x, depth + 1 ) ] as const ) );
    if( d instanceof DataI ) return { kind: "int", value: d.int };
    if( d instanceof DataB ) return { kind: "bytes", hex: toHex( d.bytes ) };
    if( d instanceof DataList ) return { kind: "list", items: d.list.map( x => plainData( x, depth + 1 ) ) };
    if( d instanceof DataMap ) return { kind: "map", entries: d.map.map( kv => [ plainData( kv.fst, depth + 1 ), plainData( kv.snd, depth + 1 ) ] as const ) };
    return { kind: "other", text: safeJson( d ) };
}

function intNode( value: bigint, t: TirType | undefined ): ValueNode
{
    if( t instanceof TirEnumType )
    {
        const member = t.members[ Number( value ) ];
        if( member !== undefined ) return { kind: "int", value, member };
    }
    return { kind: "int", value };
}

/** the constructor a runtime index stands for: narrowed types keep their parent's indices */
function ctorAt( t: TirDataStructType | TirSoPStructType, runtimeIdx: number ): TirStructConstr | undefined
{
    const parents = t.narrowedFromParentCtorIdxs;
    if( parents !== undefined )
    {
        const local = parents.indexOf( runtimeIdx );
        return local < 0 ? undefined : t.constructors[ local ];
    }
    return t.constructors[ runtimeIdx ];
}

function unalias( t: TirType ): TirType
{
    try { return getUnaliased( t ); }
    catch { return t; }
}

function struct( name: string, fields: readonly ( readonly [ string, ValueNode ] )[] ): ValueNode
{
    return { kind: "struct", name, fields };
}

/** `[ pair, A..., B... ]`: the two element types of a pair type */
function splitPairType( type: readonly ConstTyTag[] ): [ ConstTyTag[], ConstTyTag[] ]
{
    const rest = type.slice( 1 );
    const len = typeLength( rest, 0 );
    return [ rest.slice( 0, len ), rest.slice( len ) ];
}

function typeLength( type: readonly ConstTyTag[], at: number ): number
{
    const tag = type[ at ];
    if( tag === ConstTyTag.list || tag === ConstTyTag.array ) return 1 + typeLength( type, at + 1 );
    if( tag === ConstTyTag.pair )
    {
        const a = typeLength( type, at + 1 );
        return 1 + a + typeLength( type, at + 1 + a );
    }
    return 1;
}

function bytesHex( value: any ): string
{
    if( value instanceof Uint8Array ) return toHex( value );
    if( typeof value?.toString === "function" ) return String( value.toString() );
    return String( value );
}

function utf8( bytes: Uint8Array ): string
{
    try { return new TextDecoder( "utf-8", { fatal: true } ).decode( bytes ); }
    catch { return "#" + toHex( bytes ); }
}

function safeJson( x: any ): string
{
    try {
        return JSON.stringify( x, ( _k, y ) =>
            typeof y === "bigint" ? y.toString() :
            y instanceof Uint8Array ? "#" + toHex( y ) :
            y
        ) ?? String( x );
    }
    catch { return String( x ); }
}

export interface FormatOptions {
    /** levels of nesting shown before `…` (default: all) */
    maxDepth?: number;
    /** items of a list or map shown before `… N more` (default: all) */
    maxItems?: number;
    /** hex digits of bytes shown before `…` (default: all) */
    maxBytes?: number;
}

/** the value in Pebble syntax: `Finite{ n: 1000 }`, `[1, 2]`, `#abcd` */
export function formatValue( node: ValueNode, opts: FormatOptions = {}, depth: number = 0 ): string
{
    const maxDepth = opts.maxDepth ?? Infinity;
    const maxItems = opts.maxItems ?? Infinity;
    const deeper = ( n: ValueNode ) => formatValue( n, opts, depth + 1 );
    const cut = ( xs: string[], total: number ) => total > xs.length ? xs.concat( `… ${total - xs.length} more` ) : xs;
    switch( node.kind )
    {
        case "int": return node.member !== undefined ? node.member : node.value.toString();
        case "bool": return node.value ? "true" : "false";
        case "bytes": {
            const max = opts.maxBytes ?? Infinity;
            return "#" + ( node.hex.length > max ? node.hex.slice( 0, max ) + "…" : node.hex );
        }
        case "string": return JSON.stringify( node.value );
        case "unit": return "()";
        case "function": return "<function>";
        case "other": return node.text;
        case "data": return formatValue( node.node, opts, depth );
        case "struct": {
            if( node.fields.length === 0 ) return node.name + "{}";
            if( depth >= maxDepth ) return node.name + "{ … }";
            const shown = node.fields.slice( 0, maxItems ).map( ([ k, v ]) => isIndex( k ) ? deeper( v ) : `${k}: ${deeper( v )}` );
            const parts = cut( shown, node.fields.length );
            return node.fields.every( ([ k ]) => isIndex( k ) )
                ? `${node.name} [${parts.join( ", " )}]`
                : `${node.name}{ ${parts.join( ", " )} }`;
        }
        case "list": {
            if( node.items.length === 0 ) return "[]";
            if( depth >= maxDepth ) return `[ … ${node.items.length} items ]`;
            return "[" + cut( node.items.slice( 0, maxItems ).map( deeper ), node.items.length ).join( ", " ) + "]";
        }
        case "map": {
            if( node.entries.length === 0 ) return "{}";
            if( depth >= maxDepth ) return `{ … ${node.entries.length} entries }`;
            return "{ " + cut( node.entries.slice( 0, maxItems ).map( ([ k, v ]) => `${deeper( k )}: ${deeper( v )}` ), node.entries.length ).join( ", " ) + " }";
        }
    }
}

/**
 * The value as JSON: integers as numbers when exact (else strings), bytes as `"#hex"`, structs
 * as `{ "Name": { field: value } }`, plain data in the `{ constr, fields }` shape of cardano-cli.
 */
export function valueToJson( node: ValueNode ): unknown
{
    switch( node.kind )
    {
        case "int": return node.member !== undefined ? node.member : intJson( node.value );
        case "bool": return node.value;
        case "bytes": return "#" + node.hex;
        case "string": return node.value;
        case "unit": return null;
        case "function": return "<function>";
        case "other": return node.text;
        case "data": return dataJson( node.node );
        case "struct": {
            if( node.fields.every( ([ k ]) => isIndex( k ) ) && node.fields.length > 0 )
            return { [node.name]: node.fields.map( ([ , v ]) => valueToJson( v ) ) };
            const fields: Record<string, unknown> = {};
            for( const [ k, v ] of node.fields ) fields[k] = valueToJson( v );
            return { [node.name]: fields };
        }
        case "list": return node.items.map( valueToJson );
        case "map": return node.entries.map( ([ k, v ]) => [ valueToJson( k ), valueToJson( v ) ] );
    }
}

function dataJson( node: ValueNode ): unknown
{
    switch( node.kind )
    {
        case "struct": {
            const m = /^Constr (\d+)$/.exec( node.name );
            if( m === null ) return valueToJson( node );
            return { constr: Number( m[1] ), fields: node.fields.map( ([ , v ]) => dataJson( v ) ) };
        }
        case "int": return { int: intJson( node.value ) };
        case "bytes": return { bytes: node.hex };
        case "list": return { list: node.items.map( dataJson ) };
        case "map": return { map: node.entries.map( ([ k, v ]) => ({ k: dataJson( k ), v: dataJson( v ) }) ) };
        default: return valueToJson( node );
    }
}

function intJson( n: bigint ): number | string
{
    return n >= BigInt( Number.MIN_SAFE_INTEGER ) && n <= BigInt( Number.MAX_SAFE_INTEGER ) ? Number( n ) : n.toString();
}

function isIndex( k: string ): boolean
{
    return /^\d+$/.test( k );
}

/** the children a variables view expands a value into */
export function valueChildren( node: ValueNode ): { name: string, node: ValueNode }[]
{
    switch( node.kind )
    {
        case "data": return valueChildren( node.node );
        case "struct": return node.fields.map( ([ k, v ]) => ({ name: k, node: v }) );
        case "list": return node.items.map( ( v, k ) => ({ name: String( k ), node: v }) );
        case "map": return node.entries.map( ([ k, v ], i ) => ({ name: formatValue( k, { maxDepth: 1, maxItems: 3, maxBytes: 16 } ), node: v }) );
        default: return [];
    }
}

/** the type name shown next to a value */
export function typeName( type: TirType | undefined ): string
{
    if( type === undefined ) return "";
    try { return type.toString(); }
    catch { return ""; }
}
