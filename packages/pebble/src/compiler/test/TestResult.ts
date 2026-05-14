import { SourceRange } from "../../ast/Source/SourceRange";

export type TestKind = "unit" | "property";

export interface TestBudget {
    cpu: bigint;
    mem: bigint;
}

export interface TestIterationResult {
    passed: boolean;
    budgetSpent: TestBudget;
    logs: string[];
    error?: { msg?: string };
    /** reserved for property tests; undefined for unit tests */
    inputs?: unknown[];
}

export interface TestResult {
    name: string;
    sourceFile: string;
    range: SourceRange;
    kind: TestKind;
    /** aggregate pass/fail across all iterations */
    passed: boolean;
    /** length 1 for unit tests, N for property tests */
    iterations: TestIterationResult[];
    /** sum of `budgetSpent` across iterations */
    totalBudget: TestBudget;
    /** non-empty when the test could not be executed at all (e.g. unsupported feature) */
    skippedReason?: string;
}

export function zeroBudget(): TestBudget
{
    return { cpu: 0n, mem: 0n };
}

export function addBudget( a: TestBudget, b: TestBudget ): TestBudget
{
    return { cpu: a.cpu + b.cpu, mem: a.mem + b.mem };
}
