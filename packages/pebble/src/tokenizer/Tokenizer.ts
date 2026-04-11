import { Source } from "../ast/Source/Source";
import { SourceRange } from "../ast/Source/SourceRange";
import { DiagnosticEmitter } from "../diagnostics/DiagnosticEmitter";
import { DiagnosticMessage } from "../diagnostics/DiagnosticMessage";
import { DiagnosticCode } from "../diagnostics/diagnosticMessages.generated";
import { assert } from "../utils/assert";
import { CharCode } from "../utils/CharCode";
import { isHighSurrogate, combineSurrogates, isIdentifierStart, numCodeUnits, isIdentifierPart, isWhiteSpace, isLineBreak, isDecimal, isOctal, isHexBase, isHexOrDecimal } from "../utils/text";
import { IdentifierHandling } from "./IdentifierHandling";
import { OnNewLine } from "./OnNewLine";
import { Token } from "./Token";
import { tokenFromKeyword } from "./utils/tokenFromKeyword";
import { tokenIsAlsoIdentifier } from "./utils/tokenIsAlsoIdentifier";
import { fromHex } from "@harmoniclabs/uint8array-utils";

/** Comment kinds. */
export enum CommentKind {
    /** Line comment. */
    Line,
    /** Triple-slash line comment. */
    Triple,
    /** Block comment. */
    Block
}
Object.freeze(CommentKind);

export type CommentHandler = (kind: CommentKind, text: string, range: SourceRange) => void;

const fakeToken: Token = -1 as Token;

/**
 * Takes a {@link Source} and tokenizes its contents.
 * 
 * It acts as an iterator, so that the text is never broken down
 * but we can still get out single tokens.
**/
export class Tokenizer extends DiagnosticEmitter {

    source: Source;
    end: number = 0;

    // tokenizer state ( pos, token, tokenPos )
    pos: number = 0;
    token: Token = fakeToken;
    tokenPos: number = 0;

    // next token state ( nextToken, nextTokenPos, nextTokenOnNewLine )
    nextToken: Token = fakeToken;
    nextTokenPos: number = 0;

    // cache result of `isNextTokenOnNewLine`
    nextTokenOnNewLine: OnNewLine = OnNewLine.Unknown;

    // custom comment handling
    onComment: CommentHandler | undefined = undefined;

    constructor(
        source: Source,
        diagnostics: DiagnosticMessage[] | undefined = undefined
    ) {
        super(diagnostics);

        if (!Array.isArray(diagnostics)) diagnostics = [];
        this.diagnostics = diagnostics;
        this.source = source;

        let text = source.text;
        let end = text.length;
        let pos = 0;
        
        // skip bom
        if (
            pos < end &&
            text.charCodeAt(pos) === CharCode.ByteOrderMark
        ) {
            ++pos;
        }

        // skip shebang
        if (
            pos + 1 < end &&
            text.charCodeAt(pos) === CharCode.Hash &&
            text.charCodeAt(pos + 1) === CharCode.Exclamation
        ) {
            pos += 2;
            while (
                pos < end &&
                text.charCodeAt(pos) !== CharCode.LineFeed
            ) {
                ++pos;
            }
            // 'next' now starts at lf or eof
        }
        this.pos = pos;
        this.end = end;
    }

    /*
    toArray(): Token[] {
        let tokens = new Array<Token>();
        let token: Token;
        while ((token = this.next()) !== Token.EndOfFile) {
            if( token === Token.Identifier ) this.readIdentifier();
            if( token === Token.IntegerLiteral ) this.readInteger();

            tokens.push( token );
        }
        return tokens;
    }
    */

    /** advances the tokenizer and returns the new token */
    next(identifierHandling: IdentifierHandling = IdentifierHandling.Default): Token {
        this.clearNextToken();

        let token: Token;
        do token = this.unsafeNext(identifierHandling);
        while (token === Token.Invalid);

        this.token = token;
        return token;
    }

