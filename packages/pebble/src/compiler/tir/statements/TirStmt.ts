import { isObject } from "@harmoniclabs/obj-utils";
import { TirAssertStmt } from "./TirAssertStmt";
import { TirAssignmentStmt } from "./TirAssignmentStmt";
import { TirBlockStmt } from "./TirBlockStmt";
import { TirBreakStmt } from "./TirBreakStmt";
import { TirContinueStmt } from "./TirContinueStmt";
import { TirFailStmt } from "./TirFailStmt";
import { TirTraceStmt } from "./TirTraceStmt";
import { TirForOfStmt } from "./TirForOfStmt";
import { TirForStmt } from "./TirForStmt";
import { TirIfStmt } from "./TirIfStmt";
import { TirMatchStmt } from "./TirMatchStmt";
import { TirReturnStmt } from "./TirReturnStmt";
import { TirWhileStmt } from "./TirWhileStmt";
import { TirVarDecl, isTirVarDecl } from "./TirVarDecl/TirVarDecl";
import { HasSourceRange } from "../../../ast/nodes/HasSourceRange";

export enum Termination {
    Conditinal = -1, // the statement may conditionally terminate or not, we need to check the condition
    NoTermination  = 0, // the statement does not terminate the function
    Return = 1, // guaranteed to return
    Fail = 2, // guaranteed to fail (we can treat the condition as an assertion)
}
Object.freeze( Termination );

export interface ITirStmt extends HasSourceRange {
    deps: () => string[];
    /**
     * @returns true if the statement is guaranteed to terminate the function
     * 
     * that implies there is a non-conditional return statement
     * or a non-conditional fail statement (which terminates the entire program)
     */
    definitelyTerminates: () => boolean;
    toString: () => string;
    pretty: ( indent: number ) => string;
    // clone: () => TirStmt;
}

export type TirStmt
    = TirVarDecl
    | TirIfStmt
    // destructured params are immediately replaced at translation
    // TIR only has simple parameters
    // AST destructured params just become
    // 
    // function astFunc({ a, b }: Thing) { ... }
    //
    // function tirFunc( §thing#1a3f: Thing ) {
    //     const { a, b } = §thing#1a3f;
    // }
    | TirForStmt
    // easier to optimize than normal for loop
    // we remember the difference between the two 
    | TirForOfStmt
    | TirWhileStmt
    | TirReturnStmt
    | TirBlockStmt
    | TirBreakStmt
    | TirContinueStmt
    | TirFailStmt
    | TirAssertStmt
    | TirTraceStmt
    // | TirTestStmt
    | TirMatchStmt
    | TirAssignmentStmt
    // | TirExprStmt
    ;

export function isTirStmt( thing: any ): thing is TirStmt
{
    return isObject( thing ) && (
        thing instanceof TirIfStmt
        || isTirVarDecl( thing)
        || thing instanceof TirForStmt
        || thing instanceof TirForOfStmt
        || thing instanceof TirWhileStmt
        || thing instanceof TirReturnStmt
        || thing instanceof TirBlockStmt
        || thing instanceof TirBreakStmt
        || thing instanceof TirContinueStmt
        || thing instanceof TirFailStmt
        || thing instanceof TirAssertStmt
        || thing instanceof TirTraceStmt
        // || thing instanceof TirTestStmt
        || thing instanceof TirMatchStmt
        || thing instanceof TirAssignmentStmt
        // || thing instanceof TirExprStmt
    );
}