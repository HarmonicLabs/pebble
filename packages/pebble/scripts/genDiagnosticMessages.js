import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const dirname = globalThis.__dirname ?? path.dirname(fileURLToPath(import.meta.url));

void function main() {

    const indent = "    ";

    const out = [
        `// GENERATED FILE. DO NOT EDIT.\n\n`
    ];

    out.push("/** Enum of available diagnostic codes. */\n");
    out.push("export enum DiagnosticCode {\n");

    let first = true;
    const messages = JSON.parse(
        fs.readFileSync(
            path.join(dirname, "..", "src", "diagnostics", "diagnosticMessages.json"),
            "utf8"
        )
    );
    // a code shared by two messages shows only the first of them
    const byCode = new Map();
    for (const [text, code] of Object.entries(messages)) {
        if (byCode.has(code)) throw new Error(`diagnostic code ${code} is used by two messages: ${JSON.stringify(byCode.get(code))} and ${JSON.stringify(text)}`);
        byCode.set(code, text);
    }

    Object.keys(messages).forEach(text => {
        let key = makeKey(text);
        if (first)
            first = false;
        else {
            out.push(",\n");
        }
        out.push(indent + key + " = " + messages[text]);
    });

    out.push("\n}\n\n");
    out.push("/** Translates a diagnostic code to its respective string. */\n");
    out.push("export function diagnosticCodeToString(code: DiagnosticCode): string {\n"+indent+"switch (code) {\n");

    Object.keys(messages).forEach(text => {
        out.push(indent+indent+"case " + messages[text] + ": return " + JSON.stringify(text) + ";\n");
    });

    out.push(indent+indent+"default: return \"\";\n"+indent+"}\n}\n");

    const generated = out.join("");
    fs.writeFileSync(path.join(dirname, "..", "src", "diagnostics", "diagnosticMessages.generated.ts"), generated);
}()

function makeKey(text) {
    return text
        .replace(/[^\w]+/g, "_") // any non-word character to underscore
        .replace(/_+$/, ""); // consecutive underscores to one
}