    /**
     * Retrieves the next token from the source text,
     * handling identifiers and token length.
     * This method is considered unsafe because 
     * it does not perform validation on the token.
     * 
     * @param identifierHandling - Specifies how identifiers should be handled.
     * 
     * @param maxTokenLength - The maximum length of the token to retrieve.
     * Defaults to Number.MAX_SAFE_INTEGER.
     * 
     * @returns The next token from the source text.
     */
    private unsafeNext(
        identifierHandling: IdentifierHandling = IdentifierHandling.Default,
        maxTokenLength: number = Number.MAX_SAFE_INTEGER
    ): Token {
        let text = this.source.text;
        let end = this.end;
        let pos = this.pos;
        while (pos < end) {
            this.tokenPos = pos;
            let c = text.charCodeAt(pos);
            switch (c) {
                case CharCode.CarriageReturn: {
                    if (!(
                        ++pos < end &&
                        text.charCodeAt(pos) === CharCode.LineFeed
                    )) break;
                    // otherwise fall-through
                }
                case CharCode.LineFeed:
                case CharCode.Tab:
                case CharCode.VerticalTab:
                case CharCode.FormFeed:
                case CharCode.Space: {
                    ++pos;
                    break;
                }
                case CharCode.Exclamation: {
                    ++pos;
                    if (
                        maxTokenLength > 1 && pos < end &&
                        text.charCodeAt(pos) === CharCode.Equals
                    ) {
                        ++pos;
                        if (
                            maxTokenLength > 2 && pos < end &&
                            text.charCodeAt(pos) === CharCode.Equals
                        ) {
                            this.pos = pos + 1;
                            return Token.Exclamation_Equals_Equals;
                        }
                        this.pos = pos;
                        return Token.Exclamation_Equals;
                    }
                    else if(
                        maxTokenLength > 1 && pos < end &&
                        text.charCodeAt(pos) === CharCode.Dot
                    ) {
                        this.pos = pos + 1;
                        return Token.Exclamation_Dot; // !.
                    }
                    this.pos = pos;
                    return Token.Exclamation;
                }
                case CharCode.DoubleQuote:
                case CharCode.SingleQuote: {
                    this.pos = pos;
                    return Token.StringLiteral;
                }
                case CharCode.Backtick: {
                    this.pos = pos;
                    return Token.StringTemplateLiteralQuote;
                }
                case CharCode.Percent: {
                    ++pos;
                    if (
                        maxTokenLength > 1 && pos < end &&
                        text.charCodeAt(pos) === CharCode.Equals
                    ) {
                        this.pos = pos + 1;
                        return Token.Percent_Equals;
                    }
                    this.pos = pos;
                    return Token.Percent;
                }
                case CharCode.Ampersand: {
                    ++pos;
                    if (maxTokenLength > 1 && pos < end) {
                        let chr = text.charCodeAt(pos);
                        if (chr === CharCode.Ampersand) {
                            // this.pos = pos + 1;
                            ++pos;
                            if(
                                maxTokenLength > 2 && pos < end &&
                                text.charCodeAt(pos) === CharCode.Equals
                            )
                            {
                                this.pos = pos + 1;
                                return Token.Ampersand_Ampersand_Equals;
                            }
                            this.pos = pos;
                            return Token.Ampersand_Ampersand;
                        }
                        if (chr === CharCode.Equals) {
                            this.pos = pos + 1;
                            return Token.Ampersand_Equals;
                        }
                    }
                    this.pos = pos;
                    return Token.Ampersand;
                }
                case CharCode.OpenParen: {
                    this.pos = pos + 1;
                    return Token.OpenParen;
                }
                case CharCode.CloseParen: {
                    this.pos = pos + 1;
                    return Token.CloseParen;
                }
                case CharCode.Asterisk: {
                    ++pos;
                    if (maxTokenLength > 1 && pos < end) {
                        let chr = text.charCodeAt(pos);
                        if (chr === CharCode.Equals) {
                            this.pos = pos + 1;
                            return Token.Asterisk_Equals;
                        }
                        if (chr === CharCode.Asterisk) {
                            ++pos;
                            if (
                                maxTokenLength > 2 && pos < end &&
                                text.charCodeAt(pos) === CharCode.Equals
                            ) {
                                this.pos = pos + 1;
                                return Token.Asterisk_Asterisk_Equals;
                            }
                            this.pos = pos;
                            return Token.Asterisk_Asterisk;
                        }
                    }
                    this.pos = pos;
                    return Token.Asterisk;
                }
                case CharCode.Plus: {
                    ++pos;
                    if (maxTokenLength > 1 && pos < end) {
                        let chr = text.charCodeAt(pos);
                        if (chr === CharCode.Plus) {
                            this.pos = pos + 1;
                            return Token.Plus_Plus;
                        }
                        if (chr === CharCode.Equals) {
                            this.pos = pos + 1;
                            return Token.Plus_Equals;
                        }
                    }
                    this.pos = pos;
                    return Token.Plus;
                }
                case CharCode.Comma: {
                    this.pos = pos + 1;
                    return Token.Comma;
                }
                case CharCode.Minus: {
                    ++pos;
                    if (maxTokenLength > 1 && pos < end) {
                        let chr = text.charCodeAt(pos);
                        if (chr === CharCode.Minus) {
                            this.pos = pos + 1;
                            return Token.Minus_Minus;
                        }
                        if (chr === CharCode.Equals) {
                            this.pos = pos + 1;
                            return Token.Minus_Equals;
                        }
                    }
                    this.pos = pos;
                    return Token.Minus;
                }
                case CharCode.Dot: {
                    ++pos;
                    if (maxTokenLength > 1 && pos < end) {
                        let chr = text.charCodeAt(pos);
                        // if (isDecimal(chr)) {
                        //     this.pos = pos - 1;
                        //     return Token.FloatLiteral; // expects a call to readFloat
                        // }
                        if (
                            maxTokenLength > 2 && pos + 1 < end &&
                            chr === CharCode.Dot &&
                            text.charCodeAt(pos + 1) === CharCode.Dot
                        ) {
                            this.pos = pos + 2;
                            return Token.Dot_Dot_Dot;
                        }
                    }
                    this.pos = pos;
                    return Token.Dot;
                }
                case CharCode.Slash: {
                    let commentStartPos = pos;
                    ++pos;
                    if (maxTokenLength > 1 && pos < end) {
                        let chr = text.charCodeAt(pos);
                        if (chr === CharCode.Slash) { // single-line
                            let commentKind = CommentKind.Line;
                            if (
                                pos + 1 < end &&
                                text.charCodeAt(pos + 1) === CharCode.Slash
                            ) {
                                ++pos;
                                commentKind = CommentKind.Triple;
                            }
                            while (++pos < end) {
                                if (text.charCodeAt(pos) === CharCode.LineFeed) {
                                    ++pos;
                                    break;
                                }
                            }
                            if (this.onComment) {
                                this.onComment(
                                    commentKind,
                                    text.substring(commentStartPos, pos),
                                    this.range(commentStartPos, pos)
                                );
                            }
                            break;
                        }
                        if (chr === CharCode.Asterisk) { // multi-line
                            let closed = false;
                            while (++pos < end) {
                                c = text.charCodeAt(pos);
                                if (
                                    c === CharCode.Asterisk &&
                                    pos + 1 < end &&
                                    text.charCodeAt(pos + 1) === CharCode.Slash
                                ) {
                                    pos += 2;
                                    closed = true;
                                    break;
                                }
                            }
                            if (!closed) {
                                this.error(
                                    DiagnosticCode._0_expected,
                                    this.range(pos), "*/"
                                );
                            } else if (this.onComment) {
                                this.onComment(
                                    CommentKind.Block,
                                    text.substring(commentStartPos, pos),
                                    this.range(commentStartPos, pos)
                                );
                            }
                            break;
                        }
                        if (chr === CharCode.Equals) {
                            this.pos = pos + 1;
                            return Token.Slash_Equals;
                        }
                    }
                    this.pos = pos;
                    return Token.Slash;
                }
                case CharCode._0:
                case CharCode._1:
                case CharCode._2:
                case CharCode._3:
                case CharCode._4:
                case CharCode._5:
                case CharCode._6:
                case CharCode._7:
                case CharCode._8:
                case CharCode._9: {
                    this.pos = pos;
                    if( !this.testInteger() )
                    {}
                    return Token.IntegerLiteral;
                    // return this.testInteger()
                    //     ? Token.IntegerLiteral // expects a call to readInteger
                    //     : Token.FloatLiteral;  // expects a call to readFloat
                }
                case CharCode.Hash: {
                    this.pos = pos;
                    return Token.HexBytesLiteral;
                    break;
                }
                case CharCode.Colon: {
                    this.pos = pos + 1;
                    return Token.Colon;
                }
                case CharCode.Semicolon: {
                    this.pos = pos + 1;
                    return Token.Semicolon;
                }
                case CharCode.LessThan: {
                    ++pos;
                    if (maxTokenLength > 1 && pos < end) {
                        let chr = text.charCodeAt(pos);
                        if (chr === CharCode.LessThan) {
                            ++pos;
                            if (
                                maxTokenLength > 2 &&
                                pos < end &&
                                text.charCodeAt(pos) === CharCode.Equals
                            ) {
                                this.pos = pos + 1;
                                return Token.LessThan_LessThan_Equals;
                            }
                            this.pos = pos;
                            return Token.LessThan_LessThan;
                        }
                        if (chr === CharCode.Equals) {
                            this.pos = pos + 1;
                            return Token.LessThan_Equals;
                        }
                    }
                    this.pos = pos;
                    return Token.LessThan;
                }
                case CharCode.Equals: {
                    ++pos;
                    if (maxTokenLength > 1 && pos < end) {
                        let chr = text.charCodeAt(pos);
                        if (chr === CharCode.Equals) {
                            ++pos;
                            if (
                                maxTokenLength > 2 &&
                                pos < end &&
                                text.charCodeAt(pos) === CharCode.Equals
                            ) {
                                this.pos = pos + 1;
                                return Token.Equals_Equals_Equals;
                            }
                            this.pos = pos;
                            return Token.Equals_Equals;
                        }
                        if (chr === CharCode.GreaterThan) {
                            this.pos = pos + 1;
                            return Token.FatArrow;
                        }
                    }
                    this.pos = pos;
                    return Token.Equals;
                }
                case CharCode.GreaterThan: {
                    ++pos;
                    if (maxTokenLength > 1 && pos < end) {
                        let chr = text.charCodeAt(pos);
                        if (chr === CharCode.GreaterThan) {
                            ++pos;
                            if (maxTokenLength > 2 && pos < end) {
                                chr = text.charCodeAt(pos);
                                if (chr === CharCode.GreaterThan) {
                                    ++pos;
                                    if (
                                        maxTokenLength > 3 && pos < end &&
                                        text.charCodeAt(pos) === CharCode.Equals
                                    ) {
                                        this.pos = pos + 1;
                                        return Token.GreaterThan_GreaterThan_GreaterThan_Equals;
                                    }
                                    this.pos = pos;
                                    return Token.GreaterThan_GreaterThan_GreaterThan;
                                }
                                if (chr === CharCode.Equals) {
                                    this.pos = pos + 1;
                                    return Token.GreaterThan_GreaterThan_Equals;
                                }
                            }
                            this.pos = pos;
                            return Token.GreaterThan_GreaterThan;
                        }
                        if (chr === CharCode.Equals) {
                            this.pos = pos + 1;
                            return Token.GreaterThan_Equals;
                        }
                    }
                    this.pos = pos;
                    return Token.GreaterThan;
                }
                case CharCode.Question: {
                    // this.pos = pos + 1;
                    pos++;
                    if(
                        maxTokenLength > 1 && pos < end &&
                        text.charCodeAt(pos) === CharCode.Question
                    )
                    {
                        pos++;
                        if(
                            maxTokenLength > 2 && pos < end &&
                            text.charCodeAt(pos) === CharCode.Equals
                        )
                        {
                            this.pos = pos + 1;
                            return Token.Question_Question_Equals;
                        }
                        this.pos = pos;
                        return Token.Question_Question;
                    }
                    else if( text.charCodeAt(pos) === CharCode.Dot )
                    {
                        this.pos = pos + 1;
                        return Token.Question_Dot;
                    }
                    this.pos = pos;
                    return Token.Question;
                }
                case CharCode.OpenBracket: {
                    this.pos = pos + 1;
                    return Token.OpenBracket;
                }
                case CharCode.CloseBracket: {
                    this.pos = pos + 1;
                    return Token.CloseBracket;
                }
                case CharCode.Caret: {
                    ++pos;
                    if (
                        maxTokenLength > 1 && pos < end &&
                        text.charCodeAt(pos) === CharCode.Equals
                    ) {
                        this.pos = pos + 1;
                        return Token.Caret_Equals;
                    }
                    this.pos = pos;
                    return Token.Caret;
                }
                case CharCode.OpenBrace: {
                    this.pos = pos + 1;
                    return Token.OpenBrace;
                }
                case CharCode.Bar: {
                    ++pos;
                    if (maxTokenLength > 1 && pos < end) {
                        let chr = text.charCodeAt(pos);
                        if (chr === CharCode.Bar) {
                            // this.pos = pos + 1;
                            ++pos;
                            if (
                                maxTokenLength > 2 && pos < end &&
                                text.charCodeAt(pos) === CharCode.Equals
                            ) {
                                this.pos = pos + 1;
                                return Token.Bar_Bar_Equals;
                            }
                            this.pos = pos;
                            return Token.Bar_Bar;
                        }
                        if (chr === CharCode.Equals) {
                            this.pos = pos + 1;
                            return Token.Bar_Equals;
                        }
                    }
                    this.pos = pos;
                    return Token.Bar;
                }
                case CharCode.CloseBrace: {
                    this.pos = pos + 1;
                    return Token.CloseBrace;
                }
                case CharCode.Tilde: {
                    this.pos = pos + 1;
                    return Token.Tilde;
                }
                case CharCode.At: {
                    this.pos = pos + 1;
                    return Token.At;
                }
                default: {
                    // Unicode-aware from here on
                    if (isHighSurrogate(c) && pos + 1 < end) {
                        c = combineSurrogates(c, text.charCodeAt(pos + 1));
                    }
                    if (isIdentifierStart(c)) {
                        let posBefore = pos;
                        while (
                            (pos += numCodeUnits(c)) < end &&
                            isIdentifierPart(c = <number>text.codePointAt(pos))
                        ) { /* nop */ }
                        if (identifierHandling !== IdentifierHandling.Always) {
                            let maybeKeywordToken = tokenFromKeyword(text.substring(posBefore, pos));
                            if (
                                maybeKeywordToken !== Token.Invalid &&
                                !(
                                    identifierHandling === IdentifierHandling.Prefer &&
                                    tokenIsAlsoIdentifier(maybeKeywordToken)
                                )
                            ) {
                                this.pos = pos;
                                return maybeKeywordToken;
                            }
                        }
                        this.pos = posBefore;
                        return Token.Identifier;
                    } else if (isWhiteSpace(c)) {
                        ++pos; // assume no supplementary whitespaces
                        break;
                    }
                    let start = pos;
                    pos += numCodeUnits(c);
                    this.error(
                        DiagnosticCode.Invalid_character,
                        this.range(start, pos)
                    );
                    this.pos = pos;
                    return Token.Invalid;
                }
            }
        }
        this.pos = pos;
        return Token.EndOfFile;
    }

