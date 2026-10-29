#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error(
    "Run this check through `npm run package:check` so the active npm CLI can be located.",
  );
  process.exit(1);
}

let packOutput;
try {
  packOutput = execFileSync(
    process.execPath,
    [npmCli, "pack", "--dry-run", "--json"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
} catch (error) {
  console.error("Could not inspect the npm package file list.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

let packResult;
try {
  packResult = JSON.parse(packOutput);
} catch (error) {
  console.error("npm pack --dry-run did not return valid JSON.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (
  !Array.isArray(packResult) ||
  packResult.length !== 1 ||
  typeof packResult[0] !== "object" ||
  packResult[0] === null ||
  !Array.isArray(packResult[0].files)
) {
  console.error("npm pack --dry-run returned an unexpected file-list format.");
  process.exit(1);
}

const files = packResult[0].files.map((file) => file.path);
const allowed = (path) =>
  path === "package.json" ||
  path === "README.md" ||
  path === "LICENSE" ||
  path.startsWith("dist/") ||
  path.startsWith("docs/user/");
const unexpected = files.filter(
  (path) =>
    typeof path !== "string" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "..") ||
    !allowed(path),
);
const requiredFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/cli.js",
  "dist/index.js",
  "dist/index.d.ts",
  "docs/user/getting-started.md",
  "docs/user/examples/programmatic.mjs",
];
const missing = requiredFiles.filter((path) => !files.includes(path));

if (unexpected.length > 0 || missing.length > 0) {
  if (unexpected.length > 0) {
    console.error(`Unexpected files in package: ${unexpected.join(", ")}`);
  }
  if (missing.length > 0) {
    console.error(`Required package files are missing: ${missing.join(", ")}`);
  }
  process.exit(1);
}

console.log(
  `Package contents verified: ${files.length} files; only runtime output and consumer documentation are included.`,
);
