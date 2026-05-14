import { SourceRange } from "../../../ast/Source/SourceRange";
import { ITirStmt } from "./TirStmt";

/**
 * A `test name( params? ) { body }` block.
 *
 * The compiled body lives in `program.functions` keyed by `tirFuncName`
 * (synthesised as `__pebble_test_<name>_<srcUid>`). The executor
 * (`runTests`) looks up that function, compiles it to UPLC, and evaluates it.
 *
 * Unit tests have a 0-arg function; property/fuzz tests have a parameterised
 * function — the executor inspects `program.functions.get(tirFuncName).params`
 * to decide whether to run or to skip with a "not supported" result.
 */
export class TirTestStmt
    implements ITirStmt
{
    constructor(
        readonly name: string,
        readonly tirFuncName: string,
        readonly sourceFile: string,
        readonly range: SourceRange,
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