    peek(
        identifierHandling: IdentifierHandling = IdentifierHandling.Default,
        maxCompoundLength: number = Number.MAX_SAFE_INTEGER
    ): Token {
        let nextToken = this.nextToken;
        if (nextToken < 0) {
            // save current state
            let posBefore = this.pos;
            let tokenBefore = this.token;
            let tokenPosBefore = this.tokenPos;

            // take next valid token (modifies state)
            do nextToken = this.unsafeNext(identifierHandling, maxCompoundLength);
            while (nextToken === Token.Invalid);

            // save next token
            this.nextToken = nextToken;
            this.nextTokenPos = this.tokenPos;
            this.nextTokenOnNewLine = OnNewLine.Unknown;

            // restore current state
            this.pos = posBefore;
            this.token = tokenBefore;
            this.tokenPos = tokenPosBefore;
        }
        return nextToken;
    }

    isNextTokenOnNewLine(): boolean {
        switch (this.nextTokenOnNewLine) {
            case OnNewLine.No: return false;
            case OnNewLine.Yes: return true;
        }
        // case OnNewLine.Unknown
        this.peek();
        let text = this.source.text;
        for (let pos = this.pos, end = this.nextTokenPos; pos < end; ++pos) {
            if (isLineBreak(text.charCodeAt(pos))) {
                this.nextTokenOnNewLine = OnNewLine.Yes;
                return true;
            }
        }
        this.nextTokenOnNewLine = OnNewLine.No;
        return false;
    }

