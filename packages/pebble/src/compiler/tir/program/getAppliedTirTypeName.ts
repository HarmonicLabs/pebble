/**
 * Canonical name of a generic type applied to concrete argument names, e.g.
 * `List` + `["int"]` -> `List<int>`.
 *
 * Deliberately a standalone, ZERO-dependency module. It used to live in
 * `TypedProgram.ts`, but the low-level type files (`list`, `linearMap`,
 * `Optional`, `array`, ...) import it — and importing it from `TypedProgram`
 * dragged the whole program module (and its `populate*`/`TirToDataExpr`
 * imports, which compute IR constants at load time) into those files'
 * initialization chain, creating an import cycle that only a lazy `require`
 * could paper over. Isolating this pure helper breaks that cycle at its
 * source, so every consumer imports it with a plain static import.
 */
export function getAppliedTirTypeName(
    baseName: string,
    args: string[]
): string
{
    return `${baseName}<${args.join(",")}>`;
}
