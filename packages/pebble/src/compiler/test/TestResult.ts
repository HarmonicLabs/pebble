import { SourceRange } from "../../ast/Source/SourceRange";

export type TestKind = "unit" | "property";

export interface TestBudget {
    cpu: bigint;
    mem: bigint;
}

export interface TestInput {
    name: string;
    value: unknown;
}

export interface TestIterationResult {
    passed: boolean;
    budgetSpent: TestBudget;
    logs: string[];
    error?: { msg?: string };
    /** the fuzzed input tuple for this iteration; undefined for unit tests */
    inputs?: TestInput[];
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
    /** seed used by the property runner (only set for property tests) */
    seed?: number;
}

export function zeroBudget(): TestBudget
{
    return { cpu: 0n, mem: 0n };
}

export function addBudget( a: TestBudget, b: TestBudget ): TestBudget
{
    return { cpu: a.cpu + b.cpu, mem: a.mem + b.mem };
}
