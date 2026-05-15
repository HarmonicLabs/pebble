import { COMPILER_VERSION, defaultOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";

describe("Compiler compilerVersion validation", () => {

    const ioApi = () => createMemoryCompilerIoApi({ useConsoleAsOutput: true });

    test("throws when compilerVersion is missing", () => {
        expect(() => new Compiler(
            ioApi(),
            { ...defaultOptions } as any
        )).toThrow(/missing "compilerVersion"/);
    });

    test("throws when compilerVersion is the empty string", () => {
        expect(() => new Compiler(
            ioApi(),
            { ...defaultOptions, compilerVersion: "" }
        )).toThrow(/missing "compilerVersion"/);
    });

    test("throws when compilerVersion is unparseable", () => {
        expect(() => new Compiler(
            ioApi(),
            { ...defaultOptions, compilerVersion: "garbage" }
        )).toThrow(/does not satisfy/);
    });

    test("throws when the running compiler does not satisfy the range", () => {
        // pin to a version we know will not match the current COMPILER_VERSION
        const incompatible = `^${parseInt(COMPILER_VERSION.split(".")[0], 10) + 5}.0.0`;
        expect(() => new Compiler(
            ioApi(),
            { ...defaultOptions, compilerVersion: incompatible }
        )).toThrow(/does not satisfy/);
    });

    test("succeeds with an exact match against COMPILER_VERSION", () => {
        expect(() => new Compiler(
            ioApi(),
            { ...defaultOptions, compilerVersion: COMPILER_VERSION }
        )).not.toThrow();
    });

    test("succeeds with a caret range covering COMPILER_VERSION", () => {
        expect(() => new Compiler(
            ioApi(),
            { ...defaultOptions, compilerVersion: `^${COMPILER_VERSION}` }
        )).not.toThrow();
    });

});
