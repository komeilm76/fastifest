#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = join(
  repositoryRoot,
  "docs",
  "user",
  "examples",
  "programmatic.mjs",
);
const scratchRoot = await mkdtemp(join(tmpdir(), "fastifest-api-example-"));
const projectRoot = join(scratchRoot, "consumer");
const logoDirectory = join(projectRoot, "assets", "logos");

function runExample(cwd) {
  try {
    return execFileSync(process.execPath, [examplePath], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const stdout = error.stdout?.toString() ?? "";
    const stderr = error.stderr?.toString() ?? "";
    const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    throw new Error(
      `The documented API example failed in ${cwd}.${detail ? `\n${detail}` : ""}`,
      { cause: error },
    );
  }
}

try {
  await mkdir(logoDirectory, { recursive: true });
  await writeFile(
    join(logoDirectory, "brand.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#2563eb"/></svg>\n',
  );

  const firstRunOutput = runExample(projectRoot);
  const templatePath = join(projectRoot, "manifest.template.ts");
  await stat(templatePath);
  await assert.rejects(
    stat(join(projectRoot, "public", "manifest.json")),
    { code: "ENOENT" },
    "The first-run template result must stop before writing a manifest.",
  );
  assert.match(firstRunOutput, /Customize the starter/);

  await writeFile(
    templatePath,
    'export default { name: "API example smoke", short_name: "API example", start_url: "/", scope: "/", display: "standalone" };\n',
  );
  const generationOutput = runExample(projectRoot);
  const publicRoot = join(projectRoot, "public");
  const manifestPath = join(publicRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.equal(manifest.name, "API example smoke");
  assert.equal(manifest.icons.length, 4);
  assert.match(generationOutput, /Wrote .*manifest\.json/);
  for (const icon of manifest.icons) {
    const iconPath = join(publicRoot, decodeURIComponent(icon.src));
    assert.ok(
      (await stat(iconPath)).isFile(),
      `Missing generated icon: ${iconPath}`,
    );
  }

  const invalidProject = join(scratchRoot, "invalid-consumer");
  await mkdir(invalidProject, { recursive: true });
  await writeFile(
    join(invalidProject, "fastifest.config.ts"),
    "export default { unsupportedOption: true };\n",
  );
  let expectedFailure;
  try {
    runExample(invalidProject);
  } catch (error) {
    expectedFailure = error;
  }
  assert.ok(
    expectedFailure,
    "Invalid config should make the example exit nonzero.",
  );
  assert.match(expectedFailure.message, /CONFIG_INVALID/);

  console.log(
    "Programmatic API example passed: first-run stop, generation, and FastifestError handling verified against the built local package.",
  );
} finally {
  await rm(scratchRoot, { recursive: true, force: true });
}
