import { constants, type Stats } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  rename,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
import type { GeneratedLogoIcon } from "../images/logo.js";
import type { GeneratedScreenshot } from "../images/screenshots.js";
import { buildManifest, type BuiltManifest } from "../manifest/build.js";
import type { ResolvedFastifestConfig } from "../types.js";
import {
  preflightManagedOutputs,
  removeStaleScreenshotsAfterManifestCommit,
  type ManagedOutputPlan,
} from "./managed.js";

/** Rename operation seam for deterministic commit-failure tests. */
export interface GenerationFileOperations {
  rename(source: string, destination: string): Promise<void>;
  /** @internal Atomic no-replace install seam for overwrite-disabled tests. */
  link?(source: string, destination: string): Promise<void>;
}

export interface CommitGenerationOptions {
  logger?: Logger;
  /** @internal Used to test rollback behavior without relying on filesystem races. */
  fileOperations?: GenerationFileOperations;
}

export interface CommittedGeneration extends BuiltManifest {
  warnings: string[];
}

interface StagedFile {
  path: string;
  targetPath: string;
  info: Stats;
}

interface ReplacementRecord {
  targetPath: string;
  stagedInfo: Stats;
  previousInfo?: Stats;
  installed: boolean;
  backupPath?: string;
  backupInfo?: Stats;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

function sameFile(first: Stats, second: Stats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

// Link and rename operations can change ctime themselves; use this check across those operations.
function sameFileContents(first: Stats, second: Stats): boolean {
  return (
    sameFile(first, second) &&
    first.size === second.size &&
    first.mtimeMs === second.mtimeMs
  );
}

function unchangedFile(first: Stats, second: Stats): boolean {
  return sameFileContents(first, second) && first.ctimeMs === second.ctimeMs;
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

async function inspectDirectory(
  directory: string,
  label: string,
): Promise<boolean> {
  await rejectSymlinkComponents(directory, label);
  let info: Stats;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    if (errorCode(error) === "ENOTDIR") {
      throw new FastifestError(
        "PATH_INVALID",
        `${label} is not a directory: ${directory}`,
        error,
      );
    }
    throw new FastifestError(
      "IO_FAILED",
      `Could not inspect ${label}: ${directory}`,
      error,
    );
  }
  if (info.isSymbolicLink()) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `${label} is a symlink or reparse point: ${directory}`,
    );
  }
  if (!info.isDirectory()) {
    throw new FastifestError(
      "PATH_INVALID",
      `${label} is not a directory: ${directory}`,
    );
  }
  return true;
}

async function inspectRegularFile(
  path: string,
  label: string,
): Promise<Stats | undefined> {
  await rejectSymlinkComponents(path, label);
  let info: Stats;
  try {
    info = await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw new FastifestError(
      "IO_FAILED",
      `Could not inspect ${label}: ${path}`,
      error,
    );
  }
  if (info.isSymbolicLink()) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `${label} is a symlink or reparse point: ${path}`,
    );
  }
  if (!info.isFile()) {
    throw new FastifestError(
      "PATH_INVALID",
      `${label} is not a regular file: ${path}`,
    );
  }
  return info;
}

