import { Parser } from "../Parser";

/**
 * A declared name's range is the name: it started at the token before it (`const LIMIT`,
 * `( r`, `, b`), so a diagnostic on a name underlined the keyword too, and the symbol index
 * could not find the name there.
 */
describe("a declared name's range is the name", () => {

    const text = `const LIMIT = 1008;
export function f( r: int, s: int ): int {
    let x = r;
    const Pair{ a, b } = mk( s );
    const [ h, ...t ] = [ 1, 2 ];
    return x;
}
contract C {
    spend s() {}
}
`;
    const [ src, diagnostics ] = Parser.parseFile( "/src/main.pebble", text );
    const named = ( id: any ) => text.slice( id.range.start, id.range.end );
    const stmts: any[] = ( src as any ).statements;
    const fn = stmts[1].stmt;
    const body: any[] = fn.expr.body.stmts;

    test("parses", () => {
        expect( diagnostics ).toEqual( [] );
    });

    test.each([
        [ "a constant", () => stmts[0].declarations[0].name, "LIMIT" ],
        [ "the first parameter", () => fn.expr.signature.params[0].name, "r" ],
        [ "the second parameter", () => fn.expr.signature.params[1].name, "s" ],
        [ "a `let`", () => body[0].declarations[0].name, "x" ],
        [ "a destructured field", () => [ ...body[1].declarations[0].fields.values() ][1].name, "b" ],
        [ "an array element", () => body[2].declarations[0].elements[0].name, "h" ],
        [ "an array rest", () => body[2].declarations[0].rest, "t" ],
        [ "a contract", () => stmts[2].name, "C" ],
    ])( "%s", ( _, get, name ) => {
        expect( named( get() ) ).toBe( name );
    });
});

/** a parse error is a diagnostic: the parser printed token names to the console on three of them */
describe("the parser reports errors only as diagnostics", () => {

    test.each([
        [ "a contract member", `contract C {\n    nope x() {}\n}\n` ],
        [ "a data declaration without `struct`", `data X {}\n` ],
        [ "a for loop's updates", `function f(): int {\n    for( let i = 0; i < 3; i++ x ) {}\n    return 0;\n}\n` ],
    ])( "%s", ( _, text ) => {
        const log = jest.spyOn( console, "log" ).mockImplementation( () => {} );
        const error = jest.spyOn( console, "error" ).mockImplementation( () => {} );
        try {
            const [ , diagnostics ] = Parser.parseFile( "/src/main.pebble", text );
            expect( diagnostics.length ).toBeGreaterThan( 0 );
            expect( log ).not.toHaveBeenCalled();
            expect( error ).not.toHaveBeenCalled();
        }
        finally {
            log.mockRestore();
            error.mockRestore();
        }
    });
});
