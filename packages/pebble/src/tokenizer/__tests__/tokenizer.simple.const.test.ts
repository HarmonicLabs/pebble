import { Source, SourceKind } from "../../ast/Source/Source";
import { Token } from "../Token";
import { Tokenizer } from "../Tokenizer";

test("const thing = 2;", () => {

    const txt = "const thing = 2;";
    const src = new Source(
        SourceKind.User,
        "test.peb",
        "",
        txt
    );
    const tn = new Tokenizer( src );

    const tokens = getAllTokens( tn );
    // console.log( tokens );
    expect( tokens ).toEqual([
        Token[Token.Const],
        Token[Token.Identifier], "thing",
        Token[Token.Equals],
        Token[Token.IntegerLiteral], BigInt( 2 ),
        Token[Token.Semicolon],
    ]);
});

function getAllTokens( tn: Tokenizer ): any[] {
    const startState = tn.mark();
    const tokens: any[] = [];
    let token: Token;
    while( (token = tn.next()) !== Token.EndOfFile ) {
        tokens.push( Token[ token ] );
        if( token === Token.Identifier ) tokens.push( tn.readIdentifier() );
        if( token === Token.IntegerLiteral ) tokens.push( tn.readInteger() );
    }
    tn.reset( startState );
    return tokens;
}