async function verifyGeneratedReferences(
  builtManifest: BuiltManifest,
  publicRoot: string,
  stagedAssets: readonly StagedFile[],
): Promise<void> {
  const entries: unknown[] = [];
  for (const member of ["icons", "screenshots"] as const) {
    const value = builtManifest.value[member];
    if (value === undefined && member === "screenshots") continue;
    if (!Array.isArray(value)) {
      throw new FastifestError(
        "PATH_INVALID",
        `Generated manifest ${member} references are missing or invalid.`,
      );
    }
    entries.push(...value);
  }

  const stagedByTarget = new Map(
    stagedAssets.map((asset) => [resolve(asset.targetPath), asset]),
  );
  const referencedTargets = new Set<string>();
  const referenceBase = new URL("https://fastifest.invalid/manifest.json");

  for (const entry of entries) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("src" in entry) ||
      typeof entry.src !== "string"
    ) {
      throw new FastifestError(
        "PATH_INVALID",
        "Generated manifest contains an invalid asset reference.",
      );
    }

    let reference: URL;
    try {
      reference = new URL(entry.src, referenceBase);
    } catch (error) {
      throw new FastifestError(
        "PATH_INVALID",
        `Generated manifest asset reference is not a valid URL: ${entry.src}`,
        error,
      );
    }
    if (reference.origin !== referenceBase.origin) {
      throw new FastifestError(
        "UNSAFE_PATH",
        `Generated manifest asset reference is not contained in the public root: ${entry.src}`,
      );
    }

    let target: string;
    try {
      const segments = reference.pathname
        .slice(1)
        .split("/")
        .map((segment) => decodeURIComponent(segment));
      target = resolve(publicRoot, ...segments);
    } catch (error) {
      throw new FastifestError(
        "PATH_INVALID",
        `Generated manifest asset reference has an invalid path: ${entry.src}`,
        error,
      );
    }
    if (!isWithin(publicRoot, target)) {
      throw new FastifestError(
        "UNSAFE_PATH",
        `Generated manifest asset reference is outside the public root: ${entry.src}`,
      );
    }

    const staged = stagedByTarget.get(target);
    if (!staged) {
      throw new FastifestError(
        "PATH_INVALID",
        `Generated manifest asset reference does not point to a planned output: ${entry.src}`,
      );
    }
    if (referencedTargets.has(target)) {
      throw new FastifestError(
        "PATH_INVALID",
        `Generated manifest contains a duplicate asset reference: ${entry.src}`,
      );
    }
    referencedTargets.add(target);

    await rejectSymlinkComponents(target, "Installed generated asset");
    let installed: Stats;
    try {
      installed = await lstat(target);
    } catch (error) {
      throw new FastifestError(
        "IO_FAILED",
        `Generated manifest asset is not installed before manifest commit: ${target}`,
        error,
      );
    }
    if (
      installed.isSymbolicLink() ||
      !installed.isFile() ||
      !unchangedFile(installed, staged.info)
    ) {
      throw new FastifestError(
        "UNSAFE_PATH",
        `Generated manifest asset is not the installed regular output file: ${target}`,
      );
    }
  }

  if (referencedTargets.size !== stagedAssets.length) {
    throw new FastifestError(
      "PATH_INVALID",
      "Generated manifest references do not match the complete set of planned assets.",
    );
  }
}

async function assertFileTargetsAvailable(
  plan: ManagedOutputPlan,
  manifestPath: string,
): Promise<void> {
  for (const write of [...plan.iconWrites, ...plan.screenshotWrites]) {
    const existing = await inspectRegularFile(
      write.path,
      "Reserved generated output",
    );
    if (existing && !plan.overwrite) {
      throw new FastifestError(
        "OUTPUT_CONFLICT",
        `Reserved Fastifest output appeared after preflight and overwrite is disabled: ${write.path}`,
      );
    }
  }
  await inspectRegularFile(manifestPath, "Manifest output");
}

async function ensureOutputDirectories(
  config: ResolvedFastifestConfig,
  plan: ManagedOutputPlan,
): Promise<void> {
  const publicRoot = resolve(config.publicRoot);
  const directories = [
    [publicRoot, "public root"],
    [plan.iconsDirectory, "icon output directory"],
    [plan.screenshotsDirectory, "screenshot output directory"],
  ] as const;

  for (const [directory, label] of directories) {
    await inspectDirectory(directory, label);
  }
  try {
    await mkdir(publicRoot, { recursive: true });
    await mkdir(plan.iconsDirectory, { recursive: true });
    await mkdir(plan.screenshotsDirectory, { recursive: true });
  } catch (error) {
    throw new FastifestError(
      "IO_FAILED",
      "Could not create managed output directories.",
      error,
    );
  }
  for (const [directory, label] of directories) {
    if (!(await inspectDirectory(directory, label))) {
      throw new FastifestError(
        "IO_FAILED",
        `Could not create ${label}: ${directory}`,
      );
    }
  }
}

