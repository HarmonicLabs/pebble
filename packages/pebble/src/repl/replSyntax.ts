/**
 * What the REPL needs to know about a line before the compiler sees it: where its statements
 * end, which of them are declarations the session keeps, and which names they declare, use
 * and assign. A token scan, not a parse: the compiler reports what is wrong with the code.
 */

export type ReplTokenKind = "ident" | "number" | "string" | "bytes" | "punct";

export interface ReplToken {
    readonly kind: ReplTokenKind;
    readonly text: string;
    readonly start: number;
    readonly end: number;
    /** a line break comes between the previous token and this one */
    readonly newlineBefore: boolean;
}

export interface LexResult {
    readonly tokens: readonly ReplToken[];
    /** a string, template or block comment is still open at the end */
    readonly unterminated: boolean;
}

/** longest first */
const PUNCTUATION = [
    ">>>=",
    "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
    "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "!.", "++", "--",
    "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>",
];

const ASSIGNMENT_OPERATORS = new Set([
    "=", "+=", "-=", "*=", "**=", "/=", "%=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "??=", "||=", "&&=",
]);

const MEMBER_ACCESS = new Set([ ".", "?.", "!." ]);

const isIdentStart = ( c: string ) => /[\p{L}_$]/u.test( c );
const isIdentPart = ( c: string ) => /[\p{L}\p{N}_$]/u.test( c );
const isDigit = ( c: string ) => c >= "0" && c <= "9";
const isHexDigit = ( c: string ) => /[0-9a-fA-F]/.test( c );

