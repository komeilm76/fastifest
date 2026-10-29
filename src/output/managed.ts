import type { Dirent, Stats } from "node:fs";
import { lstat, readdir, unlink } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { FastifestError } from "../errors.js";
import { createLogger, type Logger } from "../logger.js";
import { compareSourceBasenames } from "../discovery/index.js";
import type { ResolvedFastifestConfig } from "../types.js";
import type { GeneratedLogoIcon } from "../images/logo.js";
import {
  MAX_SCREENSHOT_SIDE,
  type GeneratedScreenshot,
} from "../images/screenshots.js";

const ICONS: Readonly<
  Record<string, { size: number; purpose: "any" | "maskable" }>
> = {
  "icon-192.png": { size: 192, purpose: "any" },
  "icon-512.png": { size: 512, purpose: "any" },
  "icon-maskable-192.png": { size: 192, purpose: "maskable" },
  "icon-maskable-512.png": { size: 512, purpose: "maskable" },
};
const ICON_ORDER = Object.keys(ICONS);
const SCREENSHOT_NAME = /^screenshot-\d{2,}\.png(?![\s\S])/;

export interface PlannedManagedAsset {
  filename: string;
  path: string;
  buffer: Buffer;
}

/** Read-only plan for managed asset writes and post-commit stale screenshot cleanup. */
export interface ManagedOutputPlan {
  overwrite: boolean;
  iconsDirectory: string;
  screenshotsDirectory: string;
  iconWrites: PlannedManagedAsset[];
  screenshotWrites: PlannedManagedAsset[];
  staleScreenshotPaths: string[];
  /** Filesystem snapshots captured during preflight; changed files are never cleaned up. */
  staleScreenshotSnapshots: ReadonlyMap<string, Stats>;
}

interface OutputDirectorySnapshot {
  entries: Dirent[];
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

function isWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent !== "" &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

function isSameOrWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent === "" ||
    (pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromParent))
  );
}

function pathsOverlap(first: string, second: string): boolean {
  return isSameOrWithin(first, second) || isSameOrWithin(second, first);
}

function sameFile(first: Stats, second: Stats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function unchangedFile(first: Stats, second: Stats): boolean {
  return (
    sameFile(first, second) &&
    first.size === second.size &&
    first.mtimeMs === second.mtimeMs &&
    first.ctimeMs === second.ctimeMs
  );
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
      if ((await lstat(current)).isSymbolicLink()) {
        throw new FastifestError(
          "UNSAFE_PATH",
          `${label} contains a symlink or reparse point: ${current}`,
        );
      }
    } catch (error) {
      if (error instanceof FastifestError) throw error;
      if (errorCode(error) === "ENOENT") return;
      throw new FastifestError(
        "IO_FAILED",
        `Could not inspect ${label}: ${current}`,
        error,
      );
    }
  }
}

function validateConfigRoots(config: ResolvedFastifestConfig): void {
  const publicRoot = resolve(config.publicRoot);
  const manifestPath = resolve(config.manifestPath);
  const iconsDirectory = resolve(config.iconsOutputPath);
  const screenshotsDirectory = resolve(config.screenshotsOutputPath);

  if (manifestPath !== resolve(publicRoot, "manifest.json")) {
    throw new FastifestError(
      "PATH_INVALID",
      "The managed output plan requires manifest.json directly inside the configured public root.",
    );
  }
  if (
    !isWithin(publicRoot, iconsDirectory) ||
    !isWithin(publicRoot, screenshotsDirectory)
  ) {
    throw new FastifestError(
      "UNSAFE_PATH",
      "Managed icon and screenshot output directories must be subdirectories of the public root.",
    );
  }
  if (
    pathsOverlap(iconsDirectory, screenshotsDirectory) ||
    pathsOverlap(manifestPath, iconsDirectory) ||
    pathsOverlap(manifestPath, screenshotsDirectory)
  ) {
    throw new FastifestError(
      "PATH_INVALID",
      "Managed output directories must not overlap one another or manifest.json.",
    );
  }
}

