import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { FastifestError } from "../errors.js";
import type { FastifestConfig, ResolvedFastifestConfig } from "../types.js";
import { validateConfig } from "./validate.js";

/** Options used while normalizing a config for a consumer project. */
export interface ResolveConfigOptions {
  /** Consumer project directory. Defaults to the current working directory. */
  cwd?: string;
}

function pathIsWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

function pathsOverlap(first: string, second: string): boolean {
  return pathIsWithin(first, second) || pathIsWithin(second, first);
}

function resolveInputPath(projectRoot: string, configured: string): string {
  return resolve(projectRoot, configured);
}

function resolveOutputPath(
  publicRoot: string,
  configured: string,
  field: string,
): string {
  if (isAbsolute(configured)) {
    throw new FastifestError(
      "PATH_INVALID",
      `config.paths.${field} must be relative to config.paths.public.`,
    );
  }
  const outputPath = resolve(publicRoot, configured);
  if (!pathIsWithin(publicRoot, outputPath) || outputPath === publicRoot) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `config.paths.${field} must resolve to a subdirectory inside the public root.`,
    );
  }
  return outputPath;
}

async function rejectSymlinkComponents(
  target: string,
  label: string,
): Promise<void> {
  const absolute = resolve(target);
  const parsed = parse(absolute);
  const segments = absolute
    .slice(parsed.root.length)
    .split(sep)
    .filter(Boolean);
  let current = parsed.root;

  for (const segment of segments) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new FastifestError(
          "UNSAFE_PATH",
          `${label} contains a symlink or reparse point: ${current}`,
        );
      }
    } catch (error) {
      if (error instanceof FastifestError) throw error;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw new FastifestError(
        "IO_FAILED",
        `Could not inspect ${label}: ${current}`,
        error,
      );
    }
  }
}

function assertDisjoint(label: string, paths: Array<[string, string]>): void {
  for (let i = 0; i < paths.length; i += 1) {
    const [firstName, firstPath] = paths[i]!;
    for (let j = i + 1; j < paths.length; j += 1) {
      const [secondName, secondPath] = paths[j]!;
      if (pathsOverlap(firstPath, secondPath)) {
        throw new FastifestError(
          "PATH_INVALID",
          `${label} paths must not overlap: ${firstName} (${firstPath}) conflicts with ${secondName} (${secondPath}).`,
        );
      }
    }
  }
}

/**
 * Validate a config, apply defaults, resolve absolute paths, and enforce path boundaries.
 *
 * Relative input/template paths resolve from the project root. Generated output
 * directories resolve from `paths.public` and must remain disjoint and contained
 * there; `manifest.json` must be directly inside the public root. Existing
 * symlink/reparse-point components are rejected.
 *
 * @param input - Untrusted config value to validate; unknown keys are rejected.
 * @param options - Consumer project root, defaulting to `process.cwd()`.
 * @returns A normalized configuration with absolute paths and resolved defaults.
 * @throws {FastifestError} With `CONFIG_INVALID`, `PATH_INVALID`, `UNSAFE_PATH`,
 * or `IO_FAILED` when validation or path checks fail.
 */
export async function resolveConfig(
  input: FastifestConfig | unknown,
  options: ResolveConfigOptions = {},
): Promise<ResolvedFastifestConfig> {
  const config = validateConfig(input);
  const requestedRoot = resolve(options.cwd ?? process.cwd());
  let projectRoot: string;
  try {
    projectRoot = await realpath(requestedRoot);
  } catch (error) {
    throw new FastifestError(
      "PATH_INVALID",
      `Project root does not exist or cannot be resolved: ${requestedRoot}`,
      error,
    );
  }
  try {
    if (!(await lstat(projectRoot)).isDirectory()) {
      throw new FastifestError(
        "PATH_INVALID",
        `Project root is not a directory: ${requestedRoot}`,
      );
    }
  } catch (error) {
    if (error instanceof FastifestError) throw error;
    throw new FastifestError(
      "IO_FAILED",
      `Could not inspect project root: ${projectRoot}`,
      error,
    );
  }

  const publicRoot = resolveInputPath(
    projectRoot,
    config.paths?.public ?? "./public",
  );
  const configuredManifestPath = config.paths?.manifest ?? "./manifest.json";
  if (isAbsolute(configuredManifestPath)) {
    throw new FastifestError(
      "PATH_INVALID",
      "config.paths.manifest must be relative to config.paths.public.",
    );
  }
  const manifestPath = resolve(publicRoot, configuredManifestPath);
  if (manifestPath !== resolve(publicRoot, "manifest.json")) {
    throw new FastifestError(
      "PATH_INVALID",
      "config.paths.manifest must be the manifest.json file directly inside the public root.",
    );
  }
  const logosPath = resolveInputPath(
    projectRoot,
    config.paths?.logos ?? "./assets/logos",
  );
  const screenshotsPath = resolveInputPath(
    projectRoot,
    config.paths?.screenshots ?? "./assets/screenshots",
  );
  const iconsOutputPath = resolveOutputPath(
    publicRoot,
    config.paths?.output?.logos ?? "./icons",
    "output.logos",
  );
  const screenshotsOutputPath = resolveOutputPath(
    publicRoot,
    config.paths?.output?.screenshots ?? "./screenshots",
    "output.screenshots",
  );
  const templatePath = resolveInputPath(
    projectRoot,
    config.template?.path ?? "./manifest.template.ts",
  );

  assertDisjoint("Input", [
    ["logos", logosPath],
    ["screenshots", screenshotsPath],
  ]);
  assertDisjoint("Output", [
    ["iconsOutput", iconsOutputPath],
    ["screenshotsOutput", screenshotsOutputPath],
  ]);
  assertDisjoint("Input/output", [
    ["logos", logosPath],
    ["screenshots", screenshotsPath],
    ["iconsOutput", iconsOutputPath],
    ["screenshotsOutput", screenshotsOutputPath],
  ]);
  assertDisjoint("Manifest/input/output", [
    ["manifest", manifestPath],
    ["logos", logosPath],
    ["screenshots", screenshotsPath],
    ["iconsOutput", iconsOutputPath],
    ["screenshotsOutput", screenshotsOutputPath],
  ]);

  for (const [label, path] of [
    ["project root", projectRoot],
    ["public root", publicRoot],
    ["manifest path", manifestPath],
    ["logos input", logosPath],
    ["screenshots input", screenshotsPath],
    ["icons output", iconsOutputPath],
    ["screenshots output", screenshotsOutputPath],
    ["template path", templatePath],
  ] as const) {
    await rejectSymlinkComponents(path, label);
  }

  return {
    projectRoot,
    publicRoot,
    manifestPath,
    logosPath,
    screenshotsPath,
    iconsOutputPath,
    screenshotsOutputPath,
    templatePath,
    templateEnabled: config.template?.enabled ?? true,
    overwrite: config.images?.overwrite ?? true,
    screenshotMetadata: config.screenshots?.metadata ?? {},
    logLevel: config.logging?.level ?? "info",
  };
}
