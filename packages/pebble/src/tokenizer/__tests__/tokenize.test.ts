import * as fs from "fs";
import * as path from "path";
import { tokenize } from "../tokenize";
import { Token } from "../Token";

const show = ( text: string ) => tokenize( text ).map( t => [ Token[ t.kind ], text.slice( t.start, t.end ) ] );

describe("tokenize", () => {

    test("reads each token whole, with its range", () => {
        expect( show( `a.b( #00ff, "s", 12 ) // done` ) ).toEqual([
            [ "Identifier", "a" ],
            [ "Dot", "." ],
            [ "Identifier", "b" ],
            [ "OpenParen", "(" ],
            [ "HexBytesLiteral", "#00ff" ],
            [ "Comma", "," ],
            [ "StringLiteral", `"s"` ],
            [ "Comma", "," ],
            [ "IntegerLiteral", "12" ],
            [ "CloseParen", ")" ],
        ]);
    });

    test("keywords are keywords; a `.` after a name is read whole", () => {
        expect( show( `const x = c.\n    return 2;` ).map( ([ kind ]) => kind ) ).toEqual([
            "Const", "Identifier", "Equals", "Identifier", "Dot", "Return", "IntegerLiteral", "Semicolon",
        ]);
    });

    test("a template literal is a token per fragment, with its expressions' tokens between", () => {
        expect( show( "`a${ f( { x: 1 } ) }b${ y }c` + z" ) ).toEqual([
            [ "StringTemplateLiteralQuote", "`a${" ],
            [ "Identifier", "f" ],
            [ "OpenParen", "(" ],
            [ "OpenBrace", "{" ],
            [ "Identifier", "x" ],
            [ "Colon", ":" ],
            [ "IntegerLiteral", "1" ],
            [ "CloseBrace", "}" ],
            [ "CloseParen", ")" ],
            [ "StringTemplateLiteralQuote", "}b${" ],
            [ "Identifier", "y" ],
            [ "StringTemplateLiteralQuote", "}c`" ],
            [ "Plus", "+" ],
            [ "Identifier", "z" ],
        ]);
    });

    test("broken text still ends, and is read up to where it breaks", () => {
        expect( show( `f( "open\n x § y` ) ).toEqual([
            [ "Identifier", "f" ],
            [ "OpenParen", "(" ],
            [ "StringLiteral", `"open` ],
            [ "Identifier", "x" ],
            [ "Identifier", "y" ],
        ]);
        expect( show( "`never closed ${ a" ) ).toEqual([
            [ "StringTemplateLiteralQuote", "`never closed ${" ],
            [ "Identifier", "a" ],
        ]);
    });

    test("on the example contracts: in order, and only whitespace and comments between", () => {
        const examples = path.resolve( __dirname, "../../../../../examples" );
        const files: string[] = [];
        const walk = ( d: string ) => {
            for( const f of fs.readdirSync( d ) )
            {
                const p = path.join( d, f );
                if( f === "node_modules" ) continue;
                if( fs.statSync( p ).isDirectory() ) walk( p );
                else if( p.endsWith( ".pebble" ) && p.includes( `${path.sep}src${path.sep}` ) ) files.push( p );
            }
        };
        walk( examples );
        expect( files.length ).toBeGreaterThan( 10 );
        const gap = /^(\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*$/;
        for( const file of files )
        {
            const text = fs.readFileSync( file, "utf8" );
            const tokens = tokenize( text );
            let pos = 0;
            for( const t of tokens )
            {
                expect( t.start ).toBeGreaterThanOrEqual( pos );
                expect( t.end ).toBeGreaterThan( t.start );
                expect( [ file, text.slice( pos, t.start ) ] ).toEqual( [ file, expect.stringMatching( gap ) ] );
                pos = t.end;
            }
            expect( [ file, text.slice( pos ) ] ).toEqual( [ file, expect.stringMatching( gap ) ] );
        }
    });
});
