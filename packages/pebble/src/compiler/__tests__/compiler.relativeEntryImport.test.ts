import { defaultOptions, testOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { AstCompiler } from "../AstCompiler/AstCompiler";
import { isAbsolutePath } from "../path/getAbsolutePath";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

describe("relative entry path with imports", () => {

    const myDatumSrc = `
export data struct MyDatum {
    n: int;
}`;

    const indexSrc = `
import { MyDatum } from "./MyDatum";

contract MyContract {

    param owner: PubKeyHash;

    spend ownerAllowsIt() {
        const {
            tx,
            optionalDatum: Some{ value: { n } as MyDatum }
        } = context;

        assert tx.requiredSigners.includes( this.owner );
    }

    spend sendToOwner( amount: int ) {
        const { tx } = context;

        assert tx.outputs.length() === 1;

        const output = tx.outputs[0];

        assert output.address.payment.hash() == this.owner;
        assert output.value.lovelaces() >= amount;
    }
}`;

    test("AstCompiler normalizes relative entry to absolute path", () => {

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/index.pebble", fromUtf8(indexSrc)],
                ["src/MyDatum.pebble", fromUtf8(myDatumSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new AstCompiler(
            {
                ...defaultOptions,
                entry: "./src/index.pebble",
                root: "/"
            },
            ioApi
        );

        // after construction, the entry must be an absolute path
        expect(isAbsolutePath(compiler.cfg.entry)).toBe(true);
        expect(compiler.cfg.entry).not.toContain("/./");
    });

    test("all parsed sources have absolute paths after compiling with relative entry", async () => {

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["src/index.pebble", fromUtf8(indexSrc)],
                ["src/MyDatum.pebble", fromUtf8(myDatumSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, testOptions);

        await compiler.compile({ entry: "./src/index.pebble", root: "/" });
        expect(compiler.diagnostics.length).toBe(0);

        const output = ioApi.outputs.get("out/out.flat")!;
        expect(output instanceof Uint8Array).toBe(true);
    });

    test("AstCompiler normalizes relative entry with non-root project path", () => {

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                ["my-project/src/index.pebble", fromUtf8(indexSrc)],
                ["my-project/src/MyDatum.pebble", fromUtf8(myDatumSrc)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new AstCompiler(
            {
                ...defaultOptions,
                entry: "./src/index.pebble",
                root: "/my-project"
            },
            ioApi
        );

        expect(isAbsolutePath(compiler.cfg.entry)).toBe(true);
        expect(compiler.cfg.entry).not.toContain("/./");
        expect(compiler.cfg.entry).toBe("/my-project/src/index.pebble");
    });
});
