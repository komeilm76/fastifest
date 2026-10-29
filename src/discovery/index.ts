import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { extname, join, parse, relative, resolve, sep } from "node:path";
import sharp, { type Metadata } from "sharp";
import { FastifestError } from "../errors.js";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";
import type { ResolvedFastifestConfig, ScreenshotMetadata } from "../types.js";
import {
  MAX_RASTER_FILE_BYTES,
  MAX_RASTER_PIXELS,
  MAX_RASTER_SIDE,
  MAX_SVG_FILE_BYTES,
} from "./limits.js";

export type DiscoveredImageFormat = "png" | "jpeg" | "svg";
export type DiscoveredImageKind = "logo" | "screenshot";

/** Validated source image details. The source is read again through the safe reader when processed. */
export interface DiscoveredImage {
  sourcePath: string;
  basename: string;
  normalizedBasename: string;
  extension: string;
  format: DiscoveredImageFormat;
  sizeBytes: number;
  contentHash: string;
  width?: number;
  height?: number;
  orientation?: number;
  annotation?: ScreenshotMetadata;
}

/** Inputs selected and validated for one generation run. */
export interface DiscoveredInputs {
  logo: DiscoveredImage;
  screenshots: DiscoveredImage[];
  warnings: string[];
}

export interface DiscoverInputsOptions {
  /** Receives concise warnings. Defaults to the configured log threshold. */
  logger?: Logger;
}

interface Candidate {
  basename: string;
  sourcePath: string;
  extension: string;
  expectedFormat: DiscoveredImageFormat;
}

interface ListedDirectory {
  candidates: Candidate[];
}

const LOGO_FORMATS: Readonly<Record<string, DiscoveredImageFormat>> = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".svg": "svg",
};
const SCREENSHOT_FORMATS: Readonly<Record<string, DiscoveredImageFormat>> = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
};
const READ_CHUNK_BYTES = 64 * 1024;

function codePointCompare(first: string, second: string): number {
  const firstPoints = Array.from(first, (character) =>
    character.codePointAt(0)!,
  );
  const secondPoints = Array.from(second, (character) =>
    character.codePointAt(0)!,
  );
  const sharedLength = Math.min(firstPoints.length, secondPoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const difference = firstPoints[index]! - secondPoints[index]!;
    if (difference !== 0) return difference;
  }
  return firstPoints.length - secondPoints.length;
}

