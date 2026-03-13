import { AssertStmt } from "../../../../ast/nodes/statements/AssertStmt";
import { isAssignmentStmt } from "../../../../ast/nodes/statements/AssignmentStmt";
import { BlockStmt } from "../../../../ast/nodes/statements/BlockStmt";
import { BreakStmt } from "../../../../ast/nodes/statements/BreakStmt";
import { ContinueStmt } from "../../../../ast/nodes/statements/ContinueStmt";
import { isVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/VarDecl";
import { EmptyStmt } from "../../../../ast/nodes/statements/EmptyStmt";
import { FailStmt } from "../../../../ast/nodes/statements/FailStmt";
import { TraceStmt } from "../../../../ast/nodes/statements/TraceStmt";
import { ForOfStmt } from "../../../../ast/nodes/statements/ForOfStmt";
import { ForStmt } from "../../../../ast/nodes/statements/ForStmt";
import { IfStmt } from "../../../../ast/nodes/statements/IfStmt";
import { MatchStmt } from "../../../../ast/nodes/statements/MatchStmt";
import { BodyStmt } from "../../../../ast/nodes/statements/PebbleStmt";
import { ReturnStmt } from "../../../../ast/nodes/statements/ReturnStmt";
import { TestStmt } from "../../../../ast/nodes/statements/TestStmt";
import { UsingStmt } from "../../../../ast/nodes/statements/UsingStmt";
import { VarStmt } from "../../../../ast/nodes/statements/VarStmt";
import { WhileStmt } from "../../../../ast/nodes/statements/WhileStmt";
import { TirStmt } from "../../../tir/statements/TirStmt";
import { AstCompilationCtx } from "../../AstCompilationCtx";
import { _compileAssertStmt } from "./_compileAssertStmt";
import { _compileAssignmentStmt } from "./_compileAssignmentStmt";
import { _compileBlockStmt } from "./_compileBlockStmt";
import { _compileBreakStmt } from "./_compileBreakStmt";
import { _compileContinueStmt } from "./_compileContinueStmt";
import { _compileFailStmt } from "./_compileFailStmt";
import { _compileTraceStmt } from "./_compileTraceStmt";
import { _compileForOfStmt } from "./_compileForOfStmt";
import { _compileForStmt } from "./_compileForStmt";
import { _compileIfStmt } from "./_compileIfStmt";
import { _compileMatchStmt } from "./_compileMatchStmt";
import { _compileReturnStmt } from "./_compileReturnStmt";
import { _compileUsingStmt } from "./_compileUsingStmt";
import { _compileVarStmt } from "./_compileVarStmt";
import { _compileWhileStmt } from "./_compileWhileStmt";

/**
 * here we just translate to TIR
 * 
 * WE DO NOT OPTIMIZE
 * 
 * optimizaitons are part of the TIR -> TermIR compilation
**/
export function _compileStatement(
    ctx: AstCompilationCtx,
    stmt: BodyStmt
): TirStmt[] | undefined
{
    if( stmt instanceof IfStmt ) return _compileIfStmt( ctx, stmt );
    if( isVarDecl( stmt ) ) stmt = new VarStmt([ stmt ], stmt.range ); // sometime these slip through
    if( stmt instanceof VarStmt ) return _compileVarStmt( ctx, stmt );
    if( stmt instanceof ForStmt ) return _compileForStmt( ctx, stmt );
    if( stmt instanceof ForOfStmt ) return _compileForOfStmt( ctx, stmt );
    if( stmt instanceof WhileStmt ) return _compileWhileStmt( ctx, stmt );
    if( stmt instanceof ReturnStmt ) return _compileReturnStmt( ctx, stmt );
    if( stmt instanceof BlockStmt ) return _compileBlockStmt( ctx, stmt );
    if( stmt instanceof BreakStmt ) return _compileBreakStmt( ctx, stmt );
    if( stmt instanceof ContinueStmt ) return _compileContinueStmt( ctx, stmt );
    if( stmt instanceof EmptyStmt ) return [];
    if( stmt instanceof FailStmt ) return _compileFailStmt( ctx, stmt );
    if( stmt instanceof AssertStmt ) return _compileAssertStmt( ctx, stmt );
    if( stmt instanceof TraceStmt ) return _compileTraceStmt( ctx, stmt );
    // if( stmt instanceof TestStmt ) return _compileTestStmt( ctx, stmt );
    if( stmt instanceof MatchStmt ) return _compileMatchStmt( ctx, stmt );
    if( isAssignmentStmt( stmt ) ) return _compileAssignmentStmt( ctx, stmt );
    // if( stmt instanceof ExprStmt ) return _compileExprStmt( ctx, stmt );
    if( stmt instanceof UsingStmt ) return _compileUsingStmt( ctx, stmt );

    const tsEnsureExhautstiveCheck: never = stmt;
    console.error( stmt );
    throw new Error("unreachable::AstCompiler::_compileStatement");
}