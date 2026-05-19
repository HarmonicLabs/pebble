import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, Case as UplcCase, Force, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { CEKConst, Machine } from "@harmoniclabs/buildooor";

async function compileSingleFn( name: string, src: string ): Promise<UPLCTerm> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: name, entry: "test.pebble", root: "/" });
    if( c.diagnostics.length ) {
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));
    }
    return parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;
}

async function checkOnly( src: string ): Promise<string[]> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.check({ entry: "test.pebble", root: "/" });
    return c.diagnostics.map(d => d.toString());
}

function countCases( t: UPLCTerm ): number {
    let n = 0;
    const visit = ( x: any ) => {
        if( x instanceof UplcCase ) n++;
        if( x && typeof x === "object" ) {
            for( const k of Object.keys( x ) ) {
                if( k === "parent" ) continue;
                visit( (x as any)[k] );
            }
        }
    };
    visit( t );
    return n;
}

function evalInt1( uplc: UPLCTerm, n: bigint ): bigint {
    const r = Machine.eval( new Application( uplc, UPLCConst.int( n ) ) ).result;
    return (r as CEKConst).value as bigint;
}

function evalBool1( uplc: UPLCTerm, n: bigint ): boolean {
    const r = Machine.eval( new Application( uplc, UPLCConst.int( n ) ) ).result;
    return (r as CEKConst).value as boolean;
}

describe("enum support", () => {

    const fruitEnum = `
enum Fruit {
    Apple,
    Orange,
    Banana,
    Watermelon
}
`;

    test("case expression with all members", async () => {
        const uplc = await compileSingleFn(
            "pick",
            fruitEnum + `
export function pick( f: Fruit ): int {
    return case f
        is Apple      => 1
        is Orange     => 2
        is Banana     => 3
        is Watermelon => 4
        ;
}
`
        );
        expect( countCases( uplc ) ).toBeGreaterThan( 0 );
        expect( evalInt1( uplc, 0n ) ).toBe( 1n );
        expect( evalInt1( uplc, 1n ) ).toBe( 2n );
        expect( evalInt1( uplc, 2n ) ).toBe( 3n );
        expect( evalInt1( uplc, 3n ) ).toBe( 4n );
    });

    test("case with braced and bare patterns mixed", async () => {
        const uplc = await compileSingleFn(
            "pick",
            fruitEnum + `
export function pick( f: Fruit ): int {
    return case f
        is Apple{}    => 10
        is Orange     => 20
        is Banana{}   => 30
        is Watermelon => 40
        ;
}
`
        );
        expect( evalInt1( uplc, 0n ) ).toBe( 10n );
        expect( evalInt1( uplc, 1n ) ).toBe( 20n );
        expect( evalInt1( uplc, 2n ) ).toBe( 30n );
        expect( evalInt1( uplc, 3n ) ).toBe( 40n );
    });

    test("`is EnumMember` returns bool", async () => {
        const uplc = await compileSingleFn(
            "isOrange",
            fruitEnum + `
export function isOrange( f: Fruit ): boolean {
    return f is Orange;
}
`
        );
        expect( evalBool1( uplc, 0n ) ).toBe( false );
        expect( evalBool1( uplc, 1n ) ).toBe( true  );
        expect( evalBool1( uplc, 2n ) ).toBe( false );
        expect( evalBool1( uplc, 3n ) ).toBe( false );
    });

    test("member literal Fruit.Apple is 0", async () => {
        // no-arg functions are compiled to a Delay, so force them at eval.
        const uplc = await compileSingleFn(
            "ofApple",
            fruitEnum + `
export function ofApple(): Fruit {
    return Fruit.Apple;
}
`
        );
        const r = Machine.eval( new Force( uplc ) ).result;
        expect( (r as CEKConst).value ).toBe( 0n );
    });

    test("match statement", async () => {
        const uplc = await compileSingleFn(
            "pickM",
            fruitEnum + `
export function pickM( f: Fruit ): int {
    match (f) {
        when Apple: { return 100; }
        when Orange: { return 200; }
        when Banana: { return 300; }
        when Watermelon: { return 400; }
    }
}
`
        );
        expect( evalInt1( uplc, 0n ) ).toBe( 100n );
        expect( evalInt1( uplc, 1n ) ).toBe( 200n );
        expect( evalInt1( uplc, 2n ) ).toBe( 300n );
        expect( evalInt1( uplc, 3n ) ).toBe( 400n );
    });

    test("error: explicit value", async () => {
        const diags = await checkOnly(`
enum E { A = 5, B }
export function f(): int { return 0; }
`);
        expect( diags.some(d => d.toLowerCase().includes("explicit value")) ).toBe( true );
    });

    test("error: duplicate member", async () => {
        const diags = await checkOnly(`
enum E { A, A }
export function f(): int { return 0; }
`);
        expect( diags.some(d => d.toLowerCase().includes("duplicate enum member")) ).toBe( true );
    });

    test("error: empty enum", async () => {
        const diags = await checkOnly(`
enum E { }
export function f(): int { return 0; }
`);
        expect( diags.some(d => d.toLowerCase().includes("at least one member")) ).toBe( true );
    });

    test("error: unknown member in case", async () => {
        const diags = await checkOnly(fruitEnum + `
export function pick( f: Fruit ): int {
    return case f
        is Apple  => 1
        is Mango  => 2
        is Orange => 3
        is Banana => 4
        is Watermelon => 5
        ;
}
`);
        expect( diags.some(d => d.toLowerCase().includes("mango")) ).toBe( true );
    });

    test("enum used in arithmetic (enum + int)", async () => {
        const uplc = await compileSingleFn(
            "tagPlusOne",
            fruitEnum + `
export function tagPlusOne( f: Fruit ): int {
    return f + 1;
}
`
        );
        expect( evalInt1( uplc, 0n ) ).toBe( 1n );
        expect( evalInt1( uplc, 2n ) ).toBe( 3n );
    });

    test("enum compared against int literal", async () => {
        const uplc = await compileSingleFn(
            "isFirstHalf",
            fruitEnum + `
export function isFirstHalf( f: Fruit ): boolean {
    return f < 2;
}
`
        );
        expect( evalBool1( uplc, 0n ) ).toBe( true );
        expect( evalBool1( uplc, 1n ) ).toBe( true );
        expect( evalBool1( uplc, 2n ) ).toBe( false );
        expect( evalBool1( uplc, 3n ) ).toBe( false );
    });

    test("enum equality against int literal", async () => {
        const uplc = await compileSingleFn(
            "isApple",
            fruitEnum + `
export function isApple( f: Fruit ): boolean {
    return f == 0;
}
`
        );
        expect( evalBool1( uplc, 0n ) ).toBe( true );
        expect( evalBool1( uplc, 1n ) ).toBe( false );
    });

    test("error: int → enum cast is rejected", async () => {
        const diags = await checkOnly(fruitEnum + `
export function ofInt( n: int ): Fruit {
    return n as Fruit;
}
`);
        expect( diags.length ).toBeGreaterThan( 0 );
    });

    test("error: int not assignable to enum", async () => {
        const diags = await checkOnly(fruitEnum + `
export function ofInt(): Fruit {
    return 0;
}
`);
        expect( diags.length ).toBeGreaterThan( 0 );
    });

    test("error: non-exhaustive match without wildcard", async () => {
        const diags = await checkOnly(fruitEnum + `
export function pickM( f: Fruit ): int {
    match (f) {
        when Apple: { return 1; }
        when Orange: { return 2; }
    }
}
`);
        expect( diags.some(d => d.toLowerCase().includes("exhaustive")) ).toBe( true );
    });
});