export function lexPebble( text: string ): LexResult
{
    const tokens: ReplToken[] = [];
    let unterminated = false;
    let newlineBefore = false;
    let pos = 0;
    const len = text.length;

    const push = ( kind: ReplTokenKind, start: number, end: number ) => {
        tokens.push({ kind, text: text.slice( start, end ), start, end, newlineBefore });
        newlineBefore = false;
    };

    while( pos < len )
    {
        const c = text[pos];
        if( c === "\n" ) { newlineBefore = true; pos++; continue; }
        if( c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" ) { pos++; continue; }

        // comments
        if( c === "/" && text[pos + 1] === "/" )
        {
            while( pos < len && text[pos] !== "\n" ) pos++;
            continue;
        }
        if( c === "/" && text[pos + 1] === "*" )
        {
            const end = text.indexOf( "*/", pos + 2 );
            if( end < 0 ) { unterminated = true; break; }
            if( text.slice( pos, end ).includes( "\n" ) ) newlineBefore = true;
            pos = end + 2;
            continue;
        }

        const start = pos;
        if( c === "\"" || c === "'" )
        {
            pos++;
            while( pos < len && text[pos] !== c && text[pos] !== "\n" )
                pos += text[pos] === "\\" ? 2 : 1;
            if( pos >= len || text[pos] !== c ) unterminated = true;
            else pos++;
            push( "string", start, Math.min( pos, len ) );
            continue;
        }
        if( c === "`" )
        {
            const end = skipTemplate( text, pos );
            if( end < 0 ) { unterminated = true; push( "string", start, len ); break; }
            pos = end;
            push( "string", start, pos );
            continue;
        }
        if( c === "#" )
        {
            pos++;
            while( pos < len && isHexDigit( text[pos] ) ) pos++;
            push( "bytes", start, pos );
            continue;
        }
        if( isDigit( c ) )
        {
            while( pos < len && ( isIdentPart( text[pos] ) ) ) pos++;
            push( "number", start, pos );
            continue;
        }
        if( isIdentStart( c ) )
        {
            while( pos < len && isIdentPart( text[pos] ) ) pos++;
            push( "ident", start, pos );
            continue;
        }
        const op = PUNCTUATION.find( p => text.startsWith( p, pos ) ) ?? c;
        pos += op.length;
        push( "punct", start, pos );
    }

    return { tokens, unterminated };
}

/** the end of the template literal starting at `start` (a backtick), or -1 when it does not end */
function skipTemplate( text: string, start: number ): number
{
    let pos = start + 1;
    while( pos < text.length )
    {
        const c = text[pos];
        if( c === "\\" ) { pos += 2; continue; }
        if( c === "`" ) return pos + 1;
        if( c === "$" && text[pos + 1] === "{" )
        {
            // `${ ... }`: an expression, with its own braces, strings and templates
            let depth = 1;
            pos += 2;
            while( pos < text.length && depth > 0 )
            {
                const d = text[pos];
                if( d === "{" ) depth++;
                else if( d === "}" ) depth--;
                else if( d === "`" ) { const end = skipTemplate( text, pos ); if( end < 0 ) return -1; pos = end; continue; }
                else if( d === "\"" || d === "'" ) {
                    pos++;
                    while( pos < text.length && text[pos] !== d ) pos += text[pos] === "\\" ? 2 : 1;
                }
                pos++;
            }
            if( depth > 0 ) return -1;
            continue;
        }
        pos++;
    }
    return -1;
}

/** `true` while an input needs more lines: a bracket, string, template or comment is open */
export function isIncompleteInput( text: string ): boolean
{
    const { tokens, unterminated } = lexPebble( text );
    if( unterminated ) return true;
    let depth = 0;
    for( const t of tokens )
    {
        if( t.kind !== "punct" ) continue;
        if( t.text === "(" || t.text === "[" || t.text === "{" ) depth++;
        else if( t.text === ")" || t.text === "]" || t.text === "}" ) depth--;
    }
    return depth > 0;
}

export type ReplStatementKind =
    /** `import`, `export * from`, `export { … } from` */
    | "import"
    /** `struct`, `data struct`, `runtime struct`, `untagged struct`, `enum`, `type`, `interface`, `namespace` */
    | "type"
    | "function"
    | "contract"
    | "using"
    | "test"
    | "const"
    /** `let` and `var` */
    | "let"
    /** `x = …`, `x += …`, `x++` */
    | "assignment"
    /** any other statement: `if`, `for`, `while`, `match`, `trace`, `assert`, `fail`, `return`, a block */
    | "statement"
    | "expression";

export interface ReplStatement {
    readonly kind: ReplStatementKind;
    /** the statement as typed, with its `;` if it has one */
    readonly text: string;
    /** where `text` starts in the input */
    readonly start: number;
    /** names it declares: the variables (every name of a pattern), the function, type, contract or test */
    readonly names: readonly string[];
    /** variables it assigns, in nested statements too */
    readonly assigns: readonly string[];
    /** identifiers it mentions, other than as a member (`x.name`) */
    readonly uses: readonly string[];
    /** it starts with `export` */
    readonly exported: boolean;
}

/** keywords that begin a statement: on a new line, they end the statement before them */
const STATEMENT_KEYWORDS = new Set([
    "const", "let", "var", "function", "struct", "enum", "type", "interface", "namespace",
    "contract", "import", "export", "test", "if", "for", "while", "match", "return", "trace",
    "assert", "fail", "using", "data", "runtime", "untagged", "break", "continue",
]);

/** keywords of statements that are not declarations */
const OTHER_STATEMENT_KEYWORDS = new Set([
    "if", "for", "while", "match", "return", "trace", "assert", "fail", "break", "continue",
]);

/** words that go on with an expression or statement, never start one */
const CONTINUATION_WORDS = new Set([ "else", "from", "is", "as", "of", "in", "instanceof", "extends", "implements" ]);

/** after a `}` that closes a statement's braces, these keep the statement going */
const CONTINUE_AFTER_BRACE_KEYWORDS = new Set([ "else", "from", "is", "as" ]);

/** tokens after which a line break does not end a statement */
function expectsMore( t: ReplToken ): boolean
{
    if( t.kind === "punct" ) return !( t.text === ")" || t.text === "]" || t.text === "}" || t.text === ";" );
    if( t.kind === "ident" ) return STATEMENT_KEYWORDS.has( t.text ) || CONTINUATION_WORDS.has( t.text ) || t.text === "new";
    return false;
}

/** a token a statement can start with, after a line break */
function startsStatement( t: ReplToken ): boolean
{
    if( t.kind === "ident" ) return !CONTINUATION_WORDS.has( t.text );
    return t.kind === "number" || t.kind === "string" || t.kind === "bytes";
}

/** the statements of a REPL input, in order */
export function splitStatements( input: string ): ReplStatement[]
{
    const { tokens } = lexPebble( input );
    const groups: ReplToken[][] = [];
    let current: ReplToken[] = [];
    let depth = 0;
    /** the `(` at depth 0 opened the condition of an `if`, `for` or `while` */
    let inCondition = false;
    /** the condition just closed: the body, on whatever line, is part of the statement */
    let awaitingBody = false;
    const end = () => {
        if( current.length > 0 ) groups.push( current );
        current = [];
        inCondition = false;
        awaitingBody = false;
    };

    for( let i = 0; i < tokens.length; i++ )
    {
        const t = tokens[i];
        // a line break ends a statement that is complete, as semicolons are optional
        if(
            depth === 0 && current.length > 0 && t.newlineBefore && !awaitingBody
            && startsStatement( t ) && !expectsMore( current[ current.length - 1 ] )
        ) end();

        const prev = current[ current.length - 1 ];
        current.push( t );
        awaitingBody = false;
        if( t.kind !== "punct" ) continue;

        if( t.text === "(" || t.text === "[" || t.text === "{" )
        {
            if( depth === 0 && t.text === "(" && prev?.kind === "ident" && ( prev.text === "if" || prev.text === "for" || prev.text === "while" ) )
            inCondition = true;
            depth++;
        }
        else if( t.text === ")" || t.text === "]" )
        {
            depth = Math.max( 0, depth - 1 );
            if( depth === 0 && inCondition ) { inCondition = false; awaitingBody = true; }
        }
        else if( t.text === "}" )
        {
            depth = Math.max( 0, depth - 1 );
            if( depth > 0 ) continue;
            const next = tokens[i + 1];
            if( next === undefined ) continue;
            if( next.kind === "punct" && next.text === ";" ) { current.push( next ); i++; end(); continue; }
            const continues = (
                ( next.kind === "ident" && CONTINUE_AFTER_BRACE_KEYWORDS.has( next.text ) )
                // `}.x`, `} + 1`, `} => x`: an operator on the same line
                || ( next.kind === "punct" && !next.newlineBefore && next.text !== "{" )
            );
            if( !continues ) end();
        }
        // `if( a ) x = 1; else x = 2;` is one statement
        else if( t.text === ";" && depth === 0 && !( tokens[i + 1]?.kind === "ident" && tokens[i + 1].text === "else" ) ) end();
    }
    end();

    return groups.map( g => classify( input, g ) );
}

function classify( input: string, ts: ReplToken[] ): ReplStatement
{
    const start = ts[0].start;
    const text = input.slice( start, ts[ ts.length - 1 ].end );
    const exported = ts[0].kind === "ident" && ts[0].text === "export";
    let k = exported ? 1 : 0;
    const word = ts[k]?.kind === "ident" ? ts[k].text : ts[k]?.text;
    const nameAt = ( i: number ) => ts[i]?.kind === "ident" ? [ ts[i].text ] : [];

    let kind: ReplStatementKind;
    let names: string[] = [];
    if( exported && ( word === "*" || word === "{" ) ) kind = "import";
    else switch( word )
    {
        case "import": kind = "import"; break;
        case "function": kind = "function"; names = nameAt( k + 1 ); break;
        case "struct": case "enum": case "type": case "interface": case "namespace":
            kind = "type"; names = nameAt( k + 1 ); break;
        case "data": case "runtime": case "untagged": {
            kind = "type";
            const s = ts.findIndex( ( t, i ) => i > k && t.kind === "ident" && t.text === "struct" );
            names = s < 0 ? [] : nameAt( s + 1 );
            break;
        }
        case "contract": kind = "contract"; names = nameAt( k + 1 ); break;
        case "using": kind = "using"; break;
        case "test": kind = "test"; names = nameAt( k + 1 ); break;
        case "const": kind = "const"; names = declaredNames( ts, k + 1 ); break;
        case "let": case "var": kind = "let"; names = declaredNames( ts, k + 1 ); break;
        default:
            if( word === "{" || ( ts[k]?.kind === "ident" && OTHER_STATEMENT_KEYWORDS.has( word! ) ) ) kind = "statement";
            else if( isAssignment( ts ) ) kind = "assignment";
            else kind = "expression";
    }

    return {
        kind,
        text,
        start,
        names,
        assigns: assignedNames( ts ),
        uses: usedNames( ts ),
        exported,
    };
}

/** the names declared by `const`/`let` declarators starting at `from`: `a`, `{ a, b: c }`, `[ a, ...r ]`, `Ctor{ a }` */
function declaredNames( ts: ReplToken[], from: number ): string[]
{
    const names: string[] = [];
    let i = from;
    while( i < ts.length )
    {
        const t = ts[i];
        if( t.kind === "ident" && ts[i + 1]?.text === "{" ) i = patternNames( ts, i + 1, names );
        else if( t.kind === "ident" ) { names.push( t.text ); i++; }
        else if( t.text === "{" || t.text === "[" ) i = patternNames( ts, i, names );
        else break;
        // to the next declarator: a comma at depth 0 after this one's `=` (commas before it are in its type)
        let depth = 0;
        let seenInit = false;
        for( ; i < ts.length; i++ )
        {
            const x = ts[i].text;
            if( ts[i].kind !== "punct" ) continue;
            if( x === "(" || x === "[" || x === "{" ) depth++;
            else if( x === ")" || x === "]" || x === "}" ) depth--;
            else if( depth === 0 && x === "=" ) seenInit = true;
            else if( depth === 0 && x === "," && seenInit ) break;
        }
        if( i >= ts.length ) break;
        i++;
    }
    return names;
}

/**
 * collects the names a destructuring pattern binds (the pattern opens at `open`);
 * returns the index after its closing bracket
 */
function patternNames( ts: ReplToken[], open: number, names: string[] ): number
{
    const close = ts[open].text === "{" ? "}" : "]";
    const isObject = close === "}";
    let i = open + 1;
    while( i < ts.length && ts[i].text !== close )
    {
        const t = ts[i];
        if( t.text === "," ) { i++; continue; }
        if( t.text === "..." ) {
            if( ts[i + 1]?.kind === "ident" ) names.push( ts[i + 1].text );
            i += 2;
            continue;
        }
        if( t.text === "{" || t.text === "[" ) { i = patternNames( ts, i, names ); continue; }
        if( t.kind === "ident" )
        {
            const next = ts[i + 1];
            if( next?.text === "{" ) { i = patternNames( ts, i + 1, names ); continue; }
            if( isObject && next?.text === ":" )
            {
                // `key: name`, `key: pattern`, `key: Ctor{ … }`
                i += 2;
                continue;
            }
            names.push( t.text );
            i++;
            // `name as Type`: skip the type
            if( ts[i]?.kind === "ident" && ts[i].text === "as" ) i = skipToElementEnd( ts, i, close );
            continue;
        }
        i = skipToElementEnd( ts, i, close );
    }
    return i + 1;
}

/** the index of the `,` or closing bracket that ends the pattern element at `i` */
function skipToElementEnd( ts: ReplToken[], i: number, close: string ): number
{
    let depth = 0;
    for( ; i < ts.length; i++ )
    {
        const x = ts[i].text;
        if( x === "(" || x === "[" || x === "{" || x === "<" ) depth++;
        else if( x === ")" || x === "]" || x === "}" || x === ">" ) {
            if( depth === 0 ) return i;
            depth--;
        }
        else if( depth === 0 && x === "," ) return i;
        if( depth === 0 && x === close ) return i;
    }
    return i;
}

/** `x = …`, `x.f = …`, `x[i] += …`, `x++`, `++x` */
function isAssignment( ts: ReplToken[] ): boolean
{
    if( ts[0].text === "++" || ts[0].text === "--" ) return ts[1]?.kind === "ident";
    if( ts[0].kind !== "ident" ) return false;
    let i = 1;
    // a member path: `.name` or `[ … ]`
    while( i < ts.length )
    {
        if( MEMBER_ACCESS.has( ts[i].text ) && ts[i + 1]?.kind === "ident" ) { i += 2; continue; }
        if( ts[i].text === "[" ) {
            let depth = 0;
            for( ; i < ts.length; i++ ) {
                if( ts[i].text === "[" ) depth++;
                else if( ts[i].text === "]" && --depth === 0 ) break;
            }
            i++;
            continue;
        }
        break;
    }
    const op = ts[i];
    return op !== undefined && op.kind === "punct" && ( ASSIGNMENT_OPERATORS.has( op.text ) || op.text === "++" || op.text === "--" );
}

/** variables assigned anywhere in the statement (the root of a member path for `x.f = …`) */
function assignedNames( ts: ReplToken[] ): string[]
{
    const names = new Set<string>();
    for( let i = 0; i < ts.length; i++ )
    {
        const t = ts[i];
        if( t.kind !== "ident" ) continue;
        const prev = ts[i - 1];
        if( prev !== undefined && ( MEMBER_ACCESS.has( prev.text ) || prev.text === "let" || prev.text === "const" || prev.text === "var" ) ) continue;
        if( prev !== undefined && ( prev.text === "++" || prev.text === "--" ) ) { names.add( t.text ); continue; }
        // skip a member path
        let j = i + 1;
        while( j < ts.length && MEMBER_ACCESS.has( ts[j].text ) && ts[j + 1]?.kind === "ident" ) j += 2;
        const op = ts[j];
        if( op?.kind === "punct" && ( ASSIGNMENT_OPERATORS.has( op.text ) || op.text === "++" || op.text === "--" ) ) names.add( t.text );
    }
    return [ ...names ];
}

/** identifiers that are not members (`x.name`); keywords included, which is harmless */
function usedNames( ts: ReplToken[] ): string[]
{
    const names = new Set<string>();
    for( let i = 0; i < ts.length; i++ )
    {
        if( ts[i].kind !== "ident" ) continue;
        if( i > 0 && MEMBER_ACCESS.has( ts[i - 1].text ) ) continue;
        names.add( ts[i].text );
    }
    return [ ...names ];
}
