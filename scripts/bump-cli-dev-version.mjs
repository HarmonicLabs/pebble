import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkgPath = resolve(root, "packages/pebble-cli/package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

const version = pkg.version;
const devMatch = version.match(/^(.+)-dev(\d+)$/);

let newVersion;
if (devMatch) {
    // 0.1.3-dev6 -> 0.1.3-dev7
    newVersion = `${devMatch[1]}-dev${Number(devMatch[2]) + 1}`;
} else {
    // 0.1.3 -> 0.1.4-dev0
    const parts = version.split(".");
    parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
    newVersion = `${parts.join(".")}-dev0`;
}

console.log(`${version} -> ${newVersion}`);
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