async function createUniqueSiblingPath(
  targetPath: string,
  purpose: "stage" | "backup",
): Promise<string> {
  const directory = dirname(targetPath);
  const filename = basename(targetPath);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = join(
      directory,
      `.${filename}.fastifest-${purpose}-${randomUUID()}.${purpose === "stage" ? "tmp" : "bak"}`,
    );
    try {
      await lstat(candidate);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return candidate;
      throw new FastifestError(
        "IO_FAILED",
        `Could not inspect temporary path: ${candidate}`,
        error,
      );
    }
  }
  throw new FastifestError(
    "IO_FAILED",
    `Could not allocate a unique temporary path beside ${targetPath}.`,
  );
}

async function stageFile(
  targetPath: string,
  data: Buffer | string,
  stagedFiles: StagedFile[],
): Promise<StagedFile> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await rejectSymlinkComponents(dirname(targetPath), "staging directory");
    const path = await createUniqueSiblingPath(targetPath, "stage");
    let handle;
    try {
      handle = await open(path, "wx", 0o666);
    } catch (error) {
      if (errorCode(error) === "EEXIST") continue;
      throw new FastifestError(
        "IO_FAILED",
        `Could not stage generated file: ${targetPath}`,
        error,
      );
    }
    let stagedFile: StagedFile;
    try {
      const info = await handle.stat();
      if (!info.isFile()) {
        throw new FastifestError(
          "UNSAFE_PATH",
          `Staged output is not a regular file: ${path}`,
        );
      }
      stagedFile = { path, targetPath, info };
      stagedFiles.push(stagedFile);
      await handle.writeFile(data);
      await handle.sync();
      stagedFile.info = await handle.stat();
    } catch (error) {
      if (error instanceof FastifestError) throw error;
      throw new FastifestError(
        "IO_FAILED",
        `Could not write staged file: ${targetPath}`,
        error,
      );
    } finally {
      await handle.close();
    }

    const current = await lstat(path);
    if (
      current.isSymbolicLink() ||
      !current.isFile() ||
      !unchangedFile(current, stagedFile.info)
    ) {
      throw new FastifestError(
        "UNSAFE_PATH",
        `Staged output changed unexpectedly: ${path}`,
      );
    }
    return stagedFile;
  }
  throw new FastifestError(
    "IO_FAILED",
    `Could not allocate a staging file beside ${targetPath}.`,
  );
}

async function createBackupFile(
  targetPath: string,
): Promise<{ path: string; info: Stats }> {
  const backupPath = await createUniqueSiblingPath(targetPath, "backup");
  await rejectSymlinkComponents(targetPath, "backup source");
  try {
    await link(targetPath, backupPath);
  } catch (linkError) {
    if (errorCode(linkError) === "EEXIST") {
      throw new FastifestError(
        "IO_FAILED",
        `Backup path unexpectedly exists: ${backupPath}`,
        linkError,
      );
    }
    try {
      await copyFile(targetPath, backupPath, constants.COPYFILE_EXCL);
    } catch (copyError) {
      throw new FastifestError(
        "IO_FAILED",
        `Could not preserve existing output before replacement: ${targetPath}`,
        new AggregateError(
          [linkError, copyError],
          "Both hard-link and copy backups failed.",
        ),
      );
    }
  }
  const info = await lstat(backupPath);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `Transaction backup is not a regular file: ${backupPath}`,
    );
  }
  return { path: backupPath, info };
}

