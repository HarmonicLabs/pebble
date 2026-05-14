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