    skipIdentifier(identifierHandling: IdentifierHandling = IdentifierHandling.Prefer): boolean {
        return this.skip(Token.Identifier, identifierHandling);
    }

    /**
     * 
     * @param expectedToken The token type that the tokenizer should skip if it matches the current token.
     * @param identifierHandling 
     * @returns {boolean} Returns true if the current token matches the expectedToken and the tokenizer's position is advanced.
     * Returns false if the current token does not match the expectedToken.
     * 
     * ### side effects
     * 
     * - Advances the Tokenizer Position: 
     * If the current token matches the expectedToken, 
     * the tokenizer's position is advanced to the next token.
     * 
     * - Updates Internal State: 
     * The method updates the internal state of the tokenizer, 
     * including the current token and its position.
     * 
     */
    skip(expectedToken: Token, identifierHandling: IdentifierHandling = IdentifierHandling.Default): boolean {
        let posBefore = this.pos;
        let tokenBefore = this.token;
        let tokenPosBefore = this.tokenPos;
        let maxCompoundLength = Number.MAX_SAFE_INTEGER;

        if (expectedToken === Token.GreaterThan) {  // where parsing type arguments
            maxCompoundLength = 1;
        }

        // take the first valid token
        let nextToken: Token;
        do nextToken = this.unsafeNext(identifierHandling, maxCompoundLength);
        while (nextToken === Token.Invalid);

        if (nextToken === expectedToken) {
            this.token = expectedToken;
            this.clearNextToken();
            return true;
        } else {
            this.pos = posBefore;
            this.token = tokenBefore;
            this.tokenPos = tokenPosBefore;
            return false;
        }
    }

    eof() {
        return this.skip(Token.EndOfFile);
    }

    // state management

    /** #__PURE__ gets the current state */
    mark(): TokenizerState {
        // let state = reusableState;
        // if (state) {
        //     reusableState = undefined;
        //     state.pos = this.pos;
        //     state.token = this.token;
        //     state.tokenPos = this.tokenPos;
        // } else {
        //     state = new TokenizerState(this.pos, this.token, this.tokenPos);
        // }
        return new TokenizerState(this.pos, this.token, this.tokenPos);
    }