function validateAssets(
  icons: readonly GeneratedLogoIcon[],
  screenshots: readonly GeneratedScreenshot[],
): { icons: GeneratedLogoIcon[]; screenshots: GeneratedScreenshot[] } {
  const iconMap = new Map<string, GeneratedLogoIcon>();
  for (const icon of icons) {
    const expected = ICONS[icon.filename];
    if (
      !expected ||
      iconMap.has(icon.filename) ||
      icon.size !== expected.size ||
      icon.purpose !== expected.purpose ||
      icon.mimeType !== "image/png" ||
      !Buffer.isBuffer(icon.buffer) ||
      icon.buffer.length === 0
    ) {
      throw new FastifestError(
        "INPUT_INVALID",
        `Refusing to manage unrecognized or invalid icon output: ${icon.filename}`,
      );
    }
    iconMap.set(icon.filename, icon);
  }
  if (iconMap.size !== ICON_ORDER.length) {
    throw new FastifestError(
      "INPUT_INVALID",
      "The managed icon set must contain exactly one of each reserved Fastifest icon.",
    );
  }

  const orderedIcons = ICON_ORDER.map((filename) => iconMap.get(filename)!);
  const orderedScreenshots = [...screenshots];
  for (const [index, screenshot] of orderedScreenshots.entries()) {
    const expectedName = `screenshot-${String(index + 1).padStart(2, "0")}.png`;
    if (
      screenshot.filename !== expectedName ||
      !SCREENSHOT_NAME.test(screenshot.filename) ||
      screenshot.mimeType !== "image/png" ||
      !Number.isSafeInteger(screenshot.width) ||
      !Number.isSafeInteger(screenshot.height) ||
      screenshot.width < 1 ||
      screenshot.height < 1 ||
      screenshot.width > MAX_SCREENSHOT_SIDE ||
      screenshot.height > MAX_SCREENSHOT_SIDE ||
      !Buffer.isBuffer(screenshot.buffer) ||
      screenshot.buffer.length === 0
    ) {
      throw new FastifestError(
        "INPUT_INVALID",
        `Refusing to manage unrecognized or invalid screenshot output: ${screenshot.filename}`,
      );
    }
  }
  return { icons: orderedIcons, screenshots: orderedScreenshots };
}

async function readOutputDirectory(
  directory: string,
  label: string,
): Promise<OutputDirectorySnapshot> {
  await rejectSymlinkComponents(directory, `${label} output directory`);
  let info: Stats;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { entries: [] };
    if (errorCode(error) === "ENOTDIR") {
      throw new FastifestError(
        "PATH_INVALID",
        `${label} output path is not a directory: ${directory}`,
        error,
      );
    }
    throw new FastifestError(
      "IO_FAILED",
      `Could not inspect ${label} output directory: ${directory}`,
      error,
    );
  }
  if (info.isSymbolicLink()) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `${label} output directory is a symlink or reparse point: ${directory}`,
    );
  }
  if (!info.isDirectory()) {
    throw new FastifestError(
      "PATH_INVALID",
      `${label} output path is not a directory: ${directory}`,
    );
  }

  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new FastifestError(
      "IO_FAILED",
      `Could not read ${label} output directory: ${directory}`,
      error,
    );
  }

  await rejectSymlinkComponents(directory, `${label} output directory`);
  let after: Stats;
  try {
    after = await lstat(directory);
  } catch (error) {
    throw new FastifestError(
      "IO_FAILED",
      `Output directory changed while being inspected: ${directory}`,
      error,
    );
  }
  if (
    after.isSymbolicLink() ||
    !after.isDirectory() ||
    !sameFile(info, after)
  ) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `Output directory changed while being inspected: ${directory}`,
    );
  }
  return { entries };
}

async function inspectReservedTarget(
  directory: string,
  filename: string,
  entries: readonly Dirent[],
  label: string,
): Promise<Stats | undefined> {
  const targetPath = join(directory, filename);
  await rejectSymlinkComponents(targetPath, `${label} output`);
  const exactEntry = entries.find((entry) => entry.name === filename);
  let info: Stats;
  try {
    info = await lstat(targetPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw new FastifestError(
      "IO_FAILED",
      `Could not inspect reserved ${label} output: ${targetPath}`,
      error,
    );
  }

  if (!exactEntry) {
    throw new FastifestError(
      "PATH_INVALID",
      `A differently-cased filesystem entry collides with reserved output ${targetPath}; refusing to overwrite an unowned file.`,
    );
  }
  if (info.isSymbolicLink()) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `Reserved ${label} output is a symlink or reparse point: ${targetPath}`,
    );
  }
  if (!info.isFile()) {
    throw new FastifestError(
      "PATH_INVALID",
      `Reserved ${label} output is not a regular file: ${targetPath}`,
    );
  }
  return info;
}

