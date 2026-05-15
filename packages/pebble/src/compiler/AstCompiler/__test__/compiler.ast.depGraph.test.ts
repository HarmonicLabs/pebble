import { Source, SourceKind } from "../../../ast/Source/Source";
import { defaultOptions, COMPILER_VERSION } from "../../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../../io/CompilerIoApi";
import { AstCompiler } from "../AstCompiler";
import { ResolveStackNode } from "../utils/deps/ResolveStackNode";

const aSrcText =
`import { b } from "./b";
import { c } from "./c";

const a = b + c;`;

const aSrc = new Source(
    SourceKind.User,
    "a.pebble",
    "",
    aSrcText,
);

const bSrcText = 
`import { d } from "./d";

export const b = d + 1;`;

const cSrcText = 
`import { d } from "./d";

export const c = d + 2;`;

const dSrcText = 
`import { e } from "./e";

export const d = e + 3;`;

const eSrcText =
`import { f } from "./f";
import { g } from "./g";

export const e = f + g;`;

const fSrcText =
`import { g } from "./g";
import { d } from "./d";

export const f = g + 4;

export const otherThing = d + 5;`;

const gSrcText =
`export const g = 5;`;

const complier = new AstCompiler(
    {
        ...defaultOptions,
        compilerVersion: COMPILER_VERSION,
        entry: "a.pebble",
        root: "/",
    },
    createMemoryCompilerIoApi({
        sources: new Map([
            ["a.pebble", aSrcText],
            ["b.pebble", bSrcText],
            ["c.pebble", cSrcText],
            ["d.pebble", dSrcText],
            ["e.pebble", eSrcText],
            ["f.pebble", fSrcText],
            ["g.pebble", gSrcText],
        ]),
        useConsoleAsOutput: true,
    }),
);

test.skip("checkCircularDependencies", async () => {
    const ok = await complier.parseAllImportedFiles( ResolveStackNode.entry( aSrc ) );

    expect( ok ).toBe( false );

    expect( complier.diagnostics.length )
    // at least the 3 files in the cycle
    .toBeGreaterThanOrEqual( 3 );

    expect( complier.diagnostics.length )
    // but we also signal it in the first import
    // so in reality we expect 4
    .toEqual( 4 );
});