    // discard(state: TokenizerState): void {
    //     reusableState = state;
    // }

    reset(state: TokenizerState): void {
        this.pos = state.pos;
        this.token = state.token;
        this.tokenPos = state.tokenPos;
        this.clearNextToken();
    }

    /**
     * ### Side Effects
     * - Resets `nextToken`: Sets the nextToken property to an invalid state, typically -1.
     * - Resets `nextTokenPos`: Sets the nextTokenPos property to 0 or another default value.
     * - Resets `nextTokenOnNewLine`: Sets the nextTokenOnNewLine property to OnNewLine.
     * Unknown or another default value.
     */
    clearNextToken(): void {
        this.nextToken = fakeToken;
        this.nextTokenPos = 0;
        this.nextTokenOnNewLine = OnNewLine.Unknown;
    }

    /**
     * pure function for the same state
    **/
    range(start: number = -1, end: number = -1): SourceRange {
        if (start < 0) { // default range
            start = this.tokenPos;
            end = this.pos;
        } else if (end < 0) {
            end = start;
        }
        return new SourceRange(this.source, start, end);
    }

    readIdentifier(): string {
        let text = this.source.text;
        let end = this.end;
        let pos = this.pos;
        let start = pos;
        let c = <number>text.codePointAt(pos);
        assert(isIdentifierStart(c), "token is not an identifier");
        while (
            (pos += numCodeUnits(c)) < end &&
            isIdentifierPart(c = <number>text.codePointAt(pos))
        );
        this.pos = pos;
        return text.substring(start, pos);
    }

    readingTemplateString: boolean = false;
    readStringStart: number = 0;
    readStringEnd: number = 0;

    readString(quote: number = 0, isTaggedTemplate: boolean = false): string {
        let text = this.source.text;
        let end = this.end;
        let pos = this.pos;
        if (!quote) quote = text.charCodeAt(pos++);
        let start = pos;
        this.readStringStart = start;
        let result = "";

        while (true) {
            if (pos >= end) {
                result += text.substring(start, pos);
                this.error(
                    DiagnosticCode.Unterminated_string_literal,
                    this.range(start - 1, end)
                );
                this.readStringEnd = end;
                break;
            }
            let c = text.charCodeAt(pos);
            if (c === quote) {
                this.readStringEnd = pos;
                result += text.substring(start, pos++);
                break;
            }
            if (c === CharCode.Backslash) {
                result += text.substring(start, pos);
                this.pos = pos; // save
                result += this.readEscapeSequence(isTaggedTemplate);
                pos = this.pos; // restore
                start = pos;
                continue;
            }
            if (quote === CharCode.Backtick) {
                if (c === CharCode.Dollar && pos + 1 < end && text.charCodeAt(pos + 1) === CharCode.OpenBrace) {
                    result += text.substring(start, pos);
                    this.readStringEnd = pos;
                    this.pos = pos + 2;
                    this.readingTemplateString = true;
                    return result;
                }
            } else if (isLineBreak(c)) {
                result += text.substring(start, pos);
                this.error(
                    DiagnosticCode.Unterminated_string_literal,
                    this.range(start - 1, pos)
                );
                this.readStringEnd = pos;
                break;
            }
            ++pos;
        }
        this.pos = pos;
        this.readingTemplateString = false;
        return result;
    }

    readEscapeSequence(isTaggedTemplate: boolean = false): string {
        // for context on isTaggedTemplate, see: https://tc39.es/proposal-template-literal-revision/
        let start = this.pos;
        let end = this.end;
        if (++this.pos >= end) {
            this.error(
                DiagnosticCode.Unexpected_end_of_text,
                this.range(end)
            );
            return "";
        }

        let text = this.source.text;
        let c = text.charCodeAt(this.pos++);
        switch (c) {
            case CharCode._0: {
                if (isTaggedTemplate && this.pos < end && isDecimal(text.charCodeAt(this.pos))) {
                    ++this.pos;
                    return text.substring(start, this.pos);
                }
                return "\0";
            }
            case CharCode.b: return "\b";
            case CharCode.t: return "\t";
            case CharCode.n: return "\n";
            case CharCode.v: return "\v";
            case CharCode.f: return "\f";
            case CharCode.r: return "\r";
            case CharCode.SingleQuote: return "'";
            case CharCode.DoubleQuote: return "\"";
            case CharCode.u: {
                if (
                    this.pos < end &&
                    text.charCodeAt(this.pos) === CharCode.OpenBrace
                ) {
                    ++this.pos;
                    return this.readExtendedUnicodeEscape(isTaggedTemplate ? start : -1); // \u{DDDDDDDD}
                }
                return this.readUnicodeEscape(isTaggedTemplate ? start : -1); // \uDDDD
            }
            case CharCode.x: {
                return this.readHexadecimalEscape(2, isTaggedTemplate ? start : - 1); // \xDD
            }
            case CharCode.CarriageReturn: {
                if (
                    this.pos < end &&
                    text.charCodeAt(this.pos) === CharCode.LineFeed
                ) {
                    ++this.pos;
                }
                // fall through
            }
            case CharCode.LineFeed:
            case CharCode.LineSeparator:
            case CharCode.ParagraphSeparator: return "";
            default: return String.fromCodePoint(c);
        }
    }

    readRegexpPattern(): string {
        let text = this.source.text;
        let start = this.pos;
        let end = this.end;
        let escaped = false;
        while (true) {
            if (this.pos >= end) {
                this.error(
                    DiagnosticCode.Unterminated_regular_expression_literal,
                    this.range(start, end)
                );
                break;
            }
            if (text.charCodeAt(this.pos) === CharCode.Backslash) {
                ++this.pos;
                escaped = true;
                continue;
            }
            let c = text.charCodeAt(this.pos);
            if (!escaped && c === CharCode.Slash) break;
            if (isLineBreak(c)) {
                this.error(
                    DiagnosticCode.Unterminated_regular_expression_literal,
                    this.range(start, this.pos)
                );
                break;
            }
            ++this.pos;
            escaped = false;
        }
        return text.substring(start, this.pos);
    }

