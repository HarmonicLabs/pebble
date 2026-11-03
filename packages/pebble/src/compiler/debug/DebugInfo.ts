import type { SourceRange } from "../../ast/Source/SourceRange";
import type { TirType } from "../tir/types/TirType";

/*
 * Debug information: what a debugger needs on top of the source map to show a run in source
 * terms, statement by statement, with the values of the variables in scope.
 *
 * It describes one compilation and lives in memory only (never in `out.flat.map`): tools get it
 * by compiling the project again, which yields the same program, and check that the program is
 * the one they run (the source map's `programHash`).
 *
 * Collected only when asked (see `DebugCollector`); collecting adds metadata to IR nodes and
 * never changes the compiled program.
 */

export type DebugStmtKind
    = "var"
    | "assign"
    | "assert"
    | "if"
    | "match"
    | "return"
    | "fail"
    | "trace"
    | "for"
    | "while"
    | "forOf"
    | "break"
    | "continue"
    | "block"
    | "expr";

/**
 * A function of the source, or the body of a loop: the compiler turns every loop into a
 * function that calls itself once per iteration.
 */
export interface DebugFunction {
    readonly id: number;
    /** source name; `<anonymous>` for arrow functions; a loop's is its function's */
    readonly name: string;
    readonly range: SourceRange;
    readonly kind: "function" | "loop";
    /** the function it is written in (closures and loops) */
    readonly parent: DebugFunction | undefined;
    /** for loops: the loop statement */
    readonly loopStmt: DebugStmt | undefined;
    /** the statement of `parent` it is written in (for loops, the loop statement) */
    readonly definedAt: DebugStmt | undefined;
    readonly params: DebugVar[];
    /** top-level statements of the body */
    readonly stmts: DebugStmt[];
    /** a test (`test name() {}`) */
    readonly isTest: boolean;
}

export interface DebugStmt {
    readonly id: number;
    readonly kind: DebugStmtKind;
    readonly range: SourceRange;
    /** innermost function (or loop body) the statement is in */
    readonly fn: DebugFunction;
    /** enclosing compound statement, in the same function */
    readonly parent: DebugStmt | undefined;
    /** statements nested in it (branches, arms, loop bodies run as their own `DebugFunction`) */
    readonly children: DebugStmt[];
    /** variables visible where it starts, outermost first; closures see their parents' */
    readonly scope: readonly DebugVar[];
    /** variables it declares (a `for`'s initializers, every name of a destructuring) */
    readonly declares: readonly DebugVar[];
    /** for loop statements: the loop body */
    readonly loop: DebugFunction | undefined;
    /** whether a debugger stops at it: generated statements (a contract's dispatch) have no source of their own */
    readonly isStop: boolean;
    /**
     * the order the statement runs in among its function's: source order, except that a
     * loop's updates (`i++`) come after its body
     */
    readonly order: number;
}

export interface DebugVar {
    readonly id: number;
    /** source name */
    readonly name: string;
    /** name the typed IR uses for it (references resolve by this name) */
    readonly tirName: string;
    readonly type: TirType;
    /** the declaration */
    readonly range: SourceRange;
    readonly kind: "param" | "const" | "let" | "pattern";
    /** function (or loop body) that declares it */
    readonly fn: DebugFunction;
    /** the declaring statement; `undefined` for parameters */
    readonly declStmt: DebugStmt | undefined;
    /** a compiler variable no source shows by its own name (an alias names it) */
    readonly hidden?: boolean;
    /** another name for that variable: its value is `aliasOf`'s (a contract method's `tx`) */
    readonly aliasOf?: DebugVar;
}

/**
 * One way a variable gets its value at run time.
 *
 * - `decl`: its declaration (or, for parameters, the call);
 * - `assign`: an assignment, or a branch or loop handing back the values it changed
 *   (`stmt` is that statement): it holds from the end of `stmt` on;
 * - `loop`: the value an iteration of loop `stmt` starts with, inside the loop body.
 */
export interface DebugBinding {
    readonly v: DebugVar;
    readonly kind: "decl" | "assign" | "loop";
    readonly stmt: DebugStmt | undefined;
}

/** a named part of a function, for frame names: a contract method inside the contract's function */
export interface DebugRegion {
    /** `accept` */
    readonly name: string;
    /** `spend`, `mint`, ... */
    readonly purpose: string;
    readonly range: SourceRange;
}

/** the debug information of one compilation, as a debugger reads it */
export interface DebugStructure {
    readonly functions: readonly DebugFunction[];
    readonly stmts: readonly DebugStmt[];
    readonly vars: readonly DebugVar[];
    readonly regions: readonly DebugRegion[];
}
