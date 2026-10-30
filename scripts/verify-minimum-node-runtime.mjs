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

const expectedNodeVersion = process.env.FASTIFEST_EXPECTED_NODE ?? "20.10.0";
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
let stage = "prepare temporary project";

function run(command, args, options = {}) {
  const { showOutput = false, ...processOptions } = options;
  const executable =
    process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  try {
    const output = execFileSync(executable, args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: "pipe",
      ...(process.platform === "win32" && command === "npm"
        ? { shell: true }
        : {}),
      ...processOptions,
    });
    if (showOutput && output) process.stdout.write(output);
    return output;
  } catch (error) {
    const childOutput = [error.stdout, error.stderr]
      .filter(Boolean)
      .map((value) => value.toString())
      .join("\n");
    throw new Error(
      `${command} ${args.join(" ")} failed during ${stage}.${childOutput ? `\n${childOutput}` : ""}`,
      { cause: error },
    );
  }
}

function escapeWorkflowCommand(value) {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

try {
  await mkdir(packageDirectory, { recursive: true });
  await mkdir(projectDirectory, { recursive: true });

  stage = "building the package";
  run("npm", ["run", "build"], { showOutput: true });
  stage = "packing the built package";
  run("npm", ["pack", "--pack-destination", packageDirectory, "--silent"], {
    showOutput: true,
  });

  stage = "locating the package archive";
  const archives = (await readdir(packageDirectory)).filter((name) =>
    name.endsWith(".tgz"),
  );
  assert.equal(
    archives.length,
    1,
    "npm pack should produce one package archive.",
  );
  const packageArchive = join(packageDirectory, archives[0]);

  stage = "installing the packed package and runtime dependencies";
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--save-dev", packageArchive],
    { cwd: projectDirectory, showOutput: true },
  );

  stage = "preparing the consumer project";
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

  stage = "checking the installed CLI help";
  const help = run("npm", ["exec", "--", "fastifest", "--help"], {
    cwd: projectDirectory,
  });
  assert.match(help, /Usage: fastifest/);

  stage = "checking the installed CLI version";
  const version = run("npm", ["exec", "--", "fastifest", "--version"], {
    cwd: projectDirectory,
  });
  assert.equal(version.trim(), repositoryPackage.version);

  stage = "generating assets through the installed CLI";
  run("npm", ["exec", "--", "fastifest"], {
    cwd: projectDirectory,
    showOutput: true,
  });

  stage = "verifying generated manifest and icon files";
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
} catch (error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  const detail = `Minimum-runtime smoke failed during ${stage}: ${message}`;
  console.error(detail);
  if (process.env.GITHUB_ACTIONS === "true") {
    process.stderr.write(
      `::error title=Minimum Node smoke failed::${escapeWorkflowCommand(detail)}\n`,
    );
  }
  throw error;
} finally {
  await rm(scratchRoot, { recursive: true, force: true });
}