    readRegexpFlags(): string {
        let text = this.source.text;
        let start = this.pos;
        let end = this.end;
        let flags = 0;
        while (this.pos < end) {
            let c: number = text.charCodeAt(this.pos);
            if (!isIdentifierPart(c)) break;
            ++this.pos;

            // make sure each supported flag is unique
            switch (c) {
                case CharCode.g: {
                    flags |= flags & 1 ? -1 : 1;
                    break;
                }
                case CharCode.i: {
                    flags |= flags & 2 ? -1 : 2;
                    break;
                }
                case CharCode.m: {
                    flags |= flags & 4 ? -1 : 4;
                    break;
                }
                default: {
                    flags = -1;
                    break;
                }
            }
        }
        if (flags === -1) {
            this.error(
                DiagnosticCode.Invalid_regular_expression_flags,
                this.range(start, this.pos)
            );
        }
        return text.substring(start, this.pos);
    }

    testInteger(): boolean {
        let text = this.source.text;
        let pos = this.pos;
        let end = this.end;
        // test for hex, binary or octal
        if (pos + 1 < end && text.charCodeAt(pos) === CharCode._0) {
            switch (text.charCodeAt(pos + 2) | 32) {
                case CharCode.x:
                case CharCode.b:
                case CharCode.o: return true;
            }
        }
        // test decimal
        while (pos < end) {
            let c = text.charCodeAt(pos);
            if (c === CharCode.Dot || (c | 32) === CharCode.e) return false;
            if (c !== CharCode._ && (c < CharCode._0 || c > CharCode._9)) break;
            // does not validate separator placement (this is done in readXYInteger)
            pos++;
        }
        return true;
    }

    readInteger(): bigint {
        let text = this.source.text;
        let pos = this.pos;
        if (pos + 2 < this.end && text.charCodeAt(pos) === CharCode._0) {
            switch (text.charCodeAt(pos + 1) | 32) {
                case CharCode.x: {
                    this.pos = pos + 2;
                    return this.readHexInteger();
                }
                case CharCode.b: {
                    this.pos = pos + 2;
                    return this.readBinaryInteger();
                }
                case CharCode.o: {
                    this.pos = pos + 2;
                    return this.readOctalInteger();
                }
            }
            if (isOctal(text.charCodeAt(pos + 1))) {
                let start = pos;
                this.pos = pos + 1;
                let value = this.readOctalInteger();
                this.error(
                    DiagnosticCode.Octal_literals_are_not_allowed_in_strict_mode,
                    this.range(start, this.pos)
                );
                return value;
            }
        }
        return this.readDecimalInteger();
    }

    readHexBytes(): Uint8Array {
        let text = this.source.text;
        let pos = this.pos;
        pos = text[pos] === "#" ? pos + 1 : pos;
        this.pos = pos;
        let end = this.end;
        let start = pos;
        let length = 0;
        while (pos < end) {
            let c = text.charCodeAt(pos);
            if (isHexOrDecimal(c)) {
                length++;
                pos++;
            } else {
                break;
            }
        }
        if (length === 0) {
            return new Uint8Array(0);
        }
        this.pos = pos;
        const oddLen = length % 2 === 1;
        const substr = (oddLen ? "0" : "") + text.substring(start, pos);
        return fromHex( substr );
    };

    readHexInteger(): bigint {
        let text = this.source.text;
        let pos = this.pos;
        let end = this.end;
        let start = pos;
        let sepEnd = start;
        let value = BigInt(0);
        let i64_4 = BigInt(4);
        let nextValue = value;
        let overflowOccurred = false;

        while (pos < end) {
            let c = text.charCodeAt(pos);
            const bc = BigInt(c);
            if (isDecimal(c)) {
                // (value << 4) + c - CharCode._0
                nextValue = (value << BigInt(4)) + bc - BigInt(CharCode._0);
            } else if (isHexBase(c)) {
                // (value << 4) + (c | 32) + (10 - CharCode.a)
                nextValue = (value << BigInt(4)) + BigInt(c | 32) + BigInt(10 - CharCode.a);
            } else if (c === CharCode._) {
                if (sepEnd === pos) {
                    this.error(
                        sepEnd === start
                            ? DiagnosticCode.Numeric_separators_are_not_allowed_here
                            : DiagnosticCode.Multiple_consecutive_numeric_separators_are_not_permitted,
                        this.range(pos)
                    );
                }
                sepEnd = pos + 1;
            } else {
                break;
            }
            // if (i64_gt_u(value, nextValue)) {
            //     // Unsigned overflow occurred
            //     overflowOccurred = true;
            // }
            value = nextValue;
            ++pos;
        }
        if (pos === start) {
            this.error(
                DiagnosticCode.Hexadecimal_digit_expected,
                this.range(start)
            );
        } else if (sepEnd === pos) {
            this.error(
                DiagnosticCode.Numeric_separators_are_not_allowed_here,
                this.range(sepEnd - 1)
            );
        }
        if (overflowOccurred) {
            this.error(
                DiagnosticCode.Literal_0_does_not_fit_into_i64_or_u64_types,
                this.range(start - 2, pos),
                this.source.text.substring(start - 2, pos)
            );
        }
        this.pos = pos;
        return value;
    }

