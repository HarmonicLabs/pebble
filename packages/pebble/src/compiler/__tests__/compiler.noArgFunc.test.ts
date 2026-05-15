import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Delay, parseUPLC, prettyUPLC, showUPLC, UPLCConst } from "@harmoniclabs/uplc";
import { IRConst, testOptions, COMPILER_VERSION } from "../../IR";
import { Compiler } from "../Compiler";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";

describe("noArgFunc", () => {

    test("compilesToDelay", async () => {

        const fileName = "test.pebble";
        const srcText = `
function noArgFunc(): int {
    return 42;
}
`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        // const complier = new Compiler( ioApi, { ...defaultOptions, compilerVersion: COMPILER_VERSION } );
        const complier = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await complier.export({ functionName: "noArgFunc", entry: fileName, root: "/" });
        const diagnostics = complier.diagnostics;

        const outputBytes = ioApi.outputs.get("out/out.flat")!;
        const uplc = parseUPLC(outputBytes).body;

        // console.log( prettyUPLC( uplc, 2 ) );
        expect(uplc)
        .toEqual(
            new Delay(
                UPLCConst.int( 42 )
            )
        );

        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect(diagnostics.length).toBe(0);

        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
        expect(outputBytes instanceof Uint8Array).toBe(true);
    });

    test("42 + 69", async () => {

        const fileName = "test.pebble";
        const srcText = `
function get42(): int {
    return 42;
}
function get69(): int {
    return 69;
}
function noArgFunc(): int {
    return get42() + get69();
}
`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        // const complier = new Compiler( ioApi, { ...defaultOptions, compilerVersion: COMPILER_VERSION } );
        const complier = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await complier.export({ functionName: "noArgFunc", entry: fileName, root: "/" });
        const diagnostics = complier.diagnostics;

        const outputBytes = ioApi.outputs.get("out/out.flat")!;
        const uplc = parseUPLC(outputBytes).body;

        // console.log( showUPLC( uplc ) );

        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect(diagnostics.length).toBe(0);

        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
        expect(outputBytes instanceof Uint8Array).toBe(true);
    });

    test("42 + 42", async () => {

        const fileName = "test.pebble";
        const srcText = `
function get42(): int {
    return 42;
}
function get69(): int {
    return 69;
}
function noArgFunc(): int {
    return get42() + get42();
}
`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        // const complier = new Compiler( ioApi, { ...defaultOptions, compilerVersion: COMPILER_VERSION } );
        const complier = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await complier.export({ functionName: "noArgFunc", entry: fileName, root: "/" });
        const diagnostics = complier.diagnostics;

        const outputBytes = ioApi.outputs.get("out/out.flat")!;
        const uplc = parseUPLC(outputBytes).body;

        // console.log( showUPLC( uplc ) );

        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect(diagnostics.length).toBe(0);

        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
        expect(outputBytes instanceof Uint8Array).toBe(true);
    });


    test("choice", async () => {

        const fileName = "test.pebble";
        const srcText = `
function get42(): int {
    return 42;
}
function get69(): int {
    return 69;
}
function noArgFunc( choice: boolean ): int {
    return choice ? get42() + get69() : get42() - get69();
}
`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        // const complier = new Compiler( ioApi, { ...defaultOptions, compilerVersion: COMPILER_VERSION } );
        const complier = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

        await complier.export({ functionName: "noArgFunc", entry: fileName, root: "/" });
        const diagnostics = complier.diagnostics;

        const outputBytes = ioApi.outputs.get("out/out.flat")!;
        const uplc = parseUPLC(outputBytes).body;

        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect(diagnostics.length).toBe(0);

        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
        expect(outputBytes instanceof Uint8Array).toBe(true);
    });


});