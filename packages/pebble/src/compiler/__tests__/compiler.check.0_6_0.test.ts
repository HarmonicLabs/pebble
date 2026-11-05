import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { DiagnosticCode } from "../../diagnostics/diagnosticMessages.generated";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

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

describe("imports that cannot be resolved", () => {

    test("a missing file is reported once, at the import", async () => {
        const main = `import { a } from "./missing";

export function f( x: int ): int { return x; }
`;
        const { diagnostics } = await check({ "src/main.pebble": main });
        const notFound = diagnostics.filter( d => d.code === DiagnosticCode.File_0_not_found );
        expect( notFound ).toHaveLength( 1 );
        expect( notFound[0].range?.start ).toBe( main.indexOf( `"./missing"` ) );
    });

    test("a missing file does not unbind the imports after it", async () => {
        const main = `import { a } from "./missing";
import { b } from "./ok";

export function f( x: int ): int {
    const s: int = #00;
    return b( x );
}
`;
        const ok = `export function b( x: int ): int { return x + 1; }`;
        const { diagnostics } = await check({ "src/main.pebble": main, "src/ok.pebble": ok });
        // the rest of the file is checked: its own error, and nothing about `b`
        expect( diagnostics.map( d => d.code ) ).toEqual([
            DiagnosticCode.File_0_not_found,
            DiagnosticCode.Type_0_is_not_assignable_to_type_1,
        ]);
    });

    test("a path above the root is reported once, at the import", async () => {
        const main = `import { a } from "../../far";

export function f( x: int ): int { return x; }
`;
        const { diagnostics } = await check({ "src/main.pebble": main });
        expect( diagnostics.map( d => [ d.code, d.range?.start ] ) ).toEqual([
            [ DiagnosticCode.File_0_not_found, main.indexOf( `"../../far"` ) ],
        ]);
        expect( diagnostics[0].message ).toContain( "../../far" );
    });

    // a declaration whose body or value fails is still declared (a6982227, 30a63fc7): so is
    // its export, or every importer reports it missing
    test.each([
        [ "a function whose body fails", `export function g( x: int ): int { return #01; }`, `g( x )` ],
        [ "a function whose signature fails", `export function g( x: Nope ): int { return 1; }`, `g( x )` ],
        [ "a constant whose value fails", `export const g: int = #01;`, `g + x` ],
        [ "a constant with no type", `export const g = nope;`, `g + x` ],
    ])( "%s is still exported", async ( _, lib, use ) => {
        const main = `import { g } from "./lib";

export function f( x: int ): int { return ${use}; }
`;
        const files = { "src/main.pebble": main, "src/lib.pebble": lib };
        const { diagnostics } = await check( files );
        expect( diagnostics.length ).toBeGreaterThan( 0 );
        expect( diagnostics.filter( d => d.range?.source.absoluteProjPath !== "/src/lib.pebble" ) ).toEqual( [] );

        // compiling reports the same: nothing in the importer
        const io = createMemoryCompilerIoApi({
            sources: new Map( Object.entries( files ).map( ([ path, text ]) => [ path, fromUtf8( text ) ] ) ),
            useConsoleAsOutput: false,
        });
        const compiler = new Compiler( io, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        await expect( compiler.export({ functionName: "f", entry: "src/main.pebble", root: "/" }) ).rejects.toBeDefined();
        expect( compiler.diagnostics.filter( d => d.range?.source.absoluteProjPath !== "/src/lib.pebble" ) ).toEqual( [] );
    });

    test("a failed export is re-exported", async () => {
        const main = `import { g } from "./reexport";

export function f( x: int ): int { return g( x ); }
`;
        const { diagnostics } = await check({
            "src/main.pebble": main,
            "src/reexport.pebble": `export { g } from "./lib";`,
            "src/lib.pebble": `export function g( x: Nope ): int { return 1; }`,
        });
        expect( diagnostics.map( d => d.range?.source.absoluteProjPath ) ).toEqual([ "/src/lib.pebble" ]);
    });

    // `import { b as c }` bound `b`: the alias was parsed, and dropped
    test("an import binds its alias", async () => {
        const lib = `export function b( x: int ): int { return x + 1; }
export const K = 2;
export struct P { v: int }
`;
        const main = `import { b as inc, K as two, P as Q } from "./lib";

export function f( x: int ): int {
    const q: Q = P{ v: two };
    return inc( x ) + q.v;
}
`;
        const { diagnostics } = await check({ "src/main.pebble": main, "src/lib.pebble": lib });
        expect( diagnostics ).toEqual( [] );
        const original = await check({ "src/main.pebble": main.replace( "inc( x )", "b( x )" ), "src/lib.pebble": lib });
        expect( original.diagnostics.map( d => [ d.code, d.message ] ) ).toEqual([ [ DiagnosticCode._0_is_not_defined, "'b' is not defined" ] ]);
    });

    test("an empty file is found, and exports nothing", async () => {
        const main = `import { a } from "./empty";

export function f( x: int ): int { return x; }
`;
        const { diagnostics } = await check({ "src/main.pebble": main, "src/empty.pebble": "" });
        expect( diagnostics.map( d => d.code ) ).toEqual([ DiagnosticCode.Module_0_has_no_exported_member_1 ]);
    });
});

/**
 * `check()` serves editors, where the text is often incomplete: it type-checks everything the
 * parser kept, whatever errors other statements or other files have. `compile()` still stops.
 */
describe("check goes past errors", () => {

    const withParseError = `export function first( x: int ): int {
    return x + 1;
}

export function second( c: int ): int {
    const y = c.
    return 2;
}

export function third( z: int ): int {
    const s: int = #00;
    return z * 3;
}
`;

    test("a parse error leaves the other declarations checked", async () => {
        const { diagnostics, sourceTypeMap } = await check({ "src/main.pebble": withParseError });
        const codes = diagnostics.map( d => d.code );
        // the parse error, then the type error of `third`, reported once each
        expect( codes.filter( c => c === DiagnosticCode.Type_0_is_not_assignable_to_type_1 ) ).toHaveLength( 1 );
        expect( diagnostics.find( d => d.code === DiagnosticCode.Type_0_is_not_assignable_to_type_1 )!.range!.start )
            .toBe( withParseError.indexOf( "#00" ) );
        // the others are in `second`: the parse error, and what `c.return` (`return` read as a
        // property name, as TypeScript reads it) means
        const others = diagnostics.filter( d => d.code !== DiagnosticCode.Type_0_is_not_assignable_to_type_1 );
        expect( others.length ).toBeGreaterThan( 0 );
        expect( others.every( d => d.range!.start >= withParseError.indexOf( "const y" ) && d.range!.start < withParseError.indexOf( "export function third" ) ) ).toBe( true );
        // types of the functions around it
        expect( sourceTypeMap.typeAtOffset( withParseError.indexOf( "z * 3" ) )?.type.toString() ).toBe( "int" );
        expect( sourceTypeMap.typeAtOffset( withParseError.indexOf( "x + 1" ) )?.type.toString() ).toBe( "int" );
    });

    test("an error in an imported file leaves the importing file checked", async () => {
        const main = `import { g } from "./broken";
import { b } from "./ok";

export function f( x: int ): int {
    const s: int = #00;
    return b( g( x ) );
}
`;
        const broken = `export function g( x: int ): int {
    return x +;
}
`;
        const ok = `export function b( x: int ): int { return x + 1; }`;
        const { diagnostics, sourceTypeMap } = await check({ "src/main.pebble": main, "src/broken.pebble": broken, "src/ok.pebble": ok });
        const inMain = diagnostics.filter( d => d.range?.source.absoluteProjPath === "/src/main.pebble" );
        expect( inMain.map( d => [ d.code, d.range!.start ] ) ).toEqual([
            [ DiagnosticCode.Type_0_is_not_assignable_to_type_1, main.indexOf( "#00" ) ],
        ]);
        expect( diagnostics.some( d => d.range?.source.absoluteProjPath === "/src/broken.pebble" ) ).toBe( true );
        expect( sourceTypeMap.typeAtOffset( main.indexOf( "x ) )" ) )?.type.toString() ).toBe( "int" );
    });

    test("a type error in the first import leaves the second import and the file checked", async () => {
        const main = `import { g } from "./wrong";
import { b } from "./ok";

export function f( x: int ): int {
    const s: int = #00;
    return b( g( x ) );
}
`;
        const wrong = `export function g( x: int ): int { return #01; }`;
        const ok = `export function b( x: int ): int { return x + 1; }`;
        const { diagnostics } = await check({ "src/main.pebble": main, "src/wrong.pebble": wrong, "src/ok.pebble": ok });
        expect( diagnostics.map( d => [ d.range?.source.absoluteProjPath, d.code ] ) ).toEqual([
            [ "/src/wrong.pebble", DiagnosticCode.Type_0_is_not_assignable_to_type_1 ],
            [ "/src/main.pebble", DiagnosticCode.Type_0_is_not_assignable_to_type_1 ],
        ]);
    });

    // a statement using a name whose declaration failed fails silently (its error is at the
    // declaration): it was not left out, so its whole function was dropped
    test("a statement using a failed declaration leaves the rest of its function checked", async () => {
        const main = `const BAD = nope;

export function f( x: int ): int {
    const a = BAD;
    return x * 2;
}
`;
        const { diagnostics, sourceTypeMap } = await check({ "src/main.pebble": main });
        expect( diagnostics.map( d => d.code ) ).toEqual([ DiagnosticCode._0_is_not_defined ]);
        expect( sourceTypeMap.typeAtOffset( main.indexOf( "x * 2" ) )?.type.toString() ).toBe( "int" );
    });

    test("compile still stops at a parse error", async () => {
        const io = createMemoryCompilerIoApi({
            sources: new Map([ [ "src/main.pebble", fromUtf8( withParseError ) ] ]),
            useConsoleAsOutput: false,
        });
        const compiler = new Compiler( io, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        await expect( compiler.export({ functionName: "third", entry: "src/main.pebble", root: "/" }) ).rejects.toBeDefined();
        expect( compiler.diagnostics.some( d => d.code === DiagnosticCode.Type_0_is_not_assignable_to_type_1 ) ).toBe( false );
        expect( io.outputs.size ).toBe( 0 );
    });
});

/**
 * The type map holds the entries of every file the check compiled. Each knows its file: offsets of
 * two files collide (a hover in the entry answered with a type from an import).
 */
describe("the type map, per file", () => {

    const lib = `export function g( b: bytes ): bytes { return b; }
export function h( n: int ): bytes { return g( #00 ); }
`;
    // a comment over the offsets where `lib` has entries, then code over the rest
    const main = `import { g, h } from "./lib";
// a comment, as long as the first line of lib.pebble, so that its offsets are lib's code
export function f( x: int ): int {
    return x;
}
`;

    test("the entry's lookups answer from the entry only", async () => {
        const { sourceTypeMap } = await check({ "src/main.pebble": main, "src/lib.pebble": lib });
        const comment = main.indexOf( "// a comment" );
        for( let o = comment; o < main.indexOf( "\nexport function f" ); o++ )
            expect( sourceTypeMap.typeAtOffset( o ) ).toBeUndefined();
        // where lib.pebble has code
        const inLib = lib.indexOf( "b; }" );
        expect( inLib > comment && inLib < main.indexOf( "\nexport function f" ) ).toBe( true );
        expect( sourceTypeMap.typeAt( "/src/lib.pebble", inLib ) ).toBeDefined();
        for( let o = 0; o < main.length; o++ )
        {
            const entry = sourceTypeMap.typeAtOffset( o );
            if( entry ) expect( entry.source ).toBe( "/src/main.pebble" );
        }
        expect( sourceTypeMap.typeAtOffset( main.indexOf( "x;" ) )?.type.toString() ).toBe( "int" );
        expect( sourceTypeMap.allEntries().every( e => e.source === "/src/main.pebble" ) ).toBe( true );
    });

    test("an imported file's entries are found by its file", async () => {
        const { sourceTypeMap } = await check({ "src/main.pebble": main, "src/lib.pebble": lib });
        expect( sourceTypeMap.files() ).toEqual( expect.arrayContaining([ "/src/main.pebble", "/src/lib.pebble" ]) );
        expect( sourceTypeMap.typeAt( "/src/lib.pebble", lib.indexOf( "b; }" ) )?.type.toString() ).toBe( "bytes" );
        expect( sourceTypeMap.typeAt( "/src/lib.pebble", lib.indexOf( "#00" ) )?.type.toString() ).toBe( "bytes" );
        const entries = sourceTypeMap.entriesOf( "/src/lib.pebble" );
        expect( entries.length ).toBeGreaterThan( 0 );
        expect( entries.every( e => e.source === "/src/lib.pebble" ) ).toBe( true );
        expect( entries.every( ( e, i ) => i === 0 || entries[ i - 1 ].start <= e.start ) ).toBe( true );
    });
});