/** Locale-independent ordering, with raw-name tie-breaking for canonically equivalent names. */
export function compareSourceBasenames(first: string, second: string): number {
  const firstNormalized = first.normalize("NFC");
  const secondNormalized = second.normalize("NFC");
  const lowerComparison = codePointCompare(
    firstNormalized.toLowerCase(),
    secondNormalized.toLowerCase(),
  );
  if (lowerComparison !== 0) return lowerComparison;

  const normalizedComparison = codePointCompare(
    firstNormalized,
    secondNormalized,
  );
  if (normalizedComparison !== 0) return normalizedComparison;
  return codePointCompare(first, second);
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

function isSafeEmbeddedReference(value: string): boolean {
  const reference = value.trim();
  return (
    reference.startsWith("#") ||
    /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(reference)
  );
}

function decodeNumericCharacterReferences(value: string): string {
  return value.replace(
    /&#(?:x([\da-f]+)|(\d+));/gi,
    (_match, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
      return !Number.isFinite(codePoint) ||
        codePoint === 0 ||
        codePoint > 0x10ffff
        ? "\uFFFD"
        : String.fromCodePoint(codePoint);
    },
  );
}

/** Decode CSS escapes so obfuscated url() and @import tokens cannot bypass checks. */
function normalizeCssForReferenceScan(source: string): string {
  return decodeNumericCharacterReferences(source)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(
      /\\(?:\r\n|[\n\r\f])|\\([\da-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\r\n\f])/gi,
      (_match, hex: string | undefined, escaped: string | undefined) => {
        if (hex !== undefined) {
          const codePoint = Number.parseInt(hex, 16);
          return codePoint === 0 || codePoint > 0x10ffff
            ? "\uFFFD"
            : String.fromCodePoint(codePoint);
        }
        return escaped ?? "";
      },
    );
}

const EMBEDDED_IMAGE_MIME_FORMAT = {
  png: "png",
  jpeg: "jpeg",
  gif: "gif",
  webp: "webp",
} as const;

async function validateEmbeddedImageReference(
  sourcePath: string,
  reference: string,
  alreadyValidated: Set<string>,
): Promise<void> {
  const normalized = decodeNumericCharacterReferences(reference).trim();
  if (!/^data:image\//i.test(normalized) || alreadyValidated.has(normalized)) {
    return;
  }

  const match = /^data:image\/(png|jpeg|gif|webp);base64,([\s\S]*)$/i.exec(
    normalized,
  );
  if (!match) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `SVG input contains malformed embedded image data: ${sourcePath}`,
    );
  }

  const mimeSubtype =
    match[1]!.toLowerCase() as keyof typeof EMBEDDED_IMAGE_MIME_FORMAT;
  const base64 = match[2]!.replace(/\s/g, "");
  if (
    base64.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  ) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `SVG input contains malformed embedded image data: ${sourcePath}`,
    );
  }

  const embeddedBytes = Buffer.from(base64, "base64");
  if (embeddedBytes.byteLength > MAX_RASTER_FILE_BYTES) {
    throw new FastifestError(
      "INPUT_LIMIT",
      `Embedded raster input exceeds the ${MAX_RASTER_FILE_BYTES}-byte limit: ${sourcePath}`,
    );
  }

  const imageOptions = {
    failOn: "warning" as const,
    limitInputPixels: MAX_RASTER_PIXELS,
  };
  let metadata: Metadata;
  try {
    metadata = await sharp(embeddedBytes, { failOn: "warning" }).metadata();
  } catch (error) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `Could not decode embedded raster image in SVG: ${sourcePath}`,
      error,
    );
  }

  if (metadata.format !== EMBEDDED_IMAGE_MIME_FORMAT[mimeSubtype]) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `Embedded image MIME type does not match its data: ${sourcePath}`,
    );
  }

  const { width, height } = metadata;
  if (
    width === undefined ||
    height === undefined ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `Embedded raster image has invalid dimensions: ${sourcePath}`,
    );
  }
  if (width > MAX_RASTER_SIDE || height > MAX_RASTER_SIDE) {
    throw new FastifestError(
      "INPUT_LIMIT",
      `Embedded raster image exceeds the ${MAX_RASTER_SIDE}-pixel maximum side (${width}x${height}): ${sourcePath}`,
    );
  }
  if (width * height > MAX_RASTER_PIXELS) {
    throw new FastifestError(
      "INPUT_LIMIT",
      `Embedded raster image exceeds the ${MAX_RASTER_PIXELS}-pixel limit (${width}x${height}): ${sourcePath}`,
    );
  }

  try {
    await sharp(embeddedBytes, imageOptions)
      .resize({ width: 1, height: 1, fit: "fill" })
      .raw()
      .toBuffer();
  } catch (error) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `Could not fully decode embedded raster image in SVG: ${sourcePath}`,
      error,
    );
  }
  alreadyValidated.add(normalized);
}

async function validateSvgReferences(
  sourcePath: string,
  bytes: Buffer,
): Promise<void> {
  const source = bytes.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(bytes)) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `SVG input must be valid UTF-8: ${sourcePath}`,
    );
  }

  const cssSource = normalizeCssForReferenceScan(source);
  if (
    /<!\s*(?:doctype|entity)\b/i.test(source) ||
    /<\?xml-stylesheet\b/i.test(source) ||
    /@import\b/i.test(cssSource)
  ) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `SVG input contains a prohibited external-resource or entity declaration: ${sourcePath}`,
    );
  }

  const alreadyValidated = new Set<string>();
  const attributeReferences = /\b(?:href|src)\s*=\s*(["'])([\s\S]*?)\1/gi;
  for (const match of source.matchAll(attributeReferences)) {
    const reference = match[2] ?? "";
    if (!isSafeEmbeddedReference(reference)) {
      throw new FastifestError(
        "IMAGE_INVALID",
        `SVG input contains an external resource reference: ${sourcePath}`,
      );
    }
    await validateEmbeddedImageReference(
      sourcePath,
      reference,
      alreadyValidated,
    );
  }

  const cssReferences = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^)]*))\s*\)/gi;
  for (const match of cssSource.matchAll(cssReferences)) {
    const reference = match[1] ?? match[2] ?? match[3] ?? "";
    if (!isSafeEmbeddedReference(reference)) {
      throw new FastifestError(
        "IMAGE_INVALID",
        `SVG input contains an external CSS resource reference: ${sourcePath}`,
      );
    }
    await validateEmbeddedImageReference(
      sourcePath,
      reference,
      alreadyValidated,
    );
  }
}

