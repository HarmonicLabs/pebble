import { AssertStmt } from "./AssertStmt";
import { BlockStmt } from "./BlockStmt";
import { BreakStmt } from "./BreakStmt";
import { ContinueStmt } from "./ContinueStmt";
import { isPebbleTypeDecl, PebbleTypeDecl } from "./declarations/PebbleTypeDecl";
import { DoWhileStmt } from "./DoWhileStmt";
import { EmptyStmt } from "./EmptyStmt";
import { TypeImplementsStmt } from "./TypeImplementsStmt";
import { ExportStarStmt } from "./ExportStarStmt";
import { ExportImportStmt } from "./ExportImportStmt";
import { FailStmt } from "./FailStmt";
import { ForOfStmt } from "./ForOfStmt";
import { ForStmt } from "./ForStmt";
import { IfStmt } from "./IfStmt";
import { ImportStarStmt } from "./ImportStarStmt";
import { ImportStmt } from "./ImportStmt";
import { MatchStmt } from "./MatchStmt";
import { ReturnStmt } from "./ReturnStmt";
import { TestStmt } from "./TestStmt";
import { VarStmt } from "./VarStmt";
import { WhileStmt } from "./WhileStmt";
import { AssignmentStmt, isAssignmentStmt } from "./AssignmentStmt";
import { IncrStmt } from "./IncrStmt";
import { DecrStmt } from "./DecrStmt";
import { UsingStmt } from "./UsingStmt";
import { FuncDecl } from "./declarations/FuncDecl";
import { ExportStmt } from "./ExportStmt";
import { InterfaceDecl } from "./declarations/InterfaceDecl";
import { ContractDecl } from "./declarations/ContractDecl";
import { TraceStmt } from "./TraceStmt";

/* *
 * An expression is a piece of code
 * that evaluates to a value,
 * 
 * while a statement is an instruction
 * that performs an action but 
 * does not return a value.
 * 
 * in some sense, a statement
 * is the only thing that can have side effects
 * (at least in pebble)
 */
/*
export type PebbleStmt
    = IfStmt
    | VarStmt
    | ForStmt
    | ForOfStmt
    | WhileStmt
    | ReturnStmt
    | BlockStmt
    | BreakStmt
    | ContinueStmt
    | EmptyStmt
    | FailStmt
    | AssertStmt
    | TestStmt
    | MatchStmt
    | PebbleTypeDecl
    | ExportStarStmt
    | ImportStarStmt
    | ExportImportStmt
    | ImportStmt
    | TypeImplementsStmt
    | AssignmentStmt
    | ExprStmt // function calls with native side effects (error and/or traces)
    | UsingStmt
    | FuncDecl
    | ExportStmt
    ;


export function isPebbleStmt( stmt: any ): stmt is PebbleStmt
{
    return (
           stmt instanceof IfStmt
        || stmt instanceof VarStmt
        || stmt instanceof ForStmt
        || stmt instanceof ForOfStmt
        || stmt instanceof WhileStmt
        || stmt instanceof DoWhileStmt
        || stmt instanceof ReturnStmt
        || stmt instanceof BlockStmt
        || stmt instanceof BreakStmt
        || stmt instanceof ContinueStmt
        || stmt instanceof EmptyStmt
        || stmt instanceof FailStmt
        || stmt instanceof AssertStmt
        || stmt instanceof TestStmt
        || stmt instanceof MatchStmt
        || isPebbleTypeDecl( stmt )
        || stmt instanceof ExportStarStmt
        || stmt instanceof ImportStarStmt
        || stmt instanceof ExportImportStmt
        || stmt instanceof ImportStmt
        || stmt instanceof TypeImplementsStmt
        || isAssignmentStmt( stmt )
        || stmt instanceof ExprStmt
        || stmt instanceof IncrStmt
        || stmt instanceof DecrStmt
        || stmt instanceof UsingStmt
        || stmt instanceof FuncDecl
        || stmt instanceof ExportStmt
    );
}
//*/


export type TopLevelStmt
    = EmptyStmt
    | VarStmt
    // | EnumDecl
    // | StructDecl
    // | TypeAliasDecl
    | PebbleTypeDecl
    | InterfaceDecl
    | FuncDecl
    | TestStmt
    | ExportStmt
    | ExportStarStmt
    | ExportImportStmt
    | ImportStmt
    | ImportStarStmt
    | TypeImplementsStmt
    | UsingStmt
    | ContractDecl
    ;

export function isTopLevelStmt( stmt: any ): stmt is TopLevelStmt
{
    return (
           stmt instanceof EmptyStmt
        || stmt instanceof VarStmt
        || isPebbleTypeDecl( stmt )
        || stmt instanceof FuncDecl
        || stmt instanceof TestStmt
        || stmt instanceof ExportStmt
        || stmt instanceof ExportStarStmt
        || stmt instanceof ExportImportStmt
        || stmt instanceof ImportStmt
        || stmt instanceof ImportStarStmt
        || stmt instanceof TypeImplementsStmt
        || stmt instanceof UsingStmt
        || stmt instanceof ContractDecl
    );
}

export type BodyStmt
    = IfStmt
    | VarStmt
    | ForStmt
    | ForOfStmt
    | WhileStmt
    | ReturnStmt
    | BlockStmt
    | BreakStmt
    | ContinueStmt
    | EmptyStmt
    | FailStmt
    | AssertStmt
    | TraceStmt
    | MatchStmt
    | AssignmentStmt
    // | ExprStmt // function calls with native side effects (error and/or traces)
    | UsingStmt
    ;

export function isBodyStmt( stmt: any ): stmt is BodyStmt
{
    return (
           stmt instanceof IfStmt
        || stmt instanceof VarStmt
        || stmt instanceof ForStmt
        || stmt instanceof ForOfStmt
        || stmt instanceof WhileStmt
        || stmt instanceof DoWhileStmt
        || stmt instanceof ReturnStmt
        || stmt instanceof BlockStmt
        || stmt instanceof BreakStmt
        || stmt instanceof ContinueStmt
        || stmt instanceof EmptyStmt
        || stmt instanceof FailStmt
        || stmt instanceof AssertStmt
        || stmt instanceof TraceStmt
        || stmt instanceof MatchStmt
        || isAssignmentStmt( stmt )
        // || stmt instanceof ExprStmt
        || stmt instanceof IncrStmt
        || stmt instanceof DecrStmt
        || stmt instanceof UsingStmt
    );
}