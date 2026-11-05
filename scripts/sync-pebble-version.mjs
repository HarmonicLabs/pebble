import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pebblePkg = JSON.parse(readFileSync(resolve(root, "packages/pebble/package.json"), "utf-8"));
const cliPkgPath = resolve(root, "packages/pebble-cli/package.json");
const cliPkgText = readFileSync(cliPkgPath, "utf-8");
const cliPkg = JSON.parse(cliPkgText);
// written back with the file's own indentation, so that only the version changes
const indent = cliPkgText.match(/^[ \t]+(?=")/m)?.[0] ?? 2;

const version = pebblePkg.version;
const current = cliPkg.dependencies?.["@harmoniclabs/pebble"];

if (current === version) {
    console.log(`pebble-cli already depends on @harmoniclabs/pebble@${version}`);
    process.exit(0);
}

console.log(`updating @harmoniclabs/pebble dependency: ${current} -> ${version}`);
cliPkg.dependencies["@harmoniclabs/pebble"] = version;
writeFileSync(cliPkgPath, JSON.stringify(cliPkg, null, indent) + "\n");