    readDecimalInteger(): bigint {
        let text = this.source.text;
        let pos = this.pos;
        let end = this.end;
        let start = pos;
        let sepEnd = start;
        let value = BigInt(0);
        let i64_10 = BigInt(10);
        let nextValue = value;
        let overflowOccurred = false;

        while (pos < end) {
            let c = text.charCodeAt(pos);
            const bc = BigInt(c);
            if (isDecimal(c)) {
                // value = value * 10 + c - CharCode._0;
                nextValue = value * i64_10 + bc - BigInt(CharCode._0);
            } else if (c === CharCode._) {
                if (sepEnd === pos) {
                    this.error(
                        sepEnd === start
                            ? DiagnosticCode.Numeric_separators_are_not_allowed_here
                            : DiagnosticCode.Multiple_consecutive_numeric_separators_are_not_permitted,
                        this.range(pos)
                    );
                } else if (pos - 1 === start && text.charCodeAt(pos - 1) === CharCode._0) {
                    this.error(
                        DiagnosticCode.Numeric_separators_are_not_allowed_here,
                        this.range(pos)
                    );
                }
                sepEnd = pos + 1;
            } else {
                break;
            }
            // if (i64_gt_u(value, nextValue)) {
            //     // Unsigned overflow occurred
            //     overflowOccurred = true;
            // }
            value = nextValue;
            ++pos;
        }
        if (pos === start) {
            this.error(
                DiagnosticCode.Digit_expected,
                this.range(start)
            );
        } else if (sepEnd === pos) {
            this.error(
                DiagnosticCode.Numeric_separators_are_not_allowed_here,
                this.range(sepEnd - 1)
            );
        } else if (overflowOccurred) {
            this.error(
                DiagnosticCode.Literal_0_does_not_fit_into_i64_or_u64_types,
                this.range(start, pos),
                this.source.text.substring(start, pos)
            );
        }
        this.pos = pos;
        return value;
    }

    readOctalInteger(): bigint {
        let text = this.source.text;
        let pos = this.pos;
        let end = this.end;
        let start = pos;
        let sepEnd = start;
        let value = BigInt(0);
        let i64_3 = BigInt(3);
        let nextValue = value;
        let overflowOccurred = false;

        while (pos < end) {
            let c = text.charCodeAt(pos);
            if (isOctal(c)) {
                // (value << 3) + c - CharCode._0
                nextValue = (value << BigInt(3)) + BigInt(c) - BigInt(CharCode._0);
            } else if (c === CharCode._) {
                if (sepEnd === pos) {
                    this.error(
                        sepEnd === start
                            ? DiagnosticCode.Numeric_separators_are_not_allowed_here
                            : DiagnosticCode.Multiple_consecutive_numeric_separators_are_not_permitted,
                        this.range(pos)
                    );
                }
                sepEnd = pos + 1;
            } else {
                break;
            }
            // if (i64_gt_u(value, nextValue)) {
            //     // Unsigned overflow occurred
            //     overflowOccurred = true;
            // }
            value = nextValue;
            ++pos;
        }
        if (pos === start) {
            this.error(
                DiagnosticCode.Octal_digit_expected,
                this.range(start)
            );
        } else if (sepEnd === pos) {
            this.error(
                DiagnosticCode.Numeric_separators_are_not_allowed_here,
                this.range(sepEnd - 1)
            );
        } else if (overflowOccurred) {
            this.error(
                DiagnosticCode.Literal_0_does_not_fit_into_i64_or_u64_types,
                this.range(start - 2, pos),
                this.source.text.substring(start - 2, pos)
            );
        }
        this.pos = pos;
        return value;
    }

    readBinaryInteger(): bigint {
        let text = this.source.text;
        let pos = this.pos;
        let end = this.end;
        let start = pos;
        let sepEnd = start;
        let value = BigInt(0);
        let nextValue = value;
        let overflowOccurred = false;

        while (pos < end) {
            let c = text.charCodeAt(pos);
            if (c === CharCode._0) {
                // value << 1 | 0
                nextValue = value << BigInt(1);
            } else if (c === CharCode._1) {
                // value << 1 | 1
                nextValue = value << BigInt(1) | BigInt(1);
            } else if (c === CharCode._) {
                if (sepEnd === pos) {
                    this.error(
                        sepEnd === start
                            ? DiagnosticCode.Numeric_separators_are_not_allowed_here
                            : DiagnosticCode.Multiple_consecutive_numeric_separators_are_not_permitted,
                        this.range(pos)
                    );
                }
                sepEnd = pos + 1;
            } else {
                break;
            }
            // if (i64_gt(value, nextValue)) {
            //     // Overflow occurred
            //     overflowOccurred = true;
            // }
            value = nextValue;
            ++pos;
        }
        if (pos === start) {
            this.error(
                DiagnosticCode.Binary_digit_expected,
                this.range(start)
            );
        } else if (sepEnd === pos) {
            this.error(
                DiagnosticCode.Numeric_separators_are_not_allowed_here,
                this.range(sepEnd - 1)
            );
        } else if (overflowOccurred) {
            this.error(
                DiagnosticCode.Literal_0_does_not_fit_into_i64_or_u64_types,
                this.range(start - 2, pos),
                this.source.text.substring(start - 2, pos)
            );
        }
        this.pos = pos;
        return value;
    }

    readFloat(): number {
        // let text = this.source.text;
        // if (text.charCodeAt(this.pos) === CharCode._0 && this.pos + 2 < this.end) {
        //   switch (text.charCodeAt(this.pos + 1)) {
        //     case CharCode.X:
        //     case CharCode.x: {
        //       this.pos += 2;
        //       return this.readHexFloat();
        //     }
        //   }
        // }
        return this.readDecimalFloat();
    }

