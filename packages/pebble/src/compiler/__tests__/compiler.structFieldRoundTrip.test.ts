import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

// Struct-field round-trip matrix (BUGs 27 / 41 / 42 / 43 / 44 regression):
// every common field type × both encodings × three declaration shapes
// (single-constructor, multi-constructor with dispatch, generic
// instantiation), constructed and read back — asserted by EVALUATION.
//
// This class of bug kept shipping because nothing constructed a struct with
// a non-trivial field type and *ran* it: SoP literals hardcoding ctor 0
// (27), list fields consed onto the wrong nil (41), SoP-optional payloads
// stored raw while consumers expect data (42), a shared hoisted mutated
// across compiles (43), and optional fields flattened as single-ctor
// structs (44) all type-checked clean.

async function compileFn( src: string ): Promise<UPLCTerm> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: "main", entry: "test.pebble", root: "/" });
    if( c.diagnostics.length )
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));
    return parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
}

function evalInt1( uplc: UPLCTerm, n: bigint ): bigint {
    const r = Machine.eval( new Application( uplc, UPLCConst.int( n ) ) ).result;
    if( !( r instanceof CEKConst ) ) throw new Error( "eval failed: " + JSON.stringify( (r as any).msg ?? r ) );
    return r.value as bigint;
}

jest.setTimeout( 120_000 );

interface FieldCase {
    label: string;
    fieldType: string;
    /** initializer for the field (may reference `n`) */
    init: string;
    /** expression over `v` (the read-back field) reducing it to an int */
    readBack: string;
    /** expected for n = 5 */
    expected: bigint;
    /** extra top-level declarations (helper structs) */
    decls?: string;
}

const CASES: FieldCase[] = [
    { label: "int",               fieldType: "int",               init: "42",                        readBack: "v",                                                        expected: 42n },
    { label: "bytes",             fieldType: "bytes",             init: "#ff",                       readBack: "v == #ff ? 1 : 0",                                         expected: 1n },
    { label: "bool",              fieldType: "bool",              init: "true",                      readBack: "v ? 1 : 0",                                                expected: 1n },
    { label: "nested struct",     fieldType: "Inner",             init: "Inner{ x: 7 }",             readBack: "v.x",                                                      expected: 7n,
      decls: "struct Inner { x: int }" },
    { label: "List<int>",         fieldType: "List<int>",         init: "[ 1, 2, 3 ]",               readBack: "v.length()",                                               expected: 3n },
    { label: "List<bytes>",       fieldType: "List<bytes>",       init: "[ #ff, #00 ]",              readBack: "v.length()",                                               expected: 2n },
    { label: "List<List<int>>",   fieldType: "List<List<int>>",   init: "[ [ 1 ], [ 2, 3 ] ]",       readBack: "v.length()",                                               expected: 2n },
    { label: "Optional<int> Some",fieldType: "Optional<int>",     init: "Some{ value: 7 }",          readBack: "case v is Some{ value } => value is None{} => 0",          expected: 7n },
    { label: "Optional<int> None",fieldType: "Optional<int>",     init: "undefined",                 readBack: "case v is Some{ value } => value is None{} => 9",          expected: 9n },
    { label: "Optional<List<int>>",fieldType: "Optional<List<int>>", init: "Some{ value: [ 1, 2 ] }", readBack: "case v is Some{ value } => value.length() is None{} => 0", expected: 2n },
    // BUG 45: `Value` in a data struct had no Value->data conversion
    { label: "Value",             fieldType: "Value",             init: "std.value.zero",            readBack: "v.toData() == std.value.zero.toData() ? 1 : 0",            expected: 1n },
];

for( const enc of [ "data", "runtime" ] as const )
{
    describe(`field matrix — ${enc} encoding, single constructor`, () => {
        for( const c of CASES )
        {
            test(`${enc} single-ctor + ${c.label}`, async () => {
                const uplc = await compileFn(`
${c.decls ?? ""}
${enc} struct Bx { B{ v: ${c.fieldType} } }
export function main( n: int ): int {
    const b: Bx = Bx.B{ v: ${c.init} };
    return case b is B{ v } => ( ${c.readBack} ) ;
}`);
                expect( evalInt1( uplc, 5n ) ).toBe( c.expected );
            });
        }
    });

    describe(`field matrix — ${enc} encoding, multi constructor (dispatch)`, () => {
        for( const c of CASES )
        {
            test(`${enc} multi-ctor + ${c.label}`, async () => {
                const uplc = await compileFn(`
${c.decls ?? ""}
${enc} struct S { A{ a: int } B{ v: ${c.fieldType} } }
export function main( n: int ): int {
    const s: S = S.B{ v: ${c.init} };
    return case s is A{ a } => 999 is B{ v } => ( ${c.readBack} ) ;
}`);
                expect( evalInt1( uplc, 5n ) ).toBe( c.expected );
            });
        }
    });

    describe(`field matrix — ${enc} encoding, generic instantiation`, () => {
        for( const c of CASES )
        {
            test(`${enc} G<T> @ ${c.label}`, async () => {
                const uplc = await compileFn(`
${c.decls ?? ""}
${enc} struct G<T> { C{ v: T } }
export function main( n: int ): int {
    const s: G<${c.fieldType}> = G.C{ v: ${c.init} };
    return case s is C{ v } => ( ${c.readBack} ) ;
}`);
                expect( evalInt1( uplc, 5n ) ).toBe( c.expected );
            });
        }
    });
}

// non-constant initializers exercise the non-folded encoder path
describe("field matrix — runtime-built initializers", () => {
    test("data struct + List<int> built from the argument (BUG 41 original repro)", async () => {
        const uplc = await compileFn(`
data struct Bx { B{ items: List<int> } }
export function main( n: int ): int {
    const b: Bx = Bx.B{ items: [ n, n + 1 ] };
    return case b is B{ items } => items.head() ;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("generic data struct + List<T> @ bytes (was a backend crash)", async () => {
        const uplc = await compileFn(`
data struct Box<T> { B{ items: List<T> } }
export function main( n: int ): int {
    const b: Box<bytes> = Box.B{ items: [ #ff ] };
    return case b is B{ items } => ( items.head() == #ff ? 1 : 0 ) ;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 1n );
    });

    test("multi-ctor runtime struct + Optional built from the argument (BUG 42 original repro)", async () => {
        const uplc = await compileFn(`
runtime struct S { A{ a: int } B{ f: Optional<int> } }
export function main( n: int ): int {
    const s: S = S.B{ f: Some{ value: n } };
    return case s is A{ a } => 999 is B{ f } => ( case f is Some{ value } => value is None{} => 0 ) ;
}`);
        expect( evalInt1( uplc, 5n ) ).toBe( 5n );
    });

    test("for-of over a data-struct list field sums correctly", async () => {
        const uplc = await compileFn(`
struct BoxL { v: List<int> }
export function main( n: int ): int {
    const b: BoxL = BoxL{ v: [n, 1, 2] };
    let sum: int = 0;
    for( const x of b.v ) { sum = sum + x; }
    return sum;
}`);
        expect( evalInt1( uplc, 10n ) ).toBe( 13n );
    });
});