async function readBoundedFile(
  sourcePath: string,
  maximumBytes: number,
): Promise<Buffer> {
  await rejectSymlinkComponents(sourcePath, "input file");
  let before: Stats;
  try {
    before = await lstat(sourcePath);
  } catch (error) {
    throw new FastifestError(
      "IO_FAILED",
      `Could not inspect input file: ${sourcePath}`,
      error,
    );
  }

  if (before.isSymbolicLink()) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `Input file is a symlink or reparse point: ${sourcePath}`,
    );
  }
  if (!before.isFile()) {
    throw new FastifestError(
      "INPUT_INVALID",
      `Input is not a regular file: ${sourcePath}`,
    );
  }
  if (before.size > maximumBytes) {
    throw new FastifestError(
      "INPUT_LIMIT",
      `Input exceeds the ${maximumBytes}-byte size limit: ${sourcePath} (${before.size} bytes).`,
    );
  }

  await rejectSymlinkComponents(sourcePath, "input file");
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const nonBlock = constants.O_NONBLOCK ?? 0;
  let fileHandle;
  try {
    fileHandle = await open(
      sourcePath,
      constants.O_RDONLY | noFollow | nonBlock,
    );
  } catch (error) {
    if (errorCode(error) === "ELOOP") {
      throw new FastifestError(
        "UNSAFE_PATH",
        `Input file became a symlink or reparse point: ${sourcePath}`,
        error,
      );
    }
    throw new FastifestError(
      "IO_FAILED",
      `Could not open input file: ${sourcePath}`,
      error,
    );
  }

  try {
    const opened = await fileHandle.stat();
    if (!opened.isFile() || !sameFile(before, opened)) {
      throw new FastifestError(
        "UNSAFE_PATH",
        `Input file changed while it was being opened: ${sourcePath}`,
      );
    }
    if (opened.size > maximumBytes) {
      throw new FastifestError(
        "INPUT_LIMIT",
        `Input exceeds the ${maximumBytes}-byte size limit: ${sourcePath} (${opened.size} bytes).`,
      );
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= maximumBytes) {
      const remaining = maximumBytes + 1 - totalBytes;
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
      const { bytesRead } = await fileHandle.read(
        chunk,
        0,
        chunk.length,
        totalBytes,
      );
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maximumBytes) {
        throw new FastifestError(
          "INPUT_LIMIT",
          `Input exceeds the ${maximumBytes}-byte size limit: ${sourcePath}.`,
        );
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }

    const after = await fileHandle.stat();
    await rejectSymlinkComponents(sourcePath, "input file");
    let namedAfter: Stats;
    try {
      namedAfter = await lstat(sourcePath);
    } catch (error) {
      throw new FastifestError(
        "INPUT_INVALID",
        `Input file changed while it was being read: ${sourcePath}`,
        error,
      );
    }
    if (
      namedAfter.isSymbolicLink() ||
      !sameFile(opened, after) ||
      !sameFile(opened, namedAfter) ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs ||
      totalBytes !== after.size
    ) {
      throw new FastifestError(
        "INPUT_INVALID",
        `Input file changed while it was being read: ${sourcePath}`,
      );
    }
    return Buffer.concat(chunks, totalBytes);
  } catch (error) {
    if (error instanceof FastifestError) throw error;
    throw new FastifestError(
      "IO_FAILED",
      `Could not safely read input file: ${sourcePath}`,
      error,
    );
  } finally {
    await fileHandle.close().catch(() => {});
  }
}

/** Re-read a discovered source with the same symlink and byte-limit protections. */
export async function readDiscoveredImage(
  image: DiscoveredImage,
): Promise<Buffer> {
  const maximumBytes =
    image.format === "svg" ? MAX_SVG_FILE_BYTES : MAX_RASTER_FILE_BYTES;
  const bytes = await readBoundedFile(image.sourcePath, maximumBytes);
  if (
    bytes.byteLength !== image.sizeBytes ||
    createHash("sha256").update(bytes).digest("hex") !== image.contentHash
  ) {
    throw new FastifestError(
      "INPUT_INVALID",
      `Input file changed after discovery: ${image.sourcePath}`,
    );
  }
  if (image.format === "svg") {
    await validateSvgReferences(image.sourcePath, bytes);
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { failOn: "warning" }).metadata();
  } catch (error) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `Could not revalidate discovered image: ${image.sourcePath}`,
      error,
    );
  }
  if (
    metadata.format !== image.format ||
    metadata.width !== image.width ||
    metadata.height !== image.height ||
    metadata.orientation !== image.orientation
  ) {
    throw new FastifestError(
      "INPUT_INVALID",
      `Input image metadata changed after discovery: ${image.sourcePath}`,
    );
  }
  return bytes;
}

