import {
    Application, Builtin, Case, compileUPLC, Force, Lambda,
    UPLCBuiltinTag, UPLCConst, UPLCProgram, UPLCTerm, UPLCVar, ErrorUPLC,
    constT, parseUPLC,
} from "@harmoniclabs/uplc";
import { Machine } from "@harmoniclabs/buildooor";

/**
 * Benchmark: is `case L of cons h _ -> h | nil -> error` cheaper than
 * `force (force (builtin headList)) L` for a single head extraction
 * (and analogously for tailList)?
 *
 * Builds both UPLC terms by hand, applies them to the same concrete
 * list, reports script size + CEK CPU + CEK mem.
 *
 * Run with:
 *   npx jest bench.headTailVsCase --silent=false
 */

const v = 1n;

// (force (force (builtin headList)) <arg>)
function headBuiltin( listArg: UPLCTerm ): UPLCTerm
{
    return new Application(
        new Force( new Force( new Builtin( UPLCBuiltinTag.headList ) ) ),
        listArg
    );
}

function tailBuiltin( listArg: UPLCTerm ): UPLCTerm
{
    return new Application(
        new Force( new Force( new Builtin( UPLCBuiltinTag.tailList ) ) ),
        listArg
    );
}

// case <arg> of cons h _ -> h | nil -> error
// In de Bruijn: the cons branch is (lam (lam Var(1))) — bind h, t; return h (deBruijn 1 from inside the inner lam).
function headViaCase( listArg: UPLCTerm ): UPLCTerm
{
    return new Case(
        listArg,
        [
            // cons: λ h. λ t. h
            new Lambda( new Lambda( new UPLCVar( 1n ) ) ),
            // nil: error
            new ErrorUPLC()
        ]
    );
}

// case <arg> of cons _ t -> t | nil -> error
// (lam (lam Var(0)))
function tailViaCase( listArg: UPLCTerm ): UPLCTerm
{
    return new Case(
        listArg,
        [
            // cons: λ h. λ t. t
            new Lambda( new Lambda( new UPLCVar( 0n ) ) ),
            // nil: error
            new ErrorUPLC()
        ]
    );
}

// Wrap term as λ list. body  so we can apply it to a list arg.
function asLambda( bodyBuilder: ( listArg: UPLCTerm ) => UPLCTerm ): UPLCTerm
{
    return new Lambda( bodyBuilder( new UPLCVar( 0n ) ) );
}

function sizeBytes( term: UPLCTerm ): number
{
    const program = new UPLCProgram( [ 1, 1, 0 ], term );
    return compileUPLC( program ).length;
}

function intList( n: number ): UPLCConst
{
    return UPLCConst.listOf( constT.int )(
        Array.from({ length: n }, ( _, i ) => BigInt( i + 1 ) )
    );
}

interface Row {
    label: string;
    bytes: number;
    cpu: bigint;
    mem: bigint;
    result: string;
}

function fmt( n: number | bigint ): string
{
    return n.toLocaleString("en-US");
}

function runRow( label: string, term: UPLCTerm, arg: UPLCConst ): Row
{
    const r = Machine.eval( new Application( term, arg ) );
    const value = ( r.result as any ).value;
    return {
        label,
        bytes: sizeBytes( term ),
        cpu: r.budgetSpent.cpu,
        mem: r.budgetSpent.mem,
        result: String( typeof value === "bigint" ? value : "ok" ),
    };
}

function printTable( rows: Row[] ): void
{
    const w = Math.max( ...rows.map( r => r.label.length ), 30 );
    const header =
        "scenario".padEnd( w ) + "  " +
        "size(B)".padStart( 8 ) + "  " +
        "cpu".padStart( 14 ) + "  " +
        "mem".padStart( 10 ) + "  " +
        "result".padStart( 8 );
    console.log("\n" + header );
    console.log("-".repeat( header.length ) );
    for( const r of rows )
    {
        console.log(
            r.label.padEnd( w ) + "  " +
            fmt( r.bytes ).padStart( 8 ) + "  " +
            fmt( r.cpu ).padStart( 14 ) + "  " +
            fmt( r.mem ).padStart( 10 ) + "  " +
            r.result.slice( 0, 8 ).padStart( 8 )
        );
    }
    console.log("");
}

