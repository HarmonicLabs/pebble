import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import {
    Compiler,
    createMemoryCompilerIoApi,
    defaultOptions,
    fromUtf8,
    toHex,
    ConstTyTag,
    constTypeToStirng,
} from "@harmoniclabs/pebble";

function formatCEKValue(val: any): string
{
    if( val.tag === 5 /* CEKValueTag.Error */ )
    {
        return chalk.red("error") + (val.msg ? `: ${val.msg}` : "");
    }
    if( val.tag === 0 /* CEKValueTag.Const */ )
    {
        switch( val.typeTag )
        {
            case ConstTyTag.unit: return chalk.blue("void");
            case ConstTyTag.int: return chalk.yellow(val.value!.toString());
            case ConstTyTag.bool: return chalk.blue(val.value ? "true" : "false");
            case ConstTyTag.str: return chalk.green(`"${val.value}"`);
            case ConstTyTag.byteStr: return chalk.cyan(`#${toHex(val.value as Uint8Array)}`);
            case ConstTyTag.data: return `(data ${JSON.stringify(val.value)})`;
            case ConstTyTag.list:
            case ConstTyTag.pair:
            default:
                return `(${constTypeToStirng(val.type)} ${JSON.stringify(val.value, (_k: string, v: any) => typeof v === "bigint" ? v.toString() : v)})`;
        }
    }
    if( val.tag === 3 /* CEKValueTag.Constr */ )
    {
        const fields = val.values.map(formatCEKValue).join(", ");
        return `Constr ${val.index}${fields ? ` [${fields}]` : ""}`;
    }
    return "(lambda)";
}

// keywords that produce declarations to accumulate across REPL lines
const _accumKeywords = new Set([
    "const", "let", "var",
    "function",
    "struct", "enum", "type", "interface",
    "data", "contract", "runtime",
    "import", "export",
]);

// all keywords that start statements (accumulated or not)
const _allKeywords = new Set([
    ..._accumKeywords,
    "for", "while", "if", "match",
    "return", "break", "continue", "using",
    "trace", "assert", "fail", "test",
]);

function _readFirstWord( text: string ): string
{
    const m = text.match( /^([a-zA-Z_]\w*)/ );
    return m ? m[1] : "";
}

interface ContextEntry { key: string; src: string }

/**
 * extracts the declared name from a declaration statement
 * to use as the context key. returns undefined if not detectable.
 */
function _extractDeclKey( firstWord: string, input: string ): string | undefined
{
    let m: RegExpMatchArray | null;

    switch( firstWord )
    {
        case "const":
        case "let":
        case "var":
            m = input.match( /^(?:const|let|var)\s+(\w+)/ );
            return m ? "var:" + m[1] : undefined;

        case "function":
            m = input.match( /^function\s+(\w+)/ );
            return m ? "fn:" + m[1] : undefined;

        case "struct":
        case "enum":
        case "type":
        case "interface":
            m = input.match( /^(?:struct|enum|type|interface)\s+(\w+)/ );
            return m ? "type:" + m[1] : undefined;

        case "data":
            m = input.match( /^data\s+(?:struct|enum)?\s*(\w+)/ );
            return m ? "type:" + m[1] : undefined;

        case "contract":
        case "runtime":
            m = input.match( /^(?:contract|runtime)\s+(\w+)/ );
            return m ? "type:" + m[1] : undefined;

        case "import":
            return "import:" + input;

        case "export":
            // export function foo / export struct Foo / etc.
            m = input.match( /^export\s+(?:function|struct|enum|type|interface|data|contract|runtime)\s+(\w+)/ );
            if( m ) return "decl:" + m[1];
            // export const / let / var
            m = input.match( /^export\s+(?:const|let|var)\s+(\w+)/ );
            if( m ) return "var:" + m[1];
            return "export:" + input;
    }
    return undefined;
}

/**
 * ensures a statement source ends with a semicolon
 * (unless it ends with a closing brace, which is self-terminating).
 */
function _ensureSemicolon( src: string ): string
{
    const trimmed = src.trimEnd();
    if( trimmed.endsWith(";") || trimmed.endsWith("}") ) return trimmed;
    return trimmed + ";";
}

/**
 * counts unmatched braces, parens, and brackets in text,
 * respecting string literals and comments.
 * returns > 0 if there are unclosed delimiters.
 */
function _unclosedDepth( text: string ): number
{
    let depth = 0;
    const len = text.length;
    let pos = 0;

    while( pos < len )
    {
        const ch = text.charCodeAt( pos );

        // single-line comment
        if( ch === 0x2F && pos + 1 < len && text.charCodeAt( pos + 1 ) === 0x2F )
        {
            pos += 2;
            while( pos < len && text.charCodeAt( pos ) !== 0x0A ) pos++;
            continue;
        }
        // multi-line comment
        if( ch === 0x2F && pos + 1 < len && text.charCodeAt( pos + 1 ) === 0x2A )
        {
            pos += 2;
            while( pos < len && !( text.charCodeAt( pos ) === 0x2A && pos + 1 < len && text.charCodeAt( pos + 1 ) === 0x2F ) ) pos++;
            pos += 2;
            continue;
        }
        // string literals
        if( ch === 0x22 || ch === 0x27 || ch === 0x60 )
        {
            pos++;
            while( pos < len )
            {
                const sc = text.charCodeAt( pos );
                if( sc === 0x5C ) { pos += 2; continue; }
                if( sc === ch ) { pos++; break; }
                pos++;
            }
            continue;
        }

        if( ch === 0x28 || ch === 0x5B || ch === 0x7B ) depth++;
        else if( ch === 0x29 || ch === 0x5D || ch === 0x7D ) depth--;

        pos++;
    }

    return depth;
}

/**
 * ordered context: entries preserve insertion order,
 * and re-declarations replace at the original position.
 */
class ReplContext
{
    private entries: ContextEntry[] = [];

    set( key: string, src: string ): void
    {
        const idx = this.entries.findIndex( e => e.key === key );
        if( idx >= 0 ) this.entries[idx] = { key, src };
        else this.entries.push({ key, src });
    }

    get( key: string ): string | undefined
    {
        return this.entries.find( e => e.key === key )?.src;
    }

    has( key: string ): boolean
    {
        return this.entries.some( e => e.key === key );
    }

    toSource(): string
    {
        return this.entries.map( e => e.src ).join( "\n" );
    }

    snapshot(): ContextEntry[]
    {
        return this.entries.map( e => ({ ...e }) );
    }

    restoreSnapshot( snap: ContextEntry[] ): void
    {
        this.entries = snap;
    }
}

export async function pebbleRepl(): Promise<void>
{
    const rl = readline.createInterface({ input: stdin, output: stdout });

    console.log(chalk.bold("Pebble REPL"));
    console.log("Type pebble expressions to evaluate them. Use :quit to exit.\n");

    const entryFile = "__repl__.pebble";
    const context = new ReplContext();

    while( true )
    {
        let input: string;
        try {
            input = await rl.question(chalk.blue("pebble> "));
        }
        catch {
            // EOF (ctrl+D)
            break;
        }

        const trimmed = input.trim();
        if( !trimmed ) continue;
        if( trimmed === ":quit" || trimmed === ":q" || trimmed === ":exit" )
        {
            break;
        }

        // multi-line: keep reading if delimiters are unclosed
        let fullInput = trimmed;
        while( _unclosedDepth( fullInput ) > 0 )
        {
            let cont: string;
            try {
                cont = await rl.question(chalk.blue("  ...> "));
            }
            catch {
                break;
            }
            fullInput += "\n" + cont;
        }

        // classify: keyword-first → statement, otherwise → expression
        const firstWord = _readFirstWord( fullInput );
        const isAccum = _accumKeywords.has( firstWord );

        // detect reassignment: <name> = <expr> where <name> is a known variable
        let isReassignment = false;
        let reassignName = "";
        if( !isAccum )
        {
            const reassignMatch = fullInput.match( /^(\w+)\s*=\s/ );
            if( reassignMatch && context.has( "var:" + reassignMatch[1] ) )
            {
                isReassignment = true;
                reassignName = reassignMatch[1];
            }
        }

        // save a snapshot so we can restore on failure
        const snapshot = context.snapshot();

        if( isAccum )
        {
            // it's a declaration — accumulate in context
            const key = _extractDeclKey( firstWord, fullInput );
            if( key )
            {
                context.set( key, _ensureSemicolon( fullInput ) );
            }
        }
        else if( isReassignment )
        {
            // append the assignment to the variable's context entry
            const key = "var:" + reassignName;
            const existing = context.get( key )!;
            context.set( key, existing + "\n" + _ensureSemicolon( fullInput ) );
        }

        // build the full source
        const contextSrc = context.toSource();
        let fullSrc: string;

        if( isAccum )
        {
            // declarations are already in context; no extra body needed
            fullSrc = contextSrc;
        }
        else if( isReassignment )
        {
            // assignment is in context; append variable name to return new value
            fullSrc = contextSrc + "\n" + reassignName;
        }
        else
        {
            // expression or transient statement — append after context
            fullSrc = contextSrc
                ? contextSrc + "\n" + fullInput
                : fullInput;
        }

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [entryFile, fromUtf8(fullSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, {
            ...defaultOptions,
            silent: true,
        });

        try
        {
            const { result, budgetSpent, logs } = await compiler.runRepl({
                entry: entryFile,
                root: "/",
            });

            for( const log of logs )
            {
                console.log(chalk.magenta("trace:"), log);
            }

            console.log(formatCEKValue(result));

            console.log(
                chalk.dim(`cpu: ${budgetSpent.cpu} | mem: ${budgetSpent.mem}`)
            );
        }
        catch( e: any )
        {
            // restore context on failure
            context.restoreSnapshot( snapshot );

            const diagnostics = compiler.diagnostics;
            if( diagnostics.length > 0 )
            {
                for( const d of diagnostics )
                {
                    console.error(chalk.red(String(d)));
                }
            }
            else
            {
                console.error(chalk.red(e?.message ?? String(e)));
            }
        }
    }

    rl.close();
    console.log("\nBye!");
}
