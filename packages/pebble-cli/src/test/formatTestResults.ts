import * as path from "node:path";
import { TestResult } from "@harmoniclabs/pebble";

export interface FormattedSummary {
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
}

export function formatTestResults(
    resultsByFile: Map<string, TestResult[]>,
    cwd: string = process.cwd()
): { text: string; summary: FormattedSummary }
{
    const lines: string[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let total = 0;

    const files = Array.from( resultsByFile.keys() ).sort();
    for( const file of files )
    {
        const rel = path.relative( cwd, file );
        const results = resultsByFile.get( file )!;
        lines.push( "" );
        lines.push( rel );
        for( const r of results )
        {
            total++;
            if( r.skippedReason )
            {
                skipped++;
                lines.push( `  SKIP  ${r.name}  (${r.skippedReason})` );
                continue;
            }
            const tag = r.passed ? "PASS" : "FAIL";
            if( r.passed ) passed++;
            else failed++;
            const cpu = r.totalBudget.cpu.toString();
            const mem = r.totalBudget.mem.toString();

            if( r.kind === "property" )
            {
                const ran = r.iterations.length;
                const seedStr = `seed=${r.seed ?? 0}`;
                if( r.passed )
                {
                    lines.push( `  ${tag}  ${r.name}  (${ran} iterations, ${seedStr}, total cpu=${cpu}, mem=${mem})` );
                }
                else
                {
                    const failedIter = r.iterations[ r.iterations.length - 1 ];
                    lines.push( `  ${tag}  ${r.name}  (failed at iteration ${ran}, ${seedStr})` );
                    if( failedIter?.inputs && failedIter.inputs.length > 0 )
                    {
                        const inp = failedIter.inputs
                            .map( i => `${i.name}=${_renderValue( i.value )}` )
                            .join( ", " );
                        lines.push( `        inputs: ${inp}` );
                    }
                    if( failedIter?.error?.msg ) lines.push( `        error:  ${failedIter.error.msg}` );
                    if( failedIter?.logs && failedIter.logs.length > 0 )
                    {
                        for( const log of failedIter.logs ) lines.push( `        trace:  ${log}` );
                    }
                }
                continue;
            }

            // unit test rendering
            lines.push( `  ${tag}  ${r.name}  [cpu: ${cpu}, mem: ${mem}]` );

            for( const it of r.iterations )
            {
                if( it.logs.length > 0 )
                {
                    for( const log of it.logs ) lines.push( `        trace: ${log}` );
                }
                if( it.error?.msg ) lines.push( `        error: ${it.error.msg}` );
            }
        }
    }

    lines.push( "" );
    lines.push( `Tests: ${passed} passed, ${failed} failed, ${skipped} skipped, ${total} total` );

    return {
        text: lines.join( "\n" ),
        summary: { totalTests: total, passed, failed, skipped }
    };
}

function _renderValue( v: unknown ): string
{
    if( typeof v === "bigint" ) return v.toString();
    if( typeof v === "boolean" ) return v ? "true" : "false";
    if( v instanceof Uint8Array ) return "#" + Array.from( v ).map( b => b.toString( 16 ).padStart( 2, "0" ) ).join( "" );
    return String( v );
}
