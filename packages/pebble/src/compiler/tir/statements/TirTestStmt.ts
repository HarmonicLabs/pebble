import { SourceRange } from "../../../ast/Source/SourceRange";
import { TirType } from "../types/TirType";
import { ITirStmt } from "./TirStmt";

/**
 * Per-parameter fuzzer descriptor.
 *
 * - `kind: "typed"`: the runner generates values directly in TS for the
 *   parameter's resolved TIR type (see `test/fuzz/typedFuzzers.ts`).
 *   No Pebble-side fuzzer call.
 * - `kind: "via"`: the user wrote `via <expr>`; the compiler synthesized a
 *   Pebble-side fuzzer entry point named `tirFuncName` of shape
 *   `( seed: int ) => T`. The runner compiles it once per test and
 *   CEK-evaluates it with a fresh seed each iteration.
 * - `kind: "unsupported"`: the parameter type has no default generator and
 *   no usable `via` was supplied; the runner emits a SKIP `TestResult`
 *   carrying `reason`.
 */
export type FuzzerInfo =
    | { kind: "typed"; type: TirType }
    | { kind: "via"; tirFuncName: string }
    | { kind: "unsupported"; reason: string };

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