async function listCandidates(
  directory: string,
  kind: DiscoveredImageKind,
  warn: (message: string) => void,
): Promise<ListedDirectory> {
  await rejectSymlinkComponents(directory, `${kind} input directory`);
  let directoryInfo: Stats;
  try {
    directoryInfo = await lstat(directory);
  } catch (error) {
    if (errorCode(error) === "ENOENT" && kind === "screenshot") {
      warn(
        `Screenshot directory is missing; continuing without screenshots: ${directory}`,
      );
      return { candidates: [] };
    }
    if (errorCode(error) === "ENOENT") {
      throw new FastifestError(
        "INPUT_INVALID",
        `Logo input directory does not exist: ${directory}`,
        error,
      );
    }
    throw new FastifestError(
      "IO_FAILED",
      `Could not inspect ${kind} input directory: ${directory}`,
      error,
    );
  }

  if (directoryInfo.isSymbolicLink()) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `${kind} input directory is a symlink or reparse point: ${directory}`,
    );
  }
  if (!directoryInfo.isDirectory()) {
    throw new FastifestError(
      "INPUT_INVALID",
      `${kind} input path is not a directory: ${directory}`,
    );
  }

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
    await rejectSymlinkComponents(directory, `${kind} input directory`);
    const directoryAfter = await lstat(directory);
    if (
      directoryAfter.isSymbolicLink() ||
      !directoryAfter.isDirectory() ||
      !sameFile(directoryInfo, directoryAfter)
    ) {
      throw new FastifestError(
        "UNSAFE_PATH",
        `${kind} input directory changed while it was being read: ${directory}`,
      );
    }
  } catch (error) {
    if (error instanceof FastifestError) throw error;
    throw new FastifestError(
      "IO_FAILED",
      `Could not read ${kind} input directory: ${directory}`,
      error,
    );
  }
  entries.sort((first, second) =>
    compareSourceBasenames(first.name, second.name),
  );

  const extensions = kind === "logo" ? LOGO_FORMATS : SCREENSHOT_FORMATS;
  const candidates: Candidate[] = [];
  let unsupportedCount = 0;
  for (const entry of entries) {
    const extension = extname(entry.name).toLowerCase();
    const expectedFormat = extensions[extension];
    if (!expectedFormat) {
      unsupportedCount += 1;
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new FastifestError(
        "UNSAFE_PATH",
        `Supported ${kind} input is a symlink or reparse point: ${join(directory, entry.name)}`,
      );
    }
    if (!entry.isFile()) {
      unsupportedCount += 1;
      continue;
    }
    candidates.push({
      basename: entry.name,
      sourcePath: join(directory, entry.name),
      extension,
      expectedFormat,
    });
  }

  if (unsupportedCount > 0) {
    warn(
      `Ignored ${unsupportedCount} unsupported ${kind} entr${unsupportedCount === 1 ? "y" : "ies"} in ${directory}.`,
    );
  }
  if (kind === "screenshot" && entries.length === 0) {
    warn(
      `Screenshot directory is empty; continuing without screenshots: ${directory}`,
    );
  } else if (kind === "screenshot" && candidates.length === 0) {
    warn(
      `No supported screenshots found; continuing without screenshots: ${directory}`,
    );
  }

  return { candidates };
}

