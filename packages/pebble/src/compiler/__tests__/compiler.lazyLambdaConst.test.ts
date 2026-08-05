import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst, UPLCTerm } from "@harmoniclabs/uplc";
import { Machine } from "@harmoniclabs/buildooor";
import { DataList, DataI } from "@harmoniclabs/plutus-data";

// Counterpart to the compute-once tests: floating a binding out of a lambda
// must never make a FAILING computation run on a path that would not have
// evaluated it. The compute-once rescues lift bindings above the lambdas
// they do not depend on; here the binding is declared INSIDE a lambda that
// is never invoked, and depends only on a captured variable — so it is
// invariant w.r.t. the lambda and looks like a legal float target. Source
// semantics never evaluate it, so the script must still succeed.

const SRC = `
export function main( xs: data, k: int ): int {
    const lst: List<data> = std.builtins.unListData(xs);
    const g = (a: int) => {
        // partial AND depends on the captured \`k\`: unIData of a bytestring fails
        const boom: int = std.builtins.unIData(
            std.builtins.bData(std.bytes.prepend(k, #)));
        return a + boom;
    };
    if (lst.isEmpty()) { return 42; }
    return g(1);
}`;

jest.setTimeout( 120_000 );

test("a failing const inside an uninvoked lambda never evaluates", async () => {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(SRC)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });
    await c.export({ functionName: "main", entry: "test.pebble", root: "/" });
    if( c.diagnostics.length )
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));
    const uplc: UPLCTerm = parseUPLC( ioApi.outputs.get("out/out.flat")! ).body;

    const evalWith = ( elems: DataI[] ) => Machine.eval(
        new Application(
            new Application( uplc, UPLCConst.data( new DataList( elems ) ) ),
            UPLCConst.int( 7n )
        )
    );

    const isErr = ( r: any ) => /Error/.test( r?.constructor?.name ?? "" );

    // empty list -> `g` is never called -> `boom` must never evaluate
    const empty = evalWith([]);
    expect( isErr( empty.result ) ).toBe( false );
    expect( (empty.result as any).value ).toBe( 42n );

    // non-empty -> `g` runs -> the failure is expected
    const nonEmpty = evalWith([ new DataI( 1n ) ]);
    expect( isErr( nonEmpty.result ) ).toBe( true );
});