async function replaceFile(
  staged: StagedFile,
  overwrite: boolean,
  journal: ReplacementRecord[],
  renameFile: GenerationFileOperations["rename"],
  linkFile: NonNullable<GenerationFileOperations["link"]>,
): Promise<void> {
  await rejectSymlinkComponents(staged.path, "Staged output");
  const stagedNow = await lstat(staged.path);
  if (
    stagedNow.isSymbolicLink() ||
    !stagedNow.isFile() ||
    !unchangedFile(stagedNow, staged.info)
  ) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `Staged output changed before commit: ${staged.path}`,
    );
  }

  const previousInfo = await inspectRegularFile(
    staged.targetPath,
    "Generated output",
  );
  if (previousInfo && !overwrite) {
    throw new FastifestError(
      "OUTPUT_CONFLICT",
      `Reserved Fastifest output appeared during commit and overwrite is disabled: ${staged.targetPath}`,
    );
  }

  if (!overwrite) {
    await rejectSymlinkComponents(staged.targetPath, "Generated output");
    try {
      await linkFile(staged.path, staged.targetPath);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw new FastifestError(
          "OUTPUT_CONFLICT",
          `Reserved Fastifest output appeared during commit and overwrite is disabled: ${staged.targetPath}`,
          error,
        );
      }
      throw new FastifestError(
        "IO_FAILED",
        `Could not install generated output without overwrite: ${staged.targetPath}`,
        error,
      );
    }

    const record: ReplacementRecord = {
      targetPath: staged.targetPath,
      stagedInfo: staged.info,
      installed: true,
    };
    journal.push(record);
    const installedInfo = await lstat(staged.targetPath);
    if (
      installedInfo.isSymbolicLink() ||
      !installedInfo.isFile() ||
      !sameFileContents(installedInfo, staged.info)
    ) {
      throw new FastifestError(
        "UNSAFE_PATH",
        `Committed output changed unexpectedly: ${staged.targetPath}`,
      );
    }
    record.stagedInfo = installedInfo;
    staged.info = installedInfo;
    await removeOwnedFile(staged.path, installedInfo, "staged output");
    const finalInfo = await lstat(staged.targetPath);
    if (!sameFileContents(finalInfo, installedInfo)) {
      throw new FastifestError(
        "UNSAFE_PATH",
        `Committed output changed unexpectedly: ${staged.targetPath}`,
      );
    }
    record.stagedInfo = finalInfo;
    staged.info = finalInfo;
    return;
  }

  const record: ReplacementRecord = {
    targetPath: staged.targetPath,
    stagedInfo: staged.info,
    installed: false,
    ...(previousInfo === undefined ? {} : { previousInfo }),
  };
  journal.push(record);
  if (previousInfo) {
    const backup = await createBackupFile(staged.targetPath);
    record.backupPath = backup.path;
    record.backupInfo = backup.info;
  }
  await renameFile(staged.path, staged.targetPath);
  record.installed = true;
  const installedInfo = await lstat(staged.targetPath);
  if (
    installedInfo.isSymbolicLink() ||
    !installedInfo.isFile() ||
    !sameFileContents(installedInfo, staged.info)
  ) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `Committed output changed unexpectedly: ${staged.targetPath}`,
    );
  }
  record.stagedInfo = installedInfo;
  staged.info = installedInfo;
}