async function inspectCandidate(
  candidate: Candidate,
  kind: DiscoveredImageKind,
): Promise<DiscoveredImage> {
  const maximumBytes =
    candidate.expectedFormat === "svg"
      ? MAX_SVG_FILE_BYTES
      : MAX_RASTER_FILE_BYTES;
  const bytes = await readBoundedFile(candidate.sourcePath, maximumBytes);
  if (candidate.expectedFormat === "svg") {
    await validateSvgReferences(candidate.sourcePath, bytes);
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { failOn: "warning" }).metadata();
  } catch (error) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `Could not decode supported ${kind} image: ${candidate.sourcePath}`,
      error,
    );
  }

  if (metadata.format !== candidate.expectedFormat) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `File extension ${candidate.extension} does not match detected ${metadata.format ?? "unknown"} image format: ${candidate.sourcePath}`,
    );
  }

  if (candidate.expectedFormat !== "svg") {
    const width = metadata.width;
    const height = metadata.height;
    if (
      width === undefined ||
      height === undefined ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1
    ) {
      throw new FastifestError(
        "IMAGE_INVALID",
        `Raster image has invalid dimensions: ${candidate.sourcePath}`,
      );
    }
    if (width > MAX_RASTER_SIDE || height > MAX_RASTER_SIDE) {
      throw new FastifestError(
        "INPUT_LIMIT",
        `Raster image exceeds the ${MAX_RASTER_SIDE}-pixel maximum side (${width}x${height}): ${candidate.sourcePath}`,
      );
    }
    if (width * height > MAX_RASTER_PIXELS) {
      throw new FastifestError(
        "INPUT_LIMIT",
        `Raster image exceeds the ${MAX_RASTER_PIXELS}-pixel limit (${width}x${height}): ${candidate.sourcePath}`,
      );
    }

    try {
      await sharp(bytes, {
        failOn: "warning",
        limitInputPixels: MAX_RASTER_PIXELS,
      })
        .resize({ width: 1, height: 1, fit: "fill" })
        .raw()
        .toBuffer();
    } catch (error) {
      throw new FastifestError(
        "IMAGE_INVALID",
        `Could not fully decode supported ${kind} image: ${candidate.sourcePath}`,
        error,
      );
    }
  }

  const discovered: DiscoveredImage = {
    sourcePath: candidate.sourcePath,
    basename: candidate.basename,
    normalizedBasename: candidate.basename.normalize("NFC"),
    extension: candidate.extension,
    format: candidate.expectedFormat,
    sizeBytes: bytes.byteLength,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  };
  if (metadata.width !== undefined) discovered.width = metadata.width;
  if (metadata.height !== undefined) discovered.height = metadata.height;
  if (metadata.orientation !== undefined) {
    discovered.orientation = metadata.orientation;
  }
  return discovered;
}

function isPathInside(root: string, sourcePath: string): boolean {
  const pathFromRoot = relative(root, sourcePath);
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`)
  );
}

/** Discover, safely read, and validate all supported direct-child image sources. */
export async function discoverInputs(
  config: ResolvedFastifestConfig,
  options: DiscoverInputsOptions = {},
): Promise<DiscoveredInputs> {
  const logger = options.logger ?? createLogger(config.logLevel);
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
    logger.warn(message);
  };

  const logoDirectory = await listCandidates(config.logosPath, "logo", warn);
  if (logoDirectory.candidates.length === 0) {
    throw new FastifestError(
      "INPUT_INVALID",
      `Expected exactly one supported logo in ${config.logosPath}, but found none. Add one PNG, JPG, JPEG, or SVG file.`,
    );
  }

  const logos: DiscoveredImage[] = [];
  for (const candidate of logoDirectory.candidates) {
    if (!isPathInside(config.logosPath, candidate.sourcePath)) {
      throw new FastifestError(
        "UNSAFE_PATH",
        `Logo input escapes its configured directory: ${candidate.sourcePath}`,
      );
    }
    logos.push(await inspectCandidate(candidate, "logo"));
  }
  if (logos.length !== 1) {
    throw new FastifestError(
      "INPUT_INVALID",
      `Expected exactly one supported logo in ${config.logosPath}, but found ${logos.length}: ${logos.map((logo) => logo.basename).join(", ")}. Keep only the intended primary logo in that directory.`,
    );
  }

  const screenshotDirectory = await listCandidates(
    config.screenshotsPath,
    "screenshot",
    warn,
  );
  const screenshots: DiscoveredImage[] = [];
  for (const candidate of screenshotDirectory.candidates) {
    if (!isPathInside(config.screenshotsPath, candidate.sourcePath)) {
      throw new FastifestError(
        "UNSAFE_PATH",
        `Screenshot input escapes its configured directory: ${candidate.sourcePath}`,
      );
    }
    screenshots.push(await inspectCandidate(candidate, "screenshot"));
  }

  const discoveredNames = new Set(
    screenshots.map((screenshot) => screenshot.basename),
  );
  const unrecognizedMetadataNames = Object.keys(config.screenshotMetadata)
    .filter((basename) => !discoveredNames.has(basename))
    .sort(compareSourceBasenames);
  if (unrecognizedMetadataNames.length > 0) {
    throw new FastifestError(
      "CONFIG_INVALID",
      `Screenshot metadata does not match discovered source basename(s): ${unrecognizedMetadataNames.join(", ")}. Use the exact filename, including case and extension.`,
    );
  }

  for (const screenshot of screenshots) {
    if (Object.hasOwn(config.screenshotMetadata, screenshot.basename)) {
      screenshot.annotation = config.screenshotMetadata[screenshot.basename]!;
    }
  }

  return { logo: logos[0]!, screenshots, warnings };
}
