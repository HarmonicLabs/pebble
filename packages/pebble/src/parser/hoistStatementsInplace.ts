import { EnumDecl } from "../ast/nodes/statements/declarations/EnumDecl";
import { FuncDecl } from "../ast/nodes/statements/declarations/FuncDecl";
import { InterfaceDecl } from "../ast/nodes/statements/declarations/InterfaceDecl";
import { StructDecl } from "../ast/nodes/statements/declarations/StructDecl";
import { TypeAliasDecl } from "../ast/nodes/statements/declarations/TypeAliasDecl";
import { ExportStarStmt } from "../ast/nodes/statements/ExportStarStmt";
import { ExportImportStmt } from "../ast/nodes/statements/ExportImportStmt";
import { ImportStarStmt } from "../ast/nodes/statements/ImportStarStmt";
import { ImportStmt } from "../ast/nodes/statements/ImportStmt";
import { TypeImplementsStmt } from "../ast/nodes/statements/TypeImplementsStmt";
import { isVarStmt } from "../ast/nodes/statements/VarStmt";
import { TopLevelStmt } from "../ast/nodes/statements/PebbleStmt";

function moveStmt( stmts: TopLevelStmt[], fromIdx: number, toIdx: number )
{
    if( fromIdx === toIdx ) return;
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/splice
    stmts.splice(
        toIdx,
        0,
        stmts.splice( fromIdx, 1 )[0]
    );
}

/**
 * final order:
 * 
 * 1. all imports
 * 2. (export *) AND (export { ... })
 * 3. enum declarations (guaranteed no dependencies)
 * 4. struct and alias declarations
 * 5. interface declarations
 * 6. interface implementations
 * 7. function declarations and var declarations
 * 8. all other statements
 */
export function hoistStatementsInplace( stmts: TopLevelStmt[] ): void
{
    const nStmts = stmts.length;
    let lastSortedIdx = 0;
    let // avoid unnecessary loops later
        hasExports = false,
        hasEnums = false,
        hasStructs = false,
        hasInterfaces = false,
        hasImplements = false,
        hasFunctions = false;
    // hoist imports
    for( let i = 0; i < nStmts; ++i )
    {
        const stmt = stmts[i];
        if(
            stmt instanceof ImportStmt
            || stmt instanceof ImportStarStmt
        ) moveStmt( stmts, i, lastSortedIdx++ );

        hasExports = hasExports || stmt instanceof ExportImportStmt || stmt instanceof ExportStarStmt;
        hasEnums = hasEnums || stmt instanceof EnumDecl;
        hasStructs = hasStructs || stmt instanceof StructDecl || stmt instanceof TypeAliasDecl;
        hasInterfaces = hasInterfaces || stmt instanceof InterfaceDecl;
        hasImplements = hasImplements || stmt instanceof TypeImplementsStmt;
        hasFunctions = hasFunctions || stmt instanceof FuncDecl || isVarStmt( stmt );
    }
    // hoist exports
    if( hasExports )
    for( let i = lastSortedIdx; i < nStmts; ++i )
    {
        const stmt = stmts[i];
        if(
            stmt instanceof ExportImportStmt
            || stmt instanceof ExportStarStmt
        ) moveStmt( stmts, i, lastSortedIdx++ );
    }
    // hoist enum
    if( hasEnums )
    for( let i = lastSortedIdx; i < nStmts; ++i )
    {
        const stmt = stmts[i];
        if(
            stmt instanceof EnumDecl
        ) moveStmt( stmts, i, lastSortedIdx++ );
    }
    // hoist struct and alias declarations
    if( hasStructs )
    for( let i = lastSortedIdx; i < nStmts; ++i )
    {
        const stmt = stmts[i];
        if(
            stmt instanceof StructDecl
            || stmt instanceof TypeAliasDecl
        ) moveStmt( stmts, i, lastSortedIdx++ );
    }
    // hoist interface declarations
    if( hasInterfaces )
    for( let i = lastSortedIdx; i < nStmts; ++i )
    {
        const stmt = stmts[i];
        if(
            stmt instanceof InterfaceDecl
        ) moveStmt( stmts, i, lastSortedIdx++ );
    }
    // hoist interface implementations
    if( hasImplements )
    for( let i = lastSortedIdx; i < nStmts; ++i )
    {
        const stmt = stmts[i];
        if(
            stmt instanceof TypeImplementsStmt
        ) moveStmt( stmts, i, lastSortedIdx++ );
    }
    // hoist function declarations
    if( hasFunctions )
    for( let i = lastSortedIdx; i < nStmts; ++i )
    {
        const stmt = stmts[i];
        if(
            stmt instanceof FuncDecl
            || isVarStmt( stmt )
        ) moveStmt( stmts, i, lastSortedIdx++ );
    }
    // all other statements are already in place        
}