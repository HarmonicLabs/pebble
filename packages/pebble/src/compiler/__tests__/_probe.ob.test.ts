import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
async function compile(src: string){
    const ioApi = createMemoryCompilerIoApi({ sources: new Map([["main.pebble", fromUtf8(src)]]), useConsoleAsOutput:true });
    const c = new Compiler(ioApi, {...testOptions, compilerVersion: COMPILER_VERSION});
    try { await c.compile({entry:"main.pebble", root:"/"}); } catch(e){ return "THREW/diags: "+JSON.stringify(c.diagnostics.map(d=>d.toString())); }
    return ioApi.outputs.get("out/out.flat") instanceof Uint8Array ? "OK" : "no-output "+JSON.stringify(c.diagnostics.map(d=>d.toString()));
}
describe("match variants", () => {
  test("variants", async () => {
    console.log("int subj + typed binder:", await compile(`contract C { spend f() { match 1 { when x: int : { assert true; } } } }`));
    console.log("var subj + typed binder:", await compile(`contract C { spend f() { let n = 1; match n { when x: int : { assert true; } } } }`));
    console.log("int subj + ctor pattern:", await compile(`struct Two { A{} B{} } contract C { spend f() { let t = Two.A{}; match t { when A{} : { assert true; } when B{} : { assert true; } } } }`));
  });
});
