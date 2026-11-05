import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import type { PebbleSymbol } from "../SymbolIndex";

/** `Compiler.check()` on the given files, `src/main.pebble` as the entry */
async function check( files: Record<string, string> )
{
    const io = createMemoryCompilerIoApi({
        sources: new Map( Object.entries( files ).map( ([ path, text ]) => [ path, fromUtf8( text ) ] ) ),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler( io, { ...testOptions, compilerVersion: COMPILER_VERSION } );
    return await compiler.check({ entry: "src/main.pebble", root: "/" });
}

/** the offset of the `nth` (from 0) occurrence of `word` as a whole word in `text` */
function at( text: string, word: string, nth: number = 0 ): number
{
    const re = new RegExp( `(?<![A-Za-z0-9_])${word.replace( /[.*+?^${}()|[\]\\]/g, "\\$&" )}(?![A-Za-z0-9_])`, "g" );
    let m: RegExpExecArray | null;
    for( let i = 0; ( m = re.exec( text ) ) !== null; i++ ) if( i === nth ) return m.index;
    throw new Error( `no ${nth}th '${word}'` );
}

/** where a symbol and its references are, as `file:offset` */
const where = ( s: PebbleSymbol ) => `${s.source}:${s.nameRange.start}`;

describe("symbol index: values", () => {

    // two functions with a parameter of the same name (defect L4 and L6 of the LSP plan)
    const main = `export function isValidRect( r: int ): boolean {
    return 0 <= r && r < 1008;
}

export function rectArea( r: int ): int {
    return r * r;
}
`;

    test("a parameter's uses are its own, not those of another with the same name", async () => {
        const { symbols } = await check({ "src/main.pebble": main });
        const r = symbols.symbolAt( "/src/main.pebble", at( main, "r", 1 ) )!; // in `0 <= r`
        expect( r.kind ).toBe( "parameter" );
        expect( r.nameRange.start ).toBe( at( main, "r", 0 ) );
        expect( symbols.references( r ).map( x => x.range.start ) ).toEqual([ at( main, "r", 1 ), at( main, "r", 2 ) ]);

        const other = symbols.symbolAt( "/src/main.pebble", at( main, "r", 4 ) )!; // in `r * r`
        expect( other.nameRange.start ).toBe( at( main, "r", 3 ) );
        expect( symbols.references( other ).map( x => x.range.start ) ).toEqual([ at( main, "r", 4 ), at( main, "r", 5 ) ]);
        // its declaration names it too
        expect( symbols.symbolAt( "/src/main.pebble", at( main, "r", 3 ) ) ).toBe( other );
    });

    test("an inner declaration shadows an outer one in its block only", async () => {
        const text = `export function f( a: int ): int {
    let x = a;
    if( a > 0 ) {
        let x = 2;
        return x;
    }
    return x;
}
`;
        const { symbols } = await check({ "src/main.pebble": text });
        const inner = symbols.symbolAt( "/src/main.pebble", at( text, "x", 2 ) )!;
        const outer = symbols.symbolAt( "/src/main.pebble", at( text, "x", 3 ) )!;
        expect( inner.nameRange.start ).toBe( at( text, "x", 1 ) );
        expect( outer.nameRange.start ).toBe( at( text, "x", 0 ) );
        expect( outer.kind ).toBe( "variable" );
        expect( symbols.references( outer ).map( r => r.range.start ) ).toEqual([ at( text, "x", 3 ) ]);
    });

    test("a function: its calls, including its own", async () => {
        const text = `export function fib( n: int ): int {
    if( n <= 1 ) return n;
    return fib( n - 1 ) + fib( n - 2 );
}

export function g( x: int ): int { return fib( x ); }
`;
        const { symbols } = await check({ "src/main.pebble": text });
        const fib = symbols.symbolAt( "/src/main.pebble", at( text, "fib", 3 ) )!;
        expect( fib.kind ).toBe( "function" );
        expect( fib.exported ).toBe( true );
        expect( fib.nameRange.start ).toBe( at( text, "fib", 0 ) );
        expect( symbols.references( fib ).map( r => r.range.start ) ).toEqual([ at( text, "fib", 1 ), at( text, "fib", 2 ), at( text, "fib", 3 ) ]);
        expect( fib.type?.toString() ).toContain( "int" );
    });

    test("a top-level constant, read by a function", async () => {
        const text = `const LIMIT = 1008;

export function under( x: int ): boolean { return x < LIMIT; }
`;
        const { symbols } = await check({ "src/main.pebble": text });
        const limit = symbols.symbolAt( "/src/main.pebble", at( text, "LIMIT", 1 ) )!;
        expect( limit.kind ).toBe( "constant" );
        expect( limit.nameRange.start ).toBe( at( text, "LIMIT", 0 ) );
        expect( limit.visibleIn ).toEqual({ start: 0, end: text.length });
    });

    test("an assignment is a write", async () => {
        const text = `export function f( a: int ): int {
    let x = a;
    x = x + 1;
    x++;
    return x;
}
`;
        const { symbols } = await check({ "src/main.pebble": text });
        const x = symbols.symbolAt( "/src/main.pebble", at( text, "x", 0 ) )!;
        expect( symbols.references( x ).map( r => [ r.range.start, r.write ] ) ).toEqual([
            [ at( text, "x", 1 ), true ],
            [ at( text, "x", 2 ), false ],
            [ at( text, "x", 3 ), true ],
            [ at( text, "x", 4 ), false ],
        ]);
    });

    test("a generic function's parameter is one symbol, whatever it is instantiated with", async () => {
        const text = `function id<T>( v: T ): T { return v; }

export function f( a: int, b: bytes ): int {
    const c = id( b );
    return id( a );
}
`;
        const { symbols, diagnostics } = await check({ "src/main.pebble": text });
        expect( diagnostics ).toEqual( [] );
        const v = symbols.symbolAt( "/src/main.pebble", at( text, "v", 1 ) )!;
        expect( v.nameRange.start ).toBe( at( text, "v", 0 ) );
        expect( symbols.references( v ).map( r => r.range.start ) ).toEqual([ at( text, "v", 1 ) ]);
        const id = symbols.symbolAt( "/src/main.pebble", at( text, "id", 2 ) )!;
        expect( id.nameRange.start ).toBe( at( text, "id", 0 ) );
        expect( symbols.references( id ).map( r => r.range.start ) ).toEqual([ at( text, "id", 1 ), at( text, "id", 2 ) ]);
    });

    test("names visible at a position, innermost first", async () => {
        const text = `const TOP = 1;

export function f( a: int ): int {
    const b = a + TOP;
    if( b > 0 ) {
        const a = 2;
        return a + b;
    }
    const later = 3;
    return later;
}
`;
        const { symbols } = await check({ "src/main.pebble": text });
        const names = ( offset: number ) => symbols.visibleAt( "/src/main.pebble", offset ).map( s => `${s.name}@${s.nameRange.start}` );
        // inside the block: the inner `a`, then `b`, the parameter `a` is shadowed
        const innerA = `a@${at( text, "a", 2 )}`, paramA = `a@${at( text, "a", 0 )}`;
        const inBlock = names( text.indexOf( "return a + b" ) );
        expect( inBlock ).toContain( innerA );
        expect( inBlock ).not.toContain( paramA );
        expect( inBlock ).toContain( `b@${at( text, "b", 0 )}` );
        expect( inBlock ).toContain( `TOP@${at( text, "TOP", 0 )}` );
        expect( inBlock ).toContain( `f@${at( text, "f", 0 )}` );
        expect( inBlock.indexOf( innerA ) ).toBeLessThan( inBlock.indexOf( `TOP@${at( text, "TOP", 0 )}` ) );
        // a declaration is not visible before itself, nor outside its block
        expect( inBlock.some( n => n.startsWith( "later@" ) ) ).toBe( false );
        expect( names( text.indexOf( "const later" ) ) ).not.toContain( innerA );
        expect( names( text.indexOf( "const later" ) ) ).toContain( paramA );
    });
});

describe("symbol index: across files", () => {

    const lib = `export function g( x: int ): int { return x + 1; }

export const K = 3;
`;

    test("an import names the exported declaration: definitions and references cross files", async () => {
        const main = `import { g, K } from "./lib";

export function f( x: int ): int { return g( x ) + g( K ); }
`;
        const { symbols } = await check({ "src/main.pebble": main, "src/lib.pebble": lib });
        const use = symbols.symbolAt( "/src/main.pebble", at( main, "g", 1 ) )!;
        expect( use.kind ).toBe( "import" );
        const g = symbols.definitionOf( use );
        expect( where( g ) ).toBe( `/src/lib.pebble:${at( lib, "g" )}` );
        expect( g.exported ).toBe( true );
        expect( symbols.references( g ).map( r => `${r.range.source.absoluteProjPath}:${r.range.start}` ) ).toEqual([
            `/src/main.pebble:${at( main, "g", 0 )}`,
            `/src/main.pebble:${at( main, "g", 1 )}`,
            `/src/main.pebble:${at( main, "g", 2 )}`,
        ]);
        const k = symbols.definitionOf( symbols.symbolAt( "/src/main.pebble", at( main, "K", 1 ) )! );
        expect( where( k ) ).toBe( `/src/lib.pebble:${at( lib, "K" )}` );
        expect( k.kind ).toBe( "constant" );
    });

    test("an alias is a name of its own; the imported name names the declaration", async () => {
        const main = `import { g as h } from "./lib";

export function f( x: int ): int { return h( x ); }
`;
        const { symbols, diagnostics } = await check({ "src/main.pebble": main, "src/lib.pebble": lib });
        expect( diagnostics ).toEqual( [] );
        const h = symbols.symbolAt( "/src/main.pebble", at( main, "h", 1 ) )!;
        expect( h.name ).toBe( "h" );
        expect( h.nameRange.start ).toBe( at( main, "h", 0 ) );
        const g = symbols.definitionOf( h );
        expect( where( g ) ).toBe( `/src/lib.pebble:${at( lib, "g" )}` );
        // renaming `g` changes `g as`, not the uses of `h`
        expect( symbols.references( g ).map( r => `${r.range.source.absoluteProjPath}:${r.range.start}` ) ).toEqual([
            `/src/main.pebble:${at( main, "g" )}`,
        ]);
        expect( symbols.references( h ).map( r => r.range.start ) ).toEqual([ at( main, "h", 1 ) ]);
    });
});

describe("symbol index: types and their members", () => {

    const lib = `export struct Coordinates {
    x0: int,
    y0: int
}

export struct Shape {
    Circle { r: int }
    Square { side: int }
}

type Coordinates implements {
    area( self ): int { return self.x0 * self.y0; }
}
`;

    test("a struct: its name in annotations and literals, its fields, its methods", async () => {
        const main = lib + `
export function f( c: Coordinates ): int {
    const d: Coordinates = Coordinates{ x0: c.y0, y0: 2 };
    const Coordinates{ x0 } = d;
    return x0 + d.area();
}
`;
        const { symbols, diagnostics } = await check({ "src/main.pebble": main });
        expect( diagnostics ).toEqual( [] );
        const file = "/src/main.pebble";
        const coords = symbols.symbolAt( file, at( main, "Coordinates", 3 ) )!; // `c: Coordinates`
        expect( coords.kind ).toBe( "struct" );
        expect( coords.nameRange.start ).toBe( at( main, "Coordinates", 0 ) );
        // the implements, the annotations, the literal, the destructuring
        expect( symbols.references( coords ).map( r => r.range.start ) ).toEqual(
            [ 1, 2, 3, 4, 5 ].map( n => at( main, "Coordinates", n ) )
        );

        const y0 = symbols.symbolAt( file, at( main, "y0", 1 ) )!; // `self.y0`, in the method
        expect( y0.kind ).toBe( "field" );
        expect( y0.container ).toBe( coords );
        expect( y0.nameRange.start ).toBe( at( main, "y0", 0 ) );
        // the method's `self.y0`, `c.y0`, the literal's `y0:`
        expect( symbols.references( y0 ).map( r => r.range.start ) ).toEqual(
            [ 1, 2, 3 ].map( n => at( main, "y0", n ) )
        );
        // the destructuring's label names the field; `return x0` names the variable it declares
        const x0 = symbols.fieldOf( coords, "Coordinates", "x0" )!;
        expect( symbols.references( x0 ).map( r => r.range.start ) ).toEqual(
            [ 1, 2, 3 ].map( n => at( main, "x0", n ) )
        );
        const local = symbols.symbolAt( file, at( main, "x0", 4 ) )!;
        expect( local.kind ).toBe( "constant" );
        expect( local.nameRange.start ).toBe( at( main, "x0", 3 ) );

        const area = symbols.symbolAt( file, at( main, "area", 1 ) )!;
        expect( area.kind ).toBe( "method" );
        expect( area.container ).toBe( coords );
        expect( area.nameRange.start ).toBe( at( main, "area", 0 ) );
        expect( symbols.membersOf( coords ).map( m => `${m.kind} ${m.name}` ) ).toEqual([ "field x0", "field y0", "method area" ]);
    });

    test("a struct with constructors: each its own, with its own fields", async () => {
        const main = lib + `
export function g( s: Shape ): int {
    const c = Shape.Circle{ r: 1 };
    const Circle{ r } = c;
    return r;
}
`;
        const { symbols, diagnostics } = await check({ "src/main.pebble": main });
        expect( diagnostics ).toEqual( [] );
        const file = "/src/main.pebble";
        const shape = symbols.symbolAt( file, at( main, "Shape", 1 ) )!;
        expect( shape.kind ).toBe( "struct" );
        const circle = symbols.symbolAt( file, at( main, "Circle", 1 ) )!;
        expect( circle.kind ).toBe( "constructor" );
        expect( circle.container ).toBe( shape );
        expect( circle.nameRange.start ).toBe( at( main, "Circle", 0 ) );
        expect( symbols.references( circle ).map( r => r.range.start ) ).toEqual([ at( main, "Circle", 1 ), at( main, "Circle", 2 ) ]);
        const r = symbols.fieldOf( shape, "Circle", "r" )!;
        expect( r.container ).toBe( circle );
        expect( symbols.references( r ).map( x => x.range.start ) ).toEqual([ at( main, "r", 1 ), at( main, "r", 2 ) ]);
    });

    test("an imported struct: its uses name the exported declaration", async () => {
        const main = `import { Coordinates } from "./lib";

export function f( c: Coordinates ): int { return c.x0; }
`;
        const { symbols, diagnostics } = await check({ "src/main.pebble": main, "src/lib.pebble": lib });
        expect( diagnostics ).toEqual( [] );
        const use = symbols.symbolAt( "/src/main.pebble", at( main, "Coordinates", 1 ) )!;
        const coords = symbols.definitionOf( use );
        expect( where( coords ) ).toBe( `/src/lib.pebble:${at( lib, "Coordinates", 0 )}` );
        expect( symbols.references( coords ).filter( r => r.range.source.absoluteProjPath === "/src/main.pebble" ).map( r => r.range.start ) )
            .toEqual([ at( main, "Coordinates", 0 ), at( main, "Coordinates", 1 ) ]);
        const x0 = symbols.definitionOf( symbols.symbolAt( "/src/main.pebble", at( main, "x0" ) )! );
        expect( where( x0 ) ).toBe( `/src/lib.pebble:${at( lib, "x0", 0 )}` );
    });
});

describe("symbol index: other declarations", () => {

    test("type aliases, enums and tests are declared; aliases are named in annotations", async () => {
        const main = `type Amount = int;
enum Color { Red, Green }

export function f( a: Amount ): Amount { return a; }

test adds() {
    assert f( 1 ) == 1;
}
`;
        const { symbols, diagnostics } = await check({ "src/main.pebble": main });
        expect( diagnostics ).toEqual( [] );
        const kinds = symbols.declarationsOf( "/src/main.pebble" ).map( s => `${s.kind} ${s.name}` );
        expect( kinds ).toEqual( expect.arrayContaining([ "type Amount", "enum Color", "function f", "parameter a", "test adds" ]) );
        const amount = symbols.symbolAt( "/src/main.pebble", at( main, "Amount", 1 ) )!;
        expect( amount.kind ).toBe( "type" );
        expect( symbols.references( amount ).map( r => r.range.start ) ).toEqual([ at( main, "Amount", 1 ), at( main, "Amount", 2 ) ]);
        // the test calls `f`
        const f = symbols.symbolAt( "/src/main.pebble", at( main, "f", 1 ) )!;
        expect( f.nameRange.start ).toBe( at( main, "f", 0 ) );
    });
});