    readDecimalFloat(): number {
        let text = this.source.text;
        let end = this.end;
        let start = this.pos;
        let sepCount = this.readDecimalFloatPartial(false);
        if (this.pos < end && text.charCodeAt(this.pos) === CharCode.Dot) {
            ++this.pos;
            sepCount += this.readDecimalFloatPartial();
        }
        if (this.pos < end) {
            let c = text.charCodeAt(this.pos);
            if ((c | 32) === CharCode.e) {
                if (
                    ++this.pos < end &&
                    (c = text.charCodeAt(this.pos)) === CharCode.Minus || c === CharCode.Plus &&
                    isDecimal(text.charCodeAt(this.pos + 1))
                ) {
                    ++this.pos;
                }
                sepCount += this.readDecimalFloatPartial();
            }
        }
        let result = text.substring(start, this.pos);
        if (sepCount) result = result.replace(/_/g, "");
        return parseFloat(result);
    }

    /** Reads past one section of a decimal float literal. Returns the number of separators encountered. */
    private readDecimalFloatPartial(allowLeadingZeroSep: boolean = true): number {
        let text = this.source.text;
        let pos = this.pos;
        let start = pos;
        let end = this.end;
        let sepEnd = start;
        let sepCount = 0;

        while (pos < end) {
            let c = text.charCodeAt(pos);

            if (c === CharCode._) {
                if (sepEnd === pos) {
                    this.error(
                        sepEnd === start
                            ? DiagnosticCode.Numeric_separators_are_not_allowed_here
                            : DiagnosticCode.Multiple_consecutive_numeric_separators_are_not_permitted,
                        this.range(pos)
                    );
                } else if (!allowLeadingZeroSep && pos - 1 === start && text.charCodeAt(pos - 1) === CharCode._0) {
                    this.error(
                        DiagnosticCode.Numeric_separators_are_not_allowed_here,
                        this.range(pos)
                    );
                }
                sepEnd = pos + 1;
                ++sepCount;
            } else if (!isDecimal(c)) {
                break;
            }
            ++pos;
        }

        if (pos !== start && sepEnd === pos) {
            this.error(
                DiagnosticCode.Numeric_separators_are_not_allowed_here,
                this.range(sepEnd - 1)
            );
        }

        this.pos = pos;
        return sepCount;
    }

    readHexFloat(): number {
        throw new Error("not implemented"); // TBD
    }

    readHexadecimalEscape(remain: number = 2, startIfTaggedTemplate: number = -1): string {
        let value = 0;
        let text = this.source.text;
        let pos = this.pos;
        let end = this.end;
        while (pos < end) {
            let c = text.charCodeAt(pos++);
            if (isDecimal(c)) {
                value = (value << 4) + c - CharCode._0;
            } else if (isHexBase(c)) {
                value = (value << 4) + (c | 32) + (10 - CharCode.a);
            } else if (~startIfTaggedTemplate) {
                this.pos = --pos;
                return text.substring(startIfTaggedTemplate, pos);
            } else {
                this.pos = pos;
                this.error(
                    DiagnosticCode.Hexadecimal_digit_expected,
                    this.range(pos - 1, pos)
                );
                return "";
            }
            if (--remain === 0) break;
        }
        if (remain) { // invalid
            this.pos = pos;
            if (~startIfTaggedTemplate) {
                return text.substring(startIfTaggedTemplate, pos);
            }
            this.error(
                DiagnosticCode.Unexpected_end_of_text,
                this.range(pos)
            );
            return "";
        }
        this.pos = pos;
        return String.fromCodePoint(value);
    }

    checkForIdentifierStartAfterNumericLiteral(): void {
        // TODO: BigInt n
        let pos = this.pos;
        if (pos < this.end && isIdentifierStart(this.source.text.charCodeAt(pos))) {
            this.error(
                DiagnosticCode.An_identifier_or_keyword_cannot_immediately_follow_a_numeric_literal,
                this.range(pos)
            );
        }
    }

    readUnicodeEscape(startIfTaggedTemplate: number = -1): string {
        return this.readHexadecimalEscape(4, startIfTaggedTemplate);
    }

    private readExtendedUnicodeEscape(startIfTaggedTemplate: number = -1): string {
        let start = this.pos;
        let value = this.readHexInteger();
        let value32 = i64_low(value);
        let invalid = false;

        assert(!i64_high(value));
        if (value32 > 0x10FFFF) {
            if (startIfTaggedTemplate === -1) {
                this.error(
                    DiagnosticCode.An_extended_Unicode_escape_value_must_be_between_0x0_and_0x10FFFF_inclusive,
                    this.range(start, this.pos)
                );
            }
            invalid = true;
        }

        let end = this.end;
        let text = this.source.text;
        if (this.pos >= end) {
            if (startIfTaggedTemplate === -1) {
                this.error(
                    DiagnosticCode.Unexpected_end_of_text,
                    this.range(start, end)
                );
            }
            invalid = true;
        } else if (text.charCodeAt(this.pos) === CharCode.CloseBrace) {
            ++this.pos;
        } else {
            if (startIfTaggedTemplate === -1) {
                this.error(
                    DiagnosticCode.Unterminated_Unicode_escape_sequence,
                    this.range(start, this.pos)
                );
            }
            invalid = true;
        }

        if (invalid) {
            return ~startIfTaggedTemplate
                ? text.substring(startIfTaggedTemplate, this.pos)
                : "";
        }
        return String.fromCodePoint(value32);
    }
}

/** Tokenizer state as returned by {@link Tokenizer#mark} and consumed by {@link Tokenizer#reset}. */
export class TokenizerState {
    constructor(
        /** Current position. */
        public pos: number,
        /** Current token. */
        public token: Token,
        /** Current token's position. */
        public tokenPos: number
    ) { }
}

// Reusable state object to reduce allocations
// let reusableState: TokenizerState | undefined = undefined;

function i64_low(value: bigint) {
    return Number(value & BigInt(0xFFFFFFFF));
}

function i64_high(value: bigint) {
    return i64_low(value >> BigInt(32));
}