async function statIfExists(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function rollback(
  journal: readonly ReplacementRecord[],
  renameFile: GenerationFileOperations["rename"],
): Promise<Error[]> {
  const failures: Error[] = [];
  for (const record of [...journal].reverse()) {
    try {
      await rejectSymlinkComponents(record.targetPath, "rollback target");
      const current = await statIfExists(record.targetPath);
      let backupInfo: Stats | undefined;
      if (record.backupPath) {
        await rejectSymlinkComponents(record.backupPath, "rollback backup");
        backupInfo = await statIfExists(record.backupPath);
        if (
          !backupInfo ||
          backupInfo.isSymbolicLink() ||
          !backupInfo.isFile() ||
          !record.backupInfo ||
          !sameFile(backupInfo, record.backupInfo)
        ) {
          throw new Error(
            `Transaction backup is missing or changed: ${record.backupPath}`,
          );
        }
      }

      if (record.installed) {
        if (
          current &&
          (current.isSymbolicLink() ||
            !current.isFile() ||
            !unchangedFile(current, record.stagedInfo))
        ) {
          throw new Error(
            `Refusing to replace changed transaction output: ${record.targetPath}${record.backupPath ? `; previous output backup preserved at ${record.backupPath}` : ""}`,
          );
        }
        if (record.backupPath) {
          await rejectSymlinkComponents(record.backupPath, "rollback backup");
          await rejectSymlinkComponents(record.targetPath, "rollback target");
          const backupNow = await statIfExists(record.backupPath);
          if (
            !backupNow ||
            !record.backupInfo ||
            !sameFile(backupNow, record.backupInfo)
          ) {
            throw new Error(
              `Transaction backup changed during rollback: ${record.backupPath}`,
            );
          }
          await renameFile(record.backupPath, record.targetPath);
        } else if (current) {
          await rejectSymlinkComponents(record.targetPath, "rollback target");
          const verify = await statIfExists(record.targetPath);
          if (!verify || !unchangedFile(verify, record.stagedInfo)) {
            throw new Error(
              `Transaction output changed during rollback: ${record.targetPath}`,
            );
          }
          await unlink(record.targetPath);
        }
      } else if (record.backupPath) {
        if (
          current &&
          record.previousInfo &&
          !current.isSymbolicLink() &&
          sameFile(current, record.previousInfo)
        ) {
          await removeOwnedFile(
            record.backupPath,
            backupInfo!,
            "unused rollback backup",
          );
        } else if (!current) {
          await rejectSymlinkComponents(record.backupPath, "rollback backup");
          await rejectSymlinkComponents(record.targetPath, "rollback target");
          await renameFile(record.backupPath, record.targetPath);
        } else {
          throw new Error(
            `Refusing to replace changed transaction output: ${record.targetPath}; previous output backup preserved at ${record.backupPath}`,
          );
        }
      } else if (current) {
        if (
          !record.previousInfo ||
          current.isSymbolicLink() ||
          !sameFile(current, record.previousInfo)
        ) {
          throw new Error(
            `Refusing to remove changed transaction output: ${record.targetPath}`,
          );
        }
      }
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  return failures;
}

async function removeOwnedFile(
  path: string,
  expected: Stats,
  label: string,
): Promise<void> {
  await rejectSymlinkComponents(path, label);
  const current = await statIfExists(path);
  if (!current) return;
  if (
    current.isSymbolicLink() ||
    !current.isFile() ||
    !sameFileContents(current, expected)
  ) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `Refusing to remove changed ${label}: ${path}`,
    );
  }
  await rejectSymlinkComponents(path, label);
  const verify = await statIfExists(path);
  if (
    !verify ||
    verify.isSymbolicLink() ||
    !verify.isFile() ||
    !sameFileContents(verify, expected)
  ) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `Refusing to remove changed ${label}: ${path}`,
    );
  }
  await unlink(path);
}

async function cleanupStagedFiles(
  staged: readonly StagedFile[],
  logger: Logger,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const file of staged) {
    try {
      await removeOwnedFile(file.path, file.info, "staged file");
    } catch (error) {
      const warning = `Could not remove temporary Fastifest file ${file.path}: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(warning);
      logger.warn(warning);
    }
  }
  return warnings;
}

async function cleanupBackups(
  journal: readonly ReplacementRecord[],
  logger: Logger,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const record of journal) {
    if (!record.backupPath || !record.backupInfo) continue;
    try {
      await removeOwnedFile(
        record.backupPath,
        record.backupInfo,
        "backup file",
      );
    } catch (error) {
      const warning = `Could not remove committed backup ${record.backupPath}: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(warning);
      logger.warn(warning);
    }
  }
  return warnings;
}

function validatePlanPaths(
  config: ResolvedFastifestConfig,
  plan: ManagedOutputPlan,
): void {
  const iconsDirectory = resolve(config.iconsOutputPath);
  const screenshotsDirectory = resolve(config.screenshotsOutputPath);
  if (
    plan.iconsDirectory !== iconsDirectory ||
    plan.screenshotsDirectory !== screenshotsDirectory
  ) {
    throw new FastifestError(
      "PATH_INVALID",
      "Managed output plan paths do not match the resolved configuration.",
    );
  }
  const allWrites = [...plan.iconWrites, ...plan.screenshotWrites];
  const seen = new Set<string>();
  for (const write of allWrites) {
    const expectedDirectory = plan.iconWrites.includes(write)
      ? iconsDirectory
      : screenshotsDirectory;
    if (
      write.path !== join(expectedDirectory, write.filename) ||
      seen.has(write.path) ||
      !Buffer.isBuffer(write.buffer) ||
      write.buffer.length === 0
    ) {
      throw new FastifestError(
        "PATH_INVALID",
        `Invalid managed output plan target: ${write.path}`,
      );
    }
    seen.add(write.path);
  }
}

