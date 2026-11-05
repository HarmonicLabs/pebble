import { Application, Builtin, Case, Constr, Lambda, parseUPLC, UPLCConst, UPLCTerm, UPLCVar, showUPLC } from "@harmoniclabs/uplc";
import { DataI, DataList } from "@harmoniclabs/plutus-data";
import { CEKConst, Machine } from "@harmoniclabs/plutus-machine";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { productionOptions, COMPILER_VERSION, CompilerOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";

/**
 * Where letted values are placed, around consecutive asserts. Each assert continues in the
 * success branch of its `case` (the other branch fails): a value computed before the `case`
 * instead changes nothing on a run that does not fail, so it is shared, not copied in.
 */

async function exported( src: string ): Promise<UPLCTerm>
{
    const ioApi = createMemoryCompilerIoApi({ sources: new Map([[ "main.pebble", fromUtf8( src ) ]]), useConsoleAsOutput: false });
    const compiler = new Compiler( ioApi, { ...productionOptions, compilerVersion: COMPILER_VERSION } as CompilerOptions );
    const bytes = await compiler.export({ entry: "main.pebble", root: "/", functionName: "f" } as any );
    return parseUPLC( bytes ).body;
}

const count = ( text: string, what: string ) => text.split( what ).length - 1;

/** the variable bound to each value a lambda is applied to (`[(lam x b) v]` and `(case (constr 0 [v ...]) [(lam x ...)])`), with its uses */
function bindings( root: UPLCTerm ): { value: UPLCTerm, uses: number }[]
{
    const out: { value: UPLCTerm, uses: number }[] = [];
    const usesOf = ( body: UPLCTerm, dbn: number ): number => {
        if( body instanceof UPLCVar ) return Number( body.deBruijn ) === dbn ? 1 : 0;
        if( body instanceof Lambda ) return usesOf( body.body, dbn + 1 );
        if( body instanceof Application ) return usesOf( body.func, dbn ) + usesOf( body.arg, dbn );
        if( body instanceof Case ) return usesOf( body.constrTerm, dbn ) + body.continuations.reduce( ( n, c ) => n + usesOf( c, dbn ), 0 );
        if( body instanceof Constr ) return body.terms.reduce( ( n, t ) => n + usesOf( t, dbn ), 0 );
        const inner = ( body as any ).delayedTerm ?? ( body as any ).forced;
        return inner ? usesOf( inner, dbn ) : 0;
    };
    const visit = ( t: UPLCTerm ): void => {
        if( t instanceof Application && t.func instanceof Lambda ) out.push({ value: t.arg, uses: usesOf( t.func.body, 0 ) });
        if( t instanceof Case && t.constrTerm instanceof Constr && t.continuations.length === 1 )
        {
            // `(case (constr 0 [v0 .. vn]) [(lam x0 .. (lam xn body))])`: v_i is bound to x_i
            const values = t.constrTerm.terms;
            let fn: UPLCTerm = t.continuations[0];
            const lams: Lambda[] = [];
            while( fn instanceof Lambda && lams.length < values.length ) { lams.push( fn ); fn = fn.body; }
            values.forEach( ( v, i ) => { if( i < lams.length ) out.push({ value: v, uses: usesOf( lams[ lams.length - 1 ].body, lams.length - 1 - i ) }); } );
        }
        if( t instanceof Lambda ) visit( t.body );
        else if( t instanceof Application ) { visit( t.func ); visit( t.arg ); }
        else if( t instanceof Case ) { visit( t.constrTerm ); t.continuations.forEach( visit ); }
        else if( t instanceof Constr ) t.terms.forEach( visit );
        else {
            const inner = ( t as any ).delayedTerm ?? ( t as any ).forced;
            if( inner ) visit( inner );
        }
    };
    visit( root );
    return out;
}

describe("letted placement around consecutive asserts", () => {

    const SRC = `
data struct P { a: int, b: int, c: int }
export function f( d: data, x: int ): int {
    const p = d as P;
    assert p.a == x && p.b == x;
    assert p.c > 10;
    assert p.a < 100;
    return p.b + p.c;
}`;

    test("a field read by the asserts and after them is decoded once", async () => {
        // `p.b` is read in the lazy half of the first condition and after the asserts: it was
        // decoded again after them (copied into each use, as for separate dispatch arms)
        const body = await exported( SRC );
        expect( count( showUPLC( body ), "(builtin unIData)" ) ).toBe( 3 );

        const d = new DataList([ new DataI( 5 ), new DataI( 5 ), new DataI( 20 ) ]);
        const r = Machine.eval( new Application( new Application( body, UPLCConst.data( d ) ), UPLCConst.int( 5 ) ) );
        expect( ( r.result as CEKConst ).value ).toBe( BigInt( 25 ) );
    });

    test("a builtin used once is applied in place, not bound outside the function", async () => {
        // the compute-once rescue (for values a lambda would compute on every call) took the
        // builtins too: nothing to compute, a binding and an application more
        const body = await exported( SRC );
        const boundOnce = bindings( body ).filter( b => b.value instanceof Builtin && b.uses === 1 );
        expect( boundOnce.map( b => showUPLC( b.value ) ) ).toEqual( [] );
    });
});
