import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedNodeVersion = process.env.FASTIFEST_EXPECTED_NODE ?? "20.9.0";
assert.equal(
  process.versions.node,
  expectedNodeVersion,
  `Run this smoke test with Node ${expectedNodeVersion}; got ${process.versions.node}.`,
);

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryPackage = JSON.parse(
  await readFile(join(repositoryRoot, "package.json"), "utf8"),
);
const scratchRoot = await realpath(
  await mkdtemp(join(tmpdir(), "fastifest-min-node-smoke-")),
);
const packageDirectory = join(scratchRoot, "package");
const projectDirectory = join(scratchRoot, "consumer");

function run(command, args, options = {}) {
  const executable =
    process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  return execFileSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "pipe",
    ...(process.platform === "win32" && command === "npm"
      ? { shell: true }
      : {}),
    ...options,
  });
}

try {
  await mkdir(packageDirectory, { recursive: true });
  await mkdir(projectDirectory, { recursive: true });

  run("npm", ["run", "build"], { stdio: "inherit" });
  run("npm", ["pack", "--pack-destination", packageDirectory, "--silent"], {
    stdio: "inherit",
  });

  const archives = (await readdir(packageDirectory)).filter((name) =>
    name.endsWith(".tgz"),
  );
  assert.equal(
    archives.length,
    1,
    "npm pack should produce one package archive.",
  );
  const packageArchive = join(packageDirectory, archives[0]);

  run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--save-dev", packageArchive],
    { cwd: projectDirectory, stdio: "inherit" },
  );

  const logosDirectory = join(projectDirectory, "assets", "logos");
  await mkdir(logosDirectory, { recursive: true });
  await writeFile(
    join(logosDirectory, "brand.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#2563eb"/></svg>\n',
  );
  await writeFile(
    join(projectDirectory, "manifest.template.ts"),
    'export default { name: "Minimum Node smoke", start_url: "/", display: "standalone" };\n',
  );

  const help = run("npm", ["exec", "--", "fastifest", "--help"], {
    cwd: projectDirectory,
  });
  assert.match(help, /Usage: fastifest/);
  const version = run("npm", ["exec", "--", "fastifest", "--version"], {
    cwd: projectDirectory,
  });
  assert.equal(version.trim(), repositoryPackage.version);
  run("npm", ["exec", "--", "fastifest"], {
    cwd: projectDirectory,
    stdio: "inherit",
  });

  const publicDirectory = join(projectDirectory, "public");
  const manifestPath = join(publicDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.name, "Minimum Node smoke");
  assert.equal(manifest.icons.length, 4);

  for (const icon of manifest.icons) {
    const iconPath = join(publicDirectory, decodeURIComponent(icon.src));
    const fileInfo = await stat(iconPath);
    assert.ok(fileInfo.isFile(), `Expected generated icon at ${iconPath}.`);
  }

  console.log(
    `Packed-install CLI generation passed on Node ${process.versions.node} (${process.platform}/${process.arch}).`,
  );
} finally {
  await rm(scratchRoot, { recursive: true, force: true });
}
