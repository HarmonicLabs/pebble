import { execSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync, renameSync, existsSync, unlinkSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");
const pebbleDir = join(rootDir, "packages", "pebble");
const pebbleCliDir = join(rootDir, "packages", "pebble-cli");

// run ci && npm pack in packages/pebble
console.log("Running npm run ci && npm pack in packages/pebble...");
execSync("npm run ci && npm pack", { cwd: pebbleDir, stdio: "inherit" });

// find the generated .tgz file
const tgz = readdirSync(pebbleDir).find(f => f.endsWith(".tgz"));
if (!tgz) {
    throw new Error("No .tgz file found in packages/pebble after npm pack");
}

const srcPath = join(pebbleDir, tgz);
const destPath = join(pebbleCliDir, tgz);

// remove old tarballs in pebble-cli
for (const file of readdirSync(pebbleCliDir)) {
    if (file.endsWith(".tgz")) {
        unlinkSync(join(pebbleCliDir, file));
    }
}

// move tarball to pebble-cli
renameSync(srcPath, destPath);
console.log(`Moved ${tgz} to packages/pebble-cli/`);

// update pebble-cli/package.json to use the local tarball
const pkgJsonPath = join(pebbleCliDir, "package.json");
const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
pkgJson.dependencies["@harmoniclabs/pebble"] = tgz;
writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
console.log(`Updated pebble-cli/package.json: @harmoniclabs/pebble -> ${tgz}`);
