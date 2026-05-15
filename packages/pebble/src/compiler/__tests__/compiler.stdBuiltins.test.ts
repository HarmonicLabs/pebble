import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

async function compileSrc( src: string, functionName: string = "main" )
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([
            ["src/main.pebble", fromUtf8(src)],
        ]),
        useConsoleAsOutput: false,
    });
    const compiler = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await compiler.export({ functionName, entry: "src/main.pebble", root: "/" });
    return compiler;
}

describe("std namespace builtins", () => {

    test("std.crypto.sha2_256 compiles", async () => {
        const src = `
function main( b: bytes ): bytes {
    return std.crypto.sha2_256( b );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.crypto.blake2b_256 compiles", async () => {
        const src = `
function main( b: bytes ): bytes {
    return std.crypto.blake2b_256( b );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.crypto.verifyEd25519Signature compiles", async () => {
        const src = `
function main( pk: bytes, msg: bytes, sig: bytes ): boolean {
    return std.crypto.verifyEd25519Signature( pk, msg, sig );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.builtins.addInteger compiles", async () => {
        const src = `
function main( a: int, b: int ): int {
    return std.builtins.addInteger( a, b );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.builtins.equalsData compiles", async () => {
        const src = `
function main( a: data, b: data ): boolean {
    return std.builtins.equalsData( a, b );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("RawConstr.index field access compiles", async () => {
        const src = `
function main( d: data ): int {
    let r: RawConstr = std.builtins.unConstrData( d );
    return r.index;
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("BLS12-381 G1 add round-trip compiles", async () => {
        const src = `
function main( p1: bytes, p2: bytes ): bytes {
    using { G1 } = std.crypto.bls12_381;
    let g1: G1 = std.crypto.bls12_381.g1Uncompress( p1 );
    let g2: G1 = std.crypto.bls12_381.g1Uncompress( p2 );
    let sum: G1 = std.crypto.bls12_381.g1Add( g1, g2 );
    return std.crypto.bls12_381.g1Compress( sum );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.builtins.trace<int> compiles", async () => {
        const src = `
function main( n: int ): int {
    return std.builtins.trace<int>( #41, n );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.builtins.mkCons / headList / tailList on List<int> compile", async () => {
        const src = `
function main( xs: List<int> ): int {
    let prepended: List<int> = std.builtins.mkCons<int>( 7, xs );
    return std.builtins.headList<int>( prepended );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("std.builtins.ifThenElse<int> compiles", async () => {
        const src = `
function main( cond: boolean, a: int, b: int ): int {
    return std.builtins.ifThenElse<int>( cond, a, b );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });

    test("BLS12-381 miller loop + finalVerify compiles", async () => {
        const src = `
function main( g1a: bytes, g2a: bytes, g1b: bytes, g2b: bytes ): boolean {
    using { G1, G2, MlResult } = std.crypto.bls12_381;
    let aG1: G1 = std.crypto.bls12_381.g1Uncompress( g1a );
    let aG2: G2 = std.crypto.bls12_381.g2Uncompress( g2a );
    let bG1: G1 = std.crypto.bls12_381.g1Uncompress( g1b );
    let bG2: G2 = std.crypto.bls12_381.g2Uncompress( g2b );
    let mA: MlResult = std.crypto.bls12_381.millerLoop( aG1, aG2 );
    let mB: MlResult = std.crypto.bls12_381.millerLoop( bG1, bG2 );
    return std.crypto.bls12_381.finalVerify( mA, mB );
}`;
        const compiler = await compileSrc( src );
        expect( compiler.diagnostics ).toEqual( [] );
    });
});