/** Inspect reserved outputs without modifying files; call before any asset or manifest write. */
export async function preflightManagedOutputs(
  config: ResolvedFastifestConfig,
  icons: readonly GeneratedLogoIcon[],
  screenshots: readonly GeneratedScreenshot[],
): Promise<ManagedOutputPlan> {
  validateConfigRoots(config);
  const assets = validateAssets(icons, screenshots);
  const iconsDirectory = resolve(config.iconsOutputPath);
  const screenshotsDirectory = resolve(config.screenshotsOutputPath);

  await rejectSymlinkComponents(config.publicRoot, "public root");
  await rejectSymlinkComponents(config.manifestPath, "manifest path");
  const [iconDirectory, screenshotDirectory] = await Promise.all([
    readOutputDirectory(iconsDirectory, "icon"),
    readOutputDirectory(screenshotsDirectory, "screenshot"),
  ]);

  const iconWrites: PlannedManagedAsset[] = [];
  const screenshotWrites: PlannedManagedAsset[] = [];
  const existingWriteTargets: string[] = [];

  for (const icon of assets.icons) {
    const exists = await inspectReservedTarget(
      iconsDirectory,
      icon.filename,
      iconDirectory.entries,
      "icon",
    );
    const path = join(iconsDirectory, icon.filename);
    if (exists) existingWriteTargets.push(path);
    iconWrites.push({ filename: icon.filename, path, buffer: icon.buffer });
  }
  for (const screenshot of assets.screenshots) {
    const exists = await inspectReservedTarget(
      screenshotsDirectory,
      screenshot.filename,
      screenshotDirectory.entries,
      "screenshot",
    );
    const path = join(screenshotsDirectory, screenshot.filename);
    if (exists) existingWriteTargets.push(path);
    screenshotWrites.push({
      filename: screenshot.filename,
      path,
      buffer: screenshot.buffer,
    });
  }

  const desiredScreenshotNames = new Set(
    assets.screenshots.map((image) => image.filename),
  );
  const staleScreenshotPaths: string[] = [];
  const staleScreenshotSnapshots = new Map<string, Stats>();
  for (const entry of screenshotDirectory.entries) {
    if (
      !SCREENSHOT_NAME.test(entry.name) ||
      desiredScreenshotNames.has(entry.name) ||
      (!entry.isFile() && !entry.isSymbolicLink())
    ) {
      continue;
    }
    const info = await inspectReservedTarget(
      screenshotsDirectory,
      entry.name,
      screenshotDirectory.entries,
      "stale screenshot",
    );
    if (info) {
      const path = join(screenshotsDirectory, entry.name);
      staleScreenshotPaths.push(path);
      staleScreenshotSnapshots.set(path, info);
    }
  }
  staleScreenshotPaths.sort((first, second) =>
    compareSourceBasenames(basename(first), basename(second)),
  );

  if (
    !config.overwrite &&
    (existingWriteTargets.length > 0 || staleScreenshotPaths.length > 0)
  ) {
    const conflicts = [...existingWriteTargets, ...staleScreenshotPaths];
    throw new FastifestError(
      "OUTPUT_CONFLICT",
      `Reserved Fastifest output already exists and overwrite is disabled: ${conflicts.join(", ")}`,
    );
  }

  return {
    overwrite: config.overwrite,
    iconsDirectory,
    screenshotsDirectory,
    iconWrites,
    screenshotWrites,
    staleScreenshotPaths,
    staleScreenshotSnapshots,
  };
}

/** Remove stale reserved screenshots only after the replacement manifest is committed. */
export async function removeStaleScreenshotsAfterManifestCommit(
  plan: ManagedOutputPlan,
  logger: Logger = createLogger("info"),
): Promise<string[]> {
  const warnings: string[] = [];
  const desiredNames = new Set(
    plan.screenshotWrites.map((screenshot) => screenshot.filename),
  );
  for (const stalePath of plan.staleScreenshotPaths) {
    const filename = basename(stalePath);
    const warn = (message: string): void => {
      warnings.push(message);
      logger.warn(message);
    };

    if (
      dirname(resolve(stalePath)) !== resolve(plan.screenshotsDirectory) ||
      !SCREENSHOT_NAME.test(filename) ||
      desiredNames.has(filename)
    ) {
      warn(
        `Refused to remove an unrecognized stale screenshot path: ${stalePath}`,
      );
      continue;
    }

    const snapshot = plan.staleScreenshotSnapshots.get(stalePath);
    if (!snapshot) {
      warn(
        `Refused to remove a stale screenshot without a preflight snapshot: ${stalePath}`,
      );
      continue;
    }

    try {
      await rejectSymlinkComponents(stalePath, "stale screenshot output");
      const before = await lstat(stalePath);
      if (before.isSymbolicLink() || !before.isFile()) {
        warn(`Left stale screenshot that is not a regular file: ${stalePath}`);
        continue;
      }
      if (!unchangedFile(snapshot, before)) {
        warn(
          `Left stale screenshot that changed after preflight: ${stalePath}`,
        );
        continue;
      }
      await rejectSymlinkComponents(stalePath, "stale screenshot output");
      const current = await lstat(stalePath);
      if (
        current.isSymbolicLink() ||
        !current.isFile() ||
        !unchangedFile(snapshot, current)
      ) {
        warn(`Left stale screenshot that changed during cleanup: ${stalePath}`);
        continue;
      }
      await unlink(stalePath);
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      warn(
        `Could not remove stale managed screenshot ${stalePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return warnings;
}
