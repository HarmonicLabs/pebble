import { isIncompleteInput, splitStatements } from "../replSyntax";

/** `kind:names` per statement */
const shape = ( input: string ) => splitStatements( input ).map( s => s.kind + ( s.names.length > 0 ? ":" + s.names.join( "," ) : "" ) );

describe("splitStatements", () => {

    test("statements end at `;` and at a closing brace", () => {
        expect( shape( "const a = 1; a + 1" ) ).toEqual([ "const:a", "expression" ]);
        expect( shape( "function f( x: int ): int { return x; } f( 1 )" ) ).toEqual([ "function:f", "expression" ]);
        expect( shape( "struct P { x: int, y: int }\nconst p = P{ x: 1, y: 2 };" ) ).toEqual([ "type:P", "const:p" ]);
    });

    test("a brace does not end the statement when it goes on", () => {
        expect( shape( "if( a ) { b = 1; } else { b = 2; }" ) ).toEqual([ "statement" ]);
        expect( shape( "import { f, g } from \"./lib.pebble\";" ) ).toEqual([ "import" ]);
        expect( shape( "const { a, b } = p;" ) ).toEqual([ "const:a,b" ]);
        expect( shape( "P{ x: 1 }.x + 1" ) ).toEqual([ "expression" ]);
        expect( shape( "case v is A{ x } => x is B{ y } => y" ) ).toEqual([ "expression" ]);
    });

    test("a line break ends a complete statement without `;`", () => {
        expect( shape( "const a = 1\nconst b = a\nb" ) ).toEqual([ "const:a", "const:b", "expression" ]);
        // not after an operator, nor before one
        expect( shape( "const a = 1 +\n2" ) ).toEqual([ "const:a" ]);
        expect( shape( "const a = xs\n.length()" ) ).toEqual([ "const:a" ]);
        expect( shape( "case v\nis A{ x } => x" ) ).toEqual([ "expression" ]);
        // a condition's body on the next line
        expect( shape( "if( a )\n    b = 1;\nelse\n    b = 2;\nb" ) ).toEqual([ "statement", "expression" ]);
        expect( shape( "while( i < 3 )\n    i++;" ) ).toEqual([ "statement" ]);
    });

    test("declarations", () => {
        expect( shape( "export function g(): int { return 1; }" ) ).toEqual([ "function:g" ]);
        expect( splitStatements( "export function g(): int { return 1; }" )[0].exported ).toBe( true );
        expect( shape( "data struct T { A{ x: int } B{ y: int } }" ) ).toEqual([ "type:T" ]);
        expect( shape( "runtime struct S { a: int }" ) ).toEqual([ "type:S" ]);
        expect( shape( "untagged data struct U { a: int }" ) ).toEqual([ "type:U" ]);
        expect( shape( "enum E { A, B }" ) ).toEqual([ "type:E" ]);
        expect( shape( "type Alias = int;" ) ).toEqual([ "type:Alias" ]);
        expect( shape( "contract C { spend s() { } }" ) ).toEqual([ "contract:C" ]);
        expect( shape( "test t() { assert true; }" ) ).toEqual([ "test:t" ]);
        expect( shape( "using { x } = std.array;" ) ).toEqual([ "using" ]);
        expect( shape( "let n = 0; var m = 1;" ) ).toEqual([ "let:n", "let:m" ]);
    });

    test("the names a pattern declares", () => {
        expect( shape( "const { a, b: c, ...r } = x;" ) ).toEqual([ "const:a,c,r" ]);
        expect( shape( "const Spending{ ref, optionalDatum: datum as MyDatum } = purpose;" ) ).toEqual([ "const:ref,datum" ]);
        expect( shape( "const [ h, ...t ] = xs;" ) ).toEqual([ "const:h,t" ]);
        expect( shape( "const { a: { b, c } } = x;" ) ).toEqual([ "const:b,c" ]);
        expect( shape( "const a = 1, b = 2;" ) ).toEqual([ "const:a,b" ]);
        // a comma in the type is not a second declarator
        expect( shape( "const m: LinearMap<int, int> = x;" ) ).toEqual([ "const:m" ]);
    });

    test("assignments, and the variables a statement assigns", () => {
        expect( shape( "x = 1" ) ).toEqual([ "assignment" ]);
        expect( shape( "x += 1" ) ).toEqual([ "assignment" ]);
        expect( shape( "x++" ) ).toEqual([ "assignment" ]);
        expect( shape( "--x" ) ).toEqual([ "assignment" ]);
        expect( shape( "x.y = 2" ) ).toEqual([ "assignment" ]);
        expect( shape( "x == 1" ) ).toEqual([ "expression" ]);
        expect( shape( "x => x + 1" ) ).toEqual([ "expression" ]);
        expect( splitStatements( "x.y = 2" )[0].assigns ).toEqual([ "x" ]);
        expect( splitStatements( "for( const v of vs ) { total += v; count++; }" )[0].assigns ).toEqual([ "total", "count" ]);
        // a declaration is not an assignment
        expect( splitStatements( "for( let i = 0; i < 3; i++ ) { }" )[0].assigns ).toEqual([ "i" ]);
        expect( splitStatements( "if( a <= b ) { }" )[0].assigns ).toEqual([]);
    });

    test("the identifiers a statement uses, members excluded", () => {
        expect( splitStatements( "const y = x.field + f( z )" )[0].uses ).toEqual([ "const", "y", "x", "f", "z" ]);
    });

    test("strings, bytes, templates and comments hold no statements", () => {
        expect( shape( "const s = \"a; b }\"; s" ) ).toEqual([ "const:s", "expression" ]);
        expect( shape( "#ab; #cd" ) ).toEqual([ "expression", "expression" ]);
        expect( shape( "const t = `a ${ f( { x: 1 } ) } b`; // c; d\nt" ) ).toEqual([ "const:t", "expression" ]);
        expect( shape( "/* x; y */ 1" ) ).toEqual([ "expression" ]);
        expect( shape( "" ) ).toEqual([]);
        expect( shape( "   // only a comment" ) ).toEqual([]);
    });

    test("statement texts keep their `;` and offsets", () => {
        const [ a, b ] = splitStatements( "  const a = 1;  a + 1" );
        expect( a.text ).toBe( "const a = 1;" );
        expect( a.start ).toBe( 2 );
        expect( b.text ).toBe( "a + 1" );
        expect( b.start ).toBe( 16 );
    });
});

describe("isIncompleteInput", () => {
    test("open brackets, strings, templates and comments need more lines", () => {
        expect( isIncompleteInput( "function f( x: int ): int {" ) ).toBe( true );
        expect( isIncompleteInput( "f( 1," ) ).toBe( true );
        expect( isIncompleteInput( "\"abc" ) ).toBe( true );
        expect( isIncompleteInput( "/* comment" ) ).toBe( true );
        expect( isIncompleteInput( "`a ${ b" ) ).toBe( true );
        expect( isIncompleteInput( "f( 1 )" ) ).toBe( false );
        expect( isIncompleteInput( "function f() { return \"}\"; }" ) ).toBe( false );
        // a stray closing bracket is the compiler's to report
        expect( isIncompleteInput( "f( 1 ))" ) ).toBe( false );
    });
});