/**
 * Preflight, stage, and commit generated assets with manifest.json as the commit point.
 * The manifest is replaced last; stale screenshots are cleaned only after that succeeds.
 */
export async function commitGeneration(
  config: ResolvedFastifestConfig,
  template: unknown,
  icons: readonly GeneratedLogoIcon[],
  screenshots: readonly GeneratedScreenshot[],
  options: CommitGenerationOptions = {},
): Promise<CommittedGeneration> {
  const logger = options.logger ?? createLogger(config.logLevel);
  const plan = await preflightManagedOutputs(config, icons, screenshots);
  const builtManifest = buildManifest(config, template, icons, screenshots, {
    logger,
  });
  const manifestPath = resolve(config.manifestPath);
  if (builtManifest.manifestPath !== manifestPath) {
    throw new FastifestError(
      "PATH_INVALID",
      "Built manifest target does not match config.paths.manifest.",
    );
  }
  validatePlanPaths(config, plan);
  const renameFile = options.fileOperations?.rename ?? rename;
  const linkFile = options.fileOperations?.link ?? link;
  const staged: StagedFile[] = [];
  const journal: ReplacementRecord[] = [];
  let stagedCleanupWarnings: string[] = [];
  let manifestCommitted = false;

  try {
    await inspectRegularFile(manifestPath, "Manifest output");
    await ensureOutputDirectories(config, plan);
    await assertFileTargetsAvailable(plan, manifestPath);

    const stagedAssets: StagedFile[] = [];
    for (const write of [...plan.iconWrites, ...plan.screenshotWrites]) {
      stagedAssets.push(await stageFile(write.path, write.buffer, staged));
    }
    const stagedManifest = await stageFile(
      manifestPath,
      builtManifest.json,
      staged,
    );

    for (const stagedFile of stagedAssets) {
      await replaceFile(
        stagedFile,
        plan.overwrite,
        journal,
        renameFile,
        linkFile,
      );
    }
    await verifyGeneratedReferences(
      builtManifest,
      resolve(config.publicRoot),
      stagedAssets,
    );
    await replaceFile(stagedManifest, true, journal, renameFile, linkFile);
    manifestCommitted = true;
  } catch (error) {
    const rollbackErrors = await rollback(journal, renameFile);
    if (
      rollbackErrors.length === 0 &&
      error instanceof FastifestError &&
      error.code !== "IO_FAILED"
    ) {
      throw error;
    }
    const cause =
      rollbackErrors.length > 0
        ? new AggregateError(
            [error, ...rollbackErrors],
            "Generation commit and rollback failed.",
          )
        : error;
    const detail =
      rollbackErrors.length > 0
        ? `Generation commit failed and rollback was incomplete: ${rollbackErrors.map((item) => item.message).join("; ")}`
        : "Generation commit failed; previous output files were restored where necessary.";
    throw new FastifestError("IO_FAILED", detail, cause);
  } finally {
    stagedCleanupWarnings = await cleanupStagedFiles(staged, logger);
  }

  if (!manifestCommitted) {
    throw new FastifestError(
      "IO_FAILED",
      "Manifest transaction did not reach its commit point.",
    );
  }

  const warnings = [...builtManifest.warnings, ...stagedCleanupWarnings];
  warnings.push(...(await cleanupBackups(journal, logger)));
  warnings.push(
    ...(await removeStaleScreenshotsAfterManifestCommit(plan, logger)),
  );
  return { ...builtManifest, warnings };
}
