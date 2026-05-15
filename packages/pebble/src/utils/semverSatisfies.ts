// Tiny npm-style semver range matcher. Supports exact versions, comparator
// prefixes (>=, >, <=, <, =), caret (^), tilde (~), wildcards (*, x, X),
// hyphen ranges (a - b), AND (whitespace), and OR (||). Prerelease/build
// metadata is dropped; only the numeric MAJOR.MINOR.PATCH is compared.

type SV = readonly [number, number, number];
type Op = ">" | ">=" | "<" | "<=" | "=";
type Comparator = { op: Op; v: SV };
type Partial3 = [number | undefined, number | undefined, number | undefined];

function parseLoose(input: string): Partial3 | null {
    let s = input.trim().replace(/^v/i, "");
    if (s.length === 0) return null;
    s = s.split(/[-+]/)[0];
    if (s === "" || s === "*" || s === "x" || s === "X") {
        return [undefined, undefined, undefined];
    }
    const m = s.match(/^(\d+|x|X|\*)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?$/);
    if (!m) return null;
    const conv = (p: string | undefined): number | undefined =>
        p === undefined || p === "x" || p === "X" || p === "*"
            ? undefined
            : parseInt(p, 10);
    return [conv(m[1]), conv(m[2]), conv(m[3])];
}

function parseStrict(input: string): SV | null {
    const p = parseLoose(input);
    if (!p) return null;
    if (p[0] === undefined || p[1] === undefined || p[2] === undefined) return null;
    return [p[0], p[1], p[2]];
}

function fillLow(p: Partial3): SV {
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
}

function cmp(a: SV, b: SV): number {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
    return 0;
}

function satisfiesComp(v: SV, c: Comparator): boolean {
    const r = cmp(v, c.v);
    switch (c.op) {
        case ">": return r > 0;
        case ">=": return r >= 0;
        case "<": return r < 0;
        case "<=": return r <= 0;
        case "=": return r === 0;
    }
}

function caretUpper(p: Partial3): SV {
    const [a, b, c] = p;
    if ((a ?? 0) !== 0) return [(a ?? 0) + 1, 0, 0];
    if ((b ?? 0) !== 0) return [0, (b ?? 0) + 1, 0];
    return [0, 0, (c ?? 0) + 1];
}

function tildeUpper(p: Partial3): SV {
    const [a, b] = p;
    if (b !== undefined) return [a ?? 0, b + 1, 0];
    return [(a ?? 0) + 1, 0, 0];
}

function expandToken(tok: string): Comparator[] | null {
    tok = tok.trim();
    if (tok === "" || tok === "*" || tok === "x" || tok === "X") {
        return [{ op: ">=", v: [0, 0, 0] }];
    }
    const cmpMatch = tok.match(/^(>=|<=|>|<|=)\s*(.+)$/);
    if (cmpMatch) {
        const op = cmpMatch[1] as Op;
        const p = parseLoose(cmpMatch[2]);
        if (!p) return null;
        return [{ op, v: fillLow(p) }];
    }
    if (tok.startsWith("^")) {
        const p = parseLoose(tok.slice(1));
        if (!p) return null;
        return [
            { op: ">=", v: fillLow(p) },
            { op: "<", v: caretUpper(p) }
        ];
    }
    if (tok.startsWith("~")) {
        const p = parseLoose(tok.slice(1));
        if (!p) return null;
        return [
            { op: ">=", v: fillLow(p) },
            { op: "<", v: tildeUpper(p) }
        ];
    }
    const p = parseLoose(tok);
    if (!p) return null;
    const [a, b, c] = p;
    if (a === undefined) return [{ op: ">=", v: [0, 0, 0] }];
    if (b === undefined) return [
        { op: ">=", v: [a, 0, 0] },
        { op: "<", v: [a + 1, 0, 0] }
    ];
    if (c === undefined) return [
        { op: ">=", v: [a, b, 0] },
        { op: "<", v: [a, b + 1, 0] }
    ];
    return [{ op: "=", v: [a, b, c] }];
}

function expandRangePart(part: string): Comparator[] | null {
    const hyphen = part.match(/^(\S+)\s+-\s+(\S+)$/);
    if (hyphen) {
        const lo = parseLoose(hyphen[1]);
        const hi = parseLoose(hyphen[2]);
        if (!lo || !hi) return null;
        const lower: Comparator = { op: ">=", v: fillLow(lo) };
        const [ha, hb, hc] = hi;
        if (ha === undefined) return [lower];
        if (hb === undefined) return [lower, { op: "<", v: [ha + 1, 0, 0] }];
        if (hc === undefined) return [lower, { op: "<", v: [ha, hb + 1, 0] }];
        return [lower, { op: "<=", v: [ha, hb, hc] }];
    }
    const tokens = part.split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return null;
    const result: Comparator[] = [];
    for (const tok of tokens) {
        const cmps = expandToken(tok);
        if (!cmps) return null;
        result.push(...cmps);
    }
    return result;
}

export function semverSatisfies(version: string, range: string): boolean {
    if (typeof version !== "string" || typeof range !== "string") return false;
    const v = parseStrict(version);
    if (!v) return false;
    const trimmed = range.trim();
    if (trimmed.length === 0) return false;
    const ors = trimmed.split("||").map(s => s.trim());
    for (const part of ors) {
        const cmps = expandRangePart(part);
        if (!cmps) continue;
        if (cmps.every(c => satisfiesComp(v, c))) return true;
    }
    return false;
}
