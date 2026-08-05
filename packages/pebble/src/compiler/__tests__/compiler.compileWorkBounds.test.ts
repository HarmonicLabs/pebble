import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { compileWork } from "../../IR/toUPLC/_internal/compileWorkCounters";

// COMPILE-WORK BOUNDS
//
// Compile TIME is machine-dependent and makes a flaky gate, so nothing here
// measures seconds. The amount of WORK the pipeline performs for a given
// source is deterministic — identical counts on every machine, every run —
// so these tests assert on counted operations, and specifically on how those
// counts SCALE with program size. That is what separates an algorithmic
// regression from a program simply being bigger.
//
// What motivated them: several passes drove a worklist with `pop()` +
// `unshift(...)`, and collected application spines with `args.unshift(arg)`.
// Both are ordinary-looking code, and neither changes the emitted script by
// one byte — so no output test could see them — but `Array.prototype.unshift`
// moves every element already in the array. Walking a tree therefore cost
// O(nodes^2) in hidden memmove. Measured on a 6.6 kB validator: 630k visits
// against a worklist peaking at 11.5k entries, i.e. 5.5 BILLION element moves
// in ONE pass call. Those passes were 65% of a 4.7-minute compile, and the
// largest validator in the audit corpus took 66 minutes to build an 11 kB
// script.

/** WIDE program: many independent statements -> many IR nodes */
const wideSrc = ( n: number ): string => {
    const stmts: string[] = [];
    for( let i = 0; i < n; i++ ) {
        stmts.push(
            `    const a${i}: int = k + ${i};\n` +
            `    const b${i}: int = a${i} > ${i} ? a${i} * 2 : a${i} + 1;\n` +
            `    acc = acc + b${i} + (b${i} == 0 ? 1 : 2);`
        );
    }
    return `
export function main( xs: data, k: int ): int {
    let acc: int = 0;
${stmts.join("\n")}
    return acc;
}`;
};

/** DEEP program: one nested call chain -> long application spines */
const deepSrc = ( n: number ): string => {
    let body = "k";
    for( let i = 0; i < n; i++ ) body = `add3( ${body}, ${i}, k )`;
    return `
function add3( a: int, b: int, c: int ): int { return a + b + c; }
export function main( xs: data, k: int ): int {
    return ${body};
}`;
};

async function compileAndCount( src: string )
{
    const ioApi = createMemoryCompilerIoApi({
        sources: new Map([["test.pebble", fromUtf8(src)]]),
        useConsoleAsOutput: true,
    });
    const c = new Compiler(ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION });

    // Implementation-independent probe for the defect above: charge every
    // front-insertion the number of elements it actually has to move. Code
    // that reintroduces an `unshift`-driven worklist or spine collector is
    // caught however it is written, and an O(1) queue costs nothing here.
    const realUnshift = Array.prototype.unshift;
    const realSplice = Array.prototype.splice;
    let frontInsertionWork = 0;
    Array.prototype.unshift = function ( ...items: any[] ) {
        frontInsertionWork += this.length;
        return realUnshift.apply( this, items );
    };
    Array.prototype.splice = function ( this: any[], start: number, ...rest: any[] ) {
        if( start === 0 ) frontInsertionWork += this.length;
        return realSplice.apply( this, [ start, ...rest ] as any );
    };

    compileWork.reset();
    try {
        await c.export({ functionName: "main", entry: "test.pebble", root: "/" });
    } finally {
        Array.prototype.unshift = realUnshift;
        Array.prototype.splice = realSplice;
    }
    if( c.diagnostics.length )
        throw new Error("compile failed: " + c.diagnostics.map(d => d.toString()).join("\n"));

    return { ...compileWork.snapshot(), frontInsertionWork };
}

jest.setTimeout( 300_000 );

// 4x the program. Every counter below is measured to scale EXACTLY linearly
// (each doubling of the input doubles the count), so a limit of 6 for a 4x
// input leaves room for fixed pipeline overhead while still failing loudly
// on a quadratic, which lands near 16.
const SMALL = 16;
const BIG = 64;
const LINEAR_RATIO_LIMIT = 6;

test("collecting application spines costs nothing per extra nesting level", async () => {
    // Spine collection walks the application chain head-first. Done with
    // `push` + one `reverse` it is free; done with `unshift` per argument it
    // is quadratic in the spine length. On this fixture the correct version
    // is FLAT (13 moves at every depth) while the quadratic one grows with
    // the program (226 -> 3226 across these sizes).
    const small = await compileAndCount( deepSrc( SMALL ) );
    const big = await compileAndCount( deepSrc( BIG ) );

    expect( big.frontInsertionWork ).toBeLessThan( small.frontInsertionWork * 2 );
});

test("worklist walks do not pay front-insertion cost", async () => {
    const small = await compileAndCount( wideSrc( SMALL ) );
    const big = await compileAndCount( wideSrc( BIG ) );

    // A correct walk prepends only to short, bounded lists — never to the
    // worklist itself, which is why this sits far BELOW the visit count.
    // The broken version paid the whole queue length on every visit.
    expect( big.frontInsertionWork ).toBeLessThan( big.nodeVisits );
    expect( big.frontInsertionWork / small.frontInsertionWork )
        .toBeLessThan( LINEAR_RATIO_LIMIT );
});

test("rewrite-pass work scales linearly with program size", async () => {
    const small = await compileAndCount( wideSrc( SMALL ) );
    const big = await compileAndCount( wideSrc( BIG ) );

    expect( big.nodeVisits / small.nodeVisits ).toBeLessThan( LINEAR_RATIO_LIMIT );

    // every visit must come from a bounded number of pushes: a pass that
    // re-enqueues the same subtree repeatedly shows up as a rising ratio
    expect( big.worklistPushes ).toBeLessThan( big.nodeVisits * 3 );
});

test("letted placement performs a bounded number of tree scans per binding", async () => {
    const small = await compileAndCount( wideSrc( SMALL ) );
    const big = await compileAndCount( wideSrc( BIG ) );

    // `placementScans` counts FULL-TREE walks in the binding-placement pass
    // (currently 2 per placed binding: `sanifyTree` plus the same-hash
    // search). Those walks are that pass's remaining O(bindings x nodes)
    // cost — the next thing worth attacking — so this pins the per-binding
    // constant, and pins total scans to the NUMBER of bindings rather than
    // to their product with tree size.
    expect( small.placementScans ).toBeGreaterThan( 0 );
    expect( big.placementScans / small.placementScans ).toBeLessThan( LINEAR_RATIO_LIMIT );
});
