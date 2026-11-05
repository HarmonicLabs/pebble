import { Source, SourceKind } from "../ast/Source/Source";
import { DiagnosticMessage } from "../diagnostics/DiagnosticMessage";
import { CharCode } from "../utils/CharCode";
import { Token } from "./Token";
import { Tokenizer } from "./Tokenizer";

export interface TokenInfo {
    kind: Token;
    /** offset of the first character */
    start: number;
    /** offset after the last character */
    end: number;
}

/**
 * The tokens of `text` in order, read the way the parser reads them, for tools that look at the
 * text around a position (an editor's completion after a `.`, the call around the cursor).
 *
 * Comments and whitespace are not tokens. A template literal is one `StringTemplateLiteralQuote`
 * per fragment (`` `a${ ``, `` }b` ``), with the tokens of its expressions in between. Text that
 * does not tokenize (an invalid character) is left out: the parser reports it, this reports
 * nothing.
 */
export function tokenize( text: string ): TokenInfo[]
{
    const diagnostics: DiagnosticMessage[] = [];
    const tn = new Tokenizer( new Source( SourceKind.User, "", "", text ), diagnostics );
    const tokens: TokenInfo[] = [];
    // for each template literal open around the position, how many `{` its `${...}` has open
    const openBraces: number[] = [];
    while( true )
    {
        const kind = tn.next();
        if( kind === Token.EndOfFile ) break;
        const start = tn.tokenPos;
        switch( kind )
        {
            case Token.Identifier: tn.readIdentifier(); break;
            case Token.StringLiteral: tn.readString(); break;
            case Token.IntegerLiteral: tn.readInteger(); break;
            case Token.HexBytesLiteral: tn.readHexBytes(); break;
            case Token.StringTemplateLiteralQuote: {
                // up to the closing backtick, or to a `${`
                tn.readString();
                if( tn.readingTemplateString ) openBraces.push( 0 );
                break;
            }
            case Token.OpenBrace: {
                if( openBraces.length > 0 ) openBraces[ openBraces.length - 1 ]++;
                break;
            }
            case Token.CloseBrace: {
                if( openBraces.length === 0 ) break;
                if( openBraces[ openBraces.length - 1 ] > 0 )
                {
                    openBraces[ openBraces.length - 1 ]--;
                    break;
                }
                // closes a `${`: the template goes on, from this `}`
                tn.readString( CharCode.Backtick );
                tokens.push({ kind: Token.StringTemplateLiteralQuote, start, end: tn.pos });
                if( !tn.readingTemplateString ) openBraces.pop();
                continue;
            }
        }
        tokens.push({ kind, start, end: tn.pos });
    }
    return tokens;
}
