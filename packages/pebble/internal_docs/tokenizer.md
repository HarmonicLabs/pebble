# Tokenizer

The tokenizer (`src/tokenizer/`) performs lexical analysis, converting source text into a stream of tokens consumed by the parser. It is iterator-based — tokens are produced one at a time on demand rather than materialized into an array.

## Architecture

**File:** `src/tokenizer/Tokenizer.ts`

The `Tokenizer` class extends `DiagnosticEmitter` and operates on a `Source` object.

### Key Properties

| Property | Type | Description |
|----------|------|-------------|
| `pos` | `number` | Current position in source text |
| `token` | `Token` | Current token type |
| `tokenPos` | `number` | Position where current token started |
| `nextToken` | `Token` | Lookahead token (cached) |
| `nextTokenPos` | `number` | Position of lookahead token |
| `nextTokenOnNewLine` | `boolean` | Whether lookahead is on a new line |
| `onComment` | callback | Optional comment handler |

### Core Methods

#### `next(identifierHandling?): Token`
Advances the tokenizer to the next token and returns the new token type. This is the primary method called by the parser.

The `identifierHandling` parameter controls keyword-vs-identifier resolution:
- `Default` — standard keyword recognition
- `Prefer` — prefer treating words as identifiers over keywords
- `Always` — always treat words as identifiers (never keywords)

#### `unsafeNext(identifierHandling?, maxTokenLength?): Token`
Internal method that performs the actual tokenization. Reads characters from the source and dispatches on character codes (~70 cases) to produce tokens.

#### `peek(identifierHandling?, maxCompoundLength?): Token`
Looks ahead to the next token without advancing. Caches the result for subsequent calls.

#### `skip(expectedToken, identifierHandling?): boolean`
Advances if the current token matches `expectedToken`, returns whether it matched.

#### `mark(): TokenizerState` / `reset(state): void`
State snapshot and restore for parser backtracking. `TokenizerState` captures `pos`, `token`, and `tokenPos`.

## Token Types

**File:** `src/tokenizer/Token.ts`

The `Token` enum defines ~134 token types:

### Keywords (~53)
```
function, const, let, var, if, else, for, while, return, break, continue,
match, when, case, test, fail, assert, trace,
contract, param, spend, mint, certify, withdraw, propose, vote, context,
struct, enum, type, interface, implements, extends, export, import, from,
as, is, of, using, static, readonly, true, false, undefined, void,
data, bytes, int, boolean, Optional, List, LinearMap, Runtime
```

### Operators & Punctuation (~82)
```
Arithmetic:    + - * ** / %
Comparison:    < > <= >= == != === !==
Bitwise:       & | ^ ~ << >> >>>
Logical:       && || ! ??
Assignment:    = += -= *= **= /= %= <<= >>= >>>= &= ^= |= ??=
Increment:     ++ --
Access:        . ?. !. [ ]
Punctuation:   { } ( ) ; , : => ...
Special:       ? (ternary)
```

### Literals
| Token | Description | Example |
|-------|-------------|---------|
| `Identifier` | Variable/function names | `myVar` |
| `IntegerLiteral` | Integer numbers | `42`, `0xff`, `0b1010`, `0o77` |
| `StringLiteral` | Quoted strings | `"hello"`, `'world'` |
| `HexBytesLiteral` | Hex byte sequences | `#aabbcc` |
| `StringTemplateLiteralQuote` | Template literal delimiters | `` ` `` |

### Meta
| Token | Description |
|-------|-------------|
| `Invalid` | Unrecognized character or malformed token |
| `EndOfFile` | End of source text |

## Tokenization Process

### Character Dispatch
`unsafeNext()` reads the next character code and dispatches:

1. **Whitespace** (space, tab, vertical tab, form feed) — skipped, advance
2. **Newline** (LF, CR, line/paragraph separator) — tracked, skipped
3. **BOM** (byte order mark) — skipped at start of file
4. **Letters / `_` / `$`** — start of identifier or keyword
5. **Digits** — start of numeric literal
6. **`"`** or **`'`** — string literal
7. **`` ` ``** — template literal
8. **`#`** — hex bytes literal or shebang
9. **`/`** — division, line comment (`//`), or block comment (`/* */`)
10. **Operator characters** — compound operator resolution (e.g., `+` vs `++` vs `+=`)

### Identifier and Keyword Resolution

When a letter/underscore/dollar is encountered:
1. `readIdentifier()` scans the full identifier text
2. The text is checked against the keyword table
3. Based on `IdentifierHandling`, it returns either the keyword token or `Token.Identifier`

### Numeric Literals

`readInteger()` dispatches based on prefix:
- `0x` / `0X` → `readHexInteger()` — hexadecimal
- `0b` / `0B` → `readBinaryInteger()` — binary
- `0o` / `0O` → `readOctalInteger()` — octal
- Otherwise → `readDecimalInteger()` — decimal (uses `BigInt`)

All integer reading methods store the parsed value and return `Token.IntegerLiteral`.

### Hex Bytes Literals

`readHexBytes()` handles the `#HHHH` syntax. Reads pairs of hex digits after `#` and produces `Token.HexBytesLiteral`.

### String Literals

`readString(quote, isTaggedTemplate)` handles:
- Single-quoted (`'...'`) and double-quoted (`"..."`) strings
- Escape sequences: `\n`, `\r`, `\t`, `\\`, `\"`, `\'`, `\0`
- Unicode escapes: `\uXXXX`, `\u{XXXXX}`
- Hex escapes: `\xHH`

### Template Literals

Template literals use backticks and support interpolation via `${...}`. The tokenizer produces `StringTemplateLiteralQuote` tokens at template boundaries, and the parser handles the interpolation structure.

### Comment Handling

Three comment styles are recognized:

| Style | Syntax | CommentKind |
|-------|--------|-------------|
| Line comment | `// ...` | `Line` |
| Triple-slash | `/// ...` | `Triple` |
| Block comment | `/* ... */` | `Block` |

Comments are skipped during tokenization. If `onComment` is set, the callback receives the comment kind, position, and length.

## IdentifierHandling Enum

**File:** `src/tokenizer/IdentifierHandling.ts`

```typescript
enum IdentifierHandling {
    Default,  // Normal keyword recognition
    Prefer,   // Prefer identifier over keyword
    Always    // Always return Identifier token
}
```

The parser uses `Prefer` and `Always` in contexts where a keyword might appear as a name (e.g., property names, type positions).

## TokenizerState

**File:** `src/tokenizer/TokenizerState.ts`

```typescript
class TokenizerState {
    constructor(
        public pos: number,      // Current position
        public token: Token,     // Current token
        public tokenPos: number  // Token start position
    )
}
```

Used by `mark()` / `reset()` for parser backtracking. Lightweight — only captures the minimal state needed to resume tokenization.

## Source Tracking

The tokenizer operates on a `Source` object which provides:
- `text: string` — the full source text
- Line/column computation from character positions (with caching)
- Source kind (`User`, `UserEntry`, `Library`, `LibraryEntry`)
- Unique source identifier (`uid`)

The tokenizer tracks newlines via an `OnNewLine` callback, enabling the Source object to maintain a line map for diagnostic reporting.

## Unicode Support

The tokenizer supports full Unicode identifiers:
- `isIdentifierStart(charCode)` — letters, `_`, `$`, and Unicode letter categories
- `isIdentifierPart(charCode)` — identifier start chars plus digits and Unicode combining marks
- High surrogate detection and combining for supplementary plane characters
