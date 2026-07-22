import { testOptions, defaultOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

// Bug 10 from `the-cardano-masterpiece` (PEBBLE_BUGS.md, against 0.3.5):
// user functions were re-converted to IR once PER CALL SITE with fresh
// symbols; since IR hashing is symbol-identity based, the copies hashed
// differently and the hash-based dedup inlined a full copy of the body at
// every call site — script size multiplied with each additional call.

const HEAVY_HELPER = `
function heavy( a: int, b: int ): int {
    let acc = a * 31 + b;
    acc = acc * 1103515245 + 12345;
    acc = acc + a * b - (a + b) * 7;
    acc = acc * 6364136223846793005 + 1442695040888963407;
    acc = acc + (a * a * a) - (b * b * b);
    acc = acc * 2862933555777941757 + 3037000493;
    acc = acc + a * 999983 + b * 999979;
    return acc;
}
`;

function contractSrc( nCallSites: number ): string {
    const mints: string[] = [];
    for( let i = 0; i < 3; i++ ) {
        const body = i < nCallSites
            ? `assert heavy( tx.mint.amountOf( policy, # ), ${i + 2} ) > 0;`
            : `assert tx.mint.amountOf( policy, # ) > ${i};`;
        mints.push(`
    mint m${i}() {
        const { tx, policy } = context;
        ${body}
    }`);
    }
    return `${HEAVY_HELPER}
contract T {${mints.join("\n")}
}
`;
}

async function compiledSize( src: string, options: object ): Promise<number> {
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([ [ "main.pebble", fromUtf8( src ) ] ]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler( ioApi, { ...options, compilerVersion: COMPILER_VERSION } as any );
    await c.compile({ entry: "main.pebble", root: "/" });
    const out = ioApi.outputs.get("out/out.flat");
    expect( out instanceof Uint8Array ).toBe( true );
    return out!.length;
}

// The body of `heavy` compiles to well over 100 bytes; a shared definition
// means each ADDITIONAL call site may only add call overhead (a variable
// reference + application + args), not another copy of the body.
const MAX_EXTRA_BYTES_PER_CALL_SITE = 40;

describe.each([
    [ "default options", defaultOptions ],
    [ "test options", testOptions ],
])("masterpiece bug 10 — multi-use functions are shared, not inlined per call site (%s)", ( _label, options ) => {

    test("second and third call sites only add call overhead", async () => {
        const one   = await compiledSize( contractSrc( 1 ), options );
        const two   = await compiledSize( contractSrc( 2 ), options );
        const three = await compiledSize( contractSrc( 3 ), options );

        expect( two - one ).toBeLessThanOrEqual( MAX_EXTRA_BYTES_PER_CALL_SITE );
        expect( three - two ).toBeLessThanOrEqual( MAX_EXTRA_BYTES_PER_CALL_SITE );
    });
});
