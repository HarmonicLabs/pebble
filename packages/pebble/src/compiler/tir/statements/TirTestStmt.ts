import { SourceRange } from "../../../ast/Source/SourceRange";
import { ITirStmt } from "./TirStmt";

/**
 * Per-parameter fuzzer descriptor.
 *
 * - `kind: "primitive"`: the runner generates values directly in TS for a
 *   supported primitive type (`int`, `bool`, etc.). No Pebble-side fuzzer call.
 * - `kind: "unsupported"`: the parameter type has no default generator and
 *   no `via` was supplied; the runner emits a SKIP `TestResult` carrying
 *   `reason`.
 * - `kind: "via_not_implemented"`: the user wrote `via <expr>` and the
 *   compiler successfully type-checked it, but executing user-defined
 *   fuzzers is not wired up yet (Phase 2). Surfaced as SKIP.
 */
export type FuzzerInfo =
    | { kind: "primitive"; primitive: "int" | "bool" }
    | { kind: "unsupported"; reason: string }
    | { kind: "via_not_implemented" };

/**
 * A `test name( params? ) { body }` block.
 *
 * The compiled body lives in `program.functions` keyed by `tirFuncName`
 * (synthesised as `__pebble_test_<name>_<srcUid>`). The executor
 * (`runTests`) looks up that function, compiles it to UPLC, and evaluates it.
 *
 * `fuzzerInfos` is parallel to the function's params; for unit tests it is
 * empty. For property tests, each entry tells the runner how to source
 * values for that parameter.
 */
export class TirTestStmt
    implements ITirStmt
{
    constructor(
        readonly name: string,
        readonly tirFuncName: string,
        readonly sourceFile: string,
        readonly range: SourceRange,
        readonly fuzzerInfos: FuzzerInfo[] = [],
    ) {}

    toString(): string
    {
        return `test ${this.name} -> ${this.tirFuncName}`;
    }
    pretty(): string
    {
        return this.toString();
    }
    definitelyTerminates(): boolean { return false; }
    deps(): string[]
    {
        return [ this.tirFuncName ];
    }
}