describe("headList/tailList builtin vs case", () => {

    test("benchmark suite", () => {
        const xs5 = intList( 5 );

        // ── single use (one head OR one tail) ──
        //
        // (λL. head L)                              vs    (λL. case L [(λh λt. h) error])
        // (λL. tail L)                              vs    (λL. case L [(λh λt. t) error])

        // ── dual use (head AND tail of same L) ──
        //
        // Builtin path: (λL. (λh λt. <use h,t>) (head L) (tail L))
        // Case path:    (λL. case L [(λh λt. <use h,t>) error])
        //
        // <use h,t> just returns h to make eval succeed; the shape of the
        // use doesn't matter for the comparison — we only care about the
        // extraction cost.

        function useHandT( h: UPLCTerm, t: UPLCTerm ): UPLCTerm
        {
            // h + t-equality-with-h ? doesn't matter. just sum-ish using addInteger
            // for a realistic body. To avoid type issues with `t` being a list,
            // just discard t and return h.
            return h;
        }

        function dualBuiltin( listArg: UPLCTerm ): UPLCTerm
        {
            // (λh λt. h) (head L) (tail L)
            return new Application(
                new Application(
                    new Lambda( new Lambda(
                        // body uses h (var index 1 from inner lam)
                        new UPLCVar( 1n )
                    )),
                    headBuiltin( listArg )
                ),
                tailBuiltin( listArg )
            );
        }

        function dualCase( listArg: UPLCTerm ): UPLCTerm
        {
            // case L of cons h t -> h | nil -> error
            return new Case(
                listArg,
                [
                    new Lambda( new Lambda( new UPLCVar( 1n ) ) ),
                    new ErrorUPLC()
                ]
            );
        }

        // ── let-shared single builtin (head used twice via a letting) ──
        //
        // Pattern: (λh. <use h twice>) (head L)
        // Both uses share one builtin call.
        //
        // Body uses h twice but returns just h. To force "two real uses",
        // we wrap as: (λh. ifThenElse (h ==? 0) h h)  — but ifThenElse adds
        // its own cost. Cleanest "two uses" body: (λh. mkPair h h)
        // followed by extracting just one. To keep apples-to-apples, we
        // use addInteger which forces both args to evaluate.
        // (assume L is List<int> for these benches.)
        //
        // (λh. addInteger h h) (head L)
        const addInt = new Builtin( UPLCBuiltinTag.addInteger );

        function lettedHeadUsedTwice( listArg: UPLCTerm ): UPLCTerm
        {
            return new Application(
                new Lambda(
                    new Application(
                        new Application( addInt, new UPLCVar( 0n ) ),
                        new UPLCVar( 0n )
                    )
                ),
                headBuiltin( listArg )
            );
        }

        function unlettedHeadCalledTwice( listArg: UPLCTerm ): UPLCTerm
        {
            // No share — call head twice
            return new Application(
                new Application( addInt, headBuiltin( listArg ) ),
                headBuiltin( listArg )
            );
        }

        function caseHeadUsedTwice( listArg: UPLCTerm ): UPLCTerm
        {
            // case L of cons h t -> addInteger h h | nil -> error
            return new Case(
                listArg,
                [
                    new Lambda( new Lambda(
                        new Application(
                            new Application( addInt, new UPLCVar( 1n ) ),
                            new UPLCVar( 1n )
                        )
                    )),
                    new ErrorUPLC()
                ]
            );
        }

        // Diagnostic: case but body just returns Var(1) without addInteger
        // — confirms whether the case dispatch is what's adding cost vs the
        // body operations.
        function caseHeadReturnH( listArg: UPLCTerm ): UPLCTerm
        {
            // case L of cons h t -> h | nil -> error
            return new Case(
                listArg,
                [ new Lambda( new Lambda( new UPLCVar( 1n ) ) ), new ErrorUPLC() ]
            );
        }

        // The "all letted" dual: one head call + one tail call, both stored in
        // separate let-bindings; body uses both. Apples-to-apples comparison
        // for case-introduction over "smart letting".
        function dualLetted( listArg: UPLCTerm ): UPLCTerm
        {
            // ((λh. (λt. h) (tail L)) (head L))
            // Body returns h to match the case dual baseline (which also returns h).
            return new Application(
                new Lambda(
                    new Application(
                        new Lambda( new UPLCVar( 1n ) ),  // (λt. h) — h is at index 1 from inside this lam
                        tailBuiltin( listArg )
                    )
                ),
                headBuiltin( listArg )
            );
        }

        const rows: Row[] = [
            // single use
            runRow( "head ×1 via builtin",          asLambda( headBuiltin ), xs5 ),
            runRow( "head ×1 via case",             asLambda( headViaCase ), xs5 ),
            runRow( "tail ×1 via builtin",          asLambda( tailBuiltin ), xs5 ),
            runRow( "tail ×1 via case",             asLambda( tailViaCase ), xs5 ),
            // dual use (head + tail of same L)
            runRow( "head+tail via 2 builtins",     asLambda( dualBuiltin ), xs5 ),
            runRow( "head+tail via 1 case",         asLambda( dualCase ),    xs5 ),
            runRow( "head+tail via let+let",        asLambda( dualLetted ),  xs5 ),
            // head used twice
            runRow( "head ×2 unlet (2 builtin calls)", asLambda( unlettedHeadCalledTwice ), xs5 ),
            runRow( "head ×2 letted (1 builtin call)", asLambda( lettedHeadUsedTwice ),     xs5 ),
            runRow( "head ×2 via 1 case",              asLambda( caseHeadUsedTwice ),       xs5 ),
            // diagnostic: case body returns h (no addInteger) — same as `head ×1 via case`
            runRow( "DIAG: case body=h (no add)",      asLambda( caseHeadReturnH ),         xs5 ),
        ];

        printTable( rows );
    });
});
