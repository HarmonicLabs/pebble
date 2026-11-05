import type { SourceRange } from "../../../ast/Source/SourceRange";
import type { DeclareSymbol, PebbleSymbol } from "../../SymbolIndex";
import type { TypedProgram } from "../../tir/program/TypedProgram";
import type { AstScope } from "../scope/AstScope";

/**
 * Where a name that `declRange` declares in `scope` can be used: from the end of the declaration
 * to the end of the innermost scope the source delimits (`AstScope.range`). `undefined` at a
 * file's top level, where it is the whole file.
 */
export function visibilityIn( scope: AstScope, declRange: SourceRange ): { start: number; end: number } | undefined
{
    for( let s: AstScope | undefined = scope; s !== undefined; s = s.parent )
        if( s.range !== undefined ) return { start: declRange.end, end: s.range.end };
    return undefined;
}

/**
 * Declares `info` in the program's symbol index, when it has one (a check), visible in `scope`
 * unless `info.visibleIn` says otherwise.
 */
export function declareSymbol( program: TypedProgram, scope: AstScope | undefined, info: DeclareSymbol ): PebbleSymbol | undefined
{
    if( program.symbols === undefined ) return undefined;
    return program.symbols.declare({
        ...info,
        visibleIn: info.visibleIn ?? ( scope !== undefined ? visibilityIn( scope, info.range ) : undefined ),
    });
}

/** `range` names `symbol`, in the program's symbol index if it has one */
export function referenceSymbol( program: TypedProgram, range: SourceRange, symbol: PebbleSymbol | undefined, write: boolean = false ): void
{
    program.symbols?.reference( range, symbol, write );
}
