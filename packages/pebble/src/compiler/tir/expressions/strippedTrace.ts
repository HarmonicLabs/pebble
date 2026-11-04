import type { SourceRange } from "../../../ast/Source/SourceRange";
import { IRFunc } from "../../../IR/IRNodes/IRFunc";
import type { IRTerm } from "../../../IR/IRTerm";
import { freeSymbols, sourceTextOf, StrippedTrace } from "../../../IR/sourceMap/irTraces";
import { TirLitFalseExpr } from "./litteral/TirLitFalseExpr";
import { TirLitHexBytesExpr } from "./litteral/TirLitHexBytesExpr";
import { TirLitIntExpr } from "./litteral/TirLitIntExpr";
import { TirLitStrExpr } from "./litteral/TirLitStrExpr";
import { TirLitTrueExpr } from "./litteral/TirLitTrueExpr";
import type { TirExpr } from "./TirExpr";
import { TirLettedExpr } from "./TirLettedExpr";
import { TirTypeConversionExpr } from "./TirTypeConversionExpr";

/**
 * A trace the compiler removes (`removeTraces`), for the source map: a message that is always
 * the same is kept as text; one computed from values as its source text and an IR term that
 * computes it, closed over the variables it reads (`messageIR` builds the message's IR, a
 * string, as the trace would have printed it).
 */
export function strippedTrace(
    kind: StrippedTrace["kind"],
    range: SourceRange | undefined,
    message: TirExpr,
    messageIR: () => IRTerm
): StrippedTrace
{
    const text = constantMessage( message );
    if( text !== undefined ) return { kind, range, message: text };
    const ir = messageIR();
    const params = freeSymbols( ir );
    return {
        kind,
        range,
        expression: sourceTextOf( message.range ) ?? message.toString(),
        // detached from the program, whose passes rewrite its nodes in place
        recipe: { ir: ( params.length > 0 ? new IRFunc( params, ir ) : ir ).clone(), params },
    };
}

/** the text a trace of `expr` prints when it is the same every time: a literal, or a literal converted */
export function constantMessage( expr: TirExpr ): string | undefined
{
    if( expr instanceof TirLitStrExpr ) return expr.string;
    if( expr instanceof TirLitHexBytesExpr ) return utf8( expr.bytes );
    if( expr instanceof TirLitIntExpr ) return expr.integer.toString();
    if( expr instanceof TirLitTrueExpr ) return "true";
    if( expr instanceof TirLitFalseExpr ) return "false";
    // a bytes literal used as a string: the same text
    if( expr instanceof TirTypeConversionExpr ) return constantMessage( expr.expr );
    if( expr instanceof TirLettedExpr ) return constantMessage( expr.expr );
    return undefined;
}

/** the text of utf-8 bytes; `undefined` when they are not utf-8 (printing them fails) */
function utf8( bytes: Uint8Array ): string | undefined
{
    try { return new TextDecoder( "utf-8", { fatal: true } ).decode( bytes ); }
    catch { return undefined; }
}
