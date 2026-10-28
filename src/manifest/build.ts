import { isAbsolute, relative, resolve, sep } from "node:path";
import { FastifestError } from "../errors.js";
import { validateTemplate } from "../config/template.js";
import { createLogger, type Logger } from "../logger.js";
import type { GeneratedLogoIcon } from "../images/logo.js";
import {
  MAX_SCREENSHOT_SIDE,
  type GeneratedScreenshot,
} from "../images/screenshots.js";
import type { JsonObject, ResolvedFastifestConfig } from "../types.js";

const ICON_SPECS = [
  { filename: "icon-192.png", size: 192, purpose: "any" },
  { filename: "icon-512.png", size: 512, purpose: "any" },
  { filename: "icon-maskable-192.png", size: 192, purpose: "maskable" },
  { filename: "icon-maskable-512.png", size: 512, purpose: "maskable" },
] as const;

export interface ManifestIconEntry {
  src: string;
  sizes: string;
  type: "image/png";
  purpose: "any" | "maskable";
}

export interface ManifestScreenshotEntry {
  src: string;
  sizes: string;
  type: "image/png";
  label?: string;
  form_factor?: "narrow" | "wide";
}

/** Fully assembled manifest value and stable UTF-8 JSON, ready for the commit stage. */
export interface BuiltManifest {
  manifestPath: string;
  value: JsonObject;
  json: string;
  warnings: string[];
}

export interface BuildManifestOptions {
  logger?: Logger;
}

function invalidOutput(message: string): never {
  throw new FastifestError("INPUT_INVALID", message);
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

function validateOutputLayout(config: ResolvedFastifestConfig): {
  publicRoot: string;
  manifestPath: string;
  iconsDirectory: string;
  screenshotsDirectory: string;
} {
  const publicRoot = resolve(config.publicRoot);
  const manifestPath = resolve(config.manifestPath);
  const iconsDirectory = resolve(config.iconsOutputPath);
  const screenshotsDirectory = resolve(config.screenshotsOutputPath);

  if (manifestPath !== resolve(publicRoot, "manifest.json")) {
    throw new FastifestError(
      "PATH_INVALID",
      "The generated manifest must be manifest.json directly inside the configured public root.",
    );
  }
  if (
    !isWithin(publicRoot, iconsDirectory) ||
    !isWithin(publicRoot, screenshotsDirectory)
  ) {
    throw new FastifestError(
      "UNSAFE_PATH",
      "Generated image directories must be subdirectories of the configured public root.",
    );
  }
  if (
    pathsOverlap(iconsDirectory, screenshotsDirectory) ||
    pathsOverlap(manifestPath, iconsDirectory) ||
    pathsOverlap(manifestPath, screenshotsDirectory)
  ) {
    throw new FastifestError(
      "PATH_INVALID",
      "Generated image directories must not overlap one another or manifest.json.",
    );
  }
  return { publicRoot, manifestPath, iconsDirectory, screenshotsDirectory };
}

function urlPath(
  publicRoot: string,
  outputDirectory: string,
  filename: string,
): string {
  const target = resolve(outputDirectory, filename);
  if (!isWithin(publicRoot, target)) {
    throw new FastifestError(
      "UNSAFE_PATH",
      `Generated manifest asset is outside the configured public root: ${target}`,
    );
  }
  return relative(publicRoot, target)
    .split(sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function validateIcons(
  icons: readonly GeneratedLogoIcon[],
): GeneratedLogoIcon[] {
  if (icons.length !== ICON_SPECS.length) {
    invalidOutput(
      "The manifest requires exactly four generated Fastifest icons.",
    );
  }
  const byFilename = new Map<string, GeneratedLogoIcon>();
  for (const icon of icons) {
    const expected = ICON_SPECS.find((spec) => spec.filename === icon.filename);
    if (
      !expected ||
      byFilename.has(icon.filename) ||
      icon.size !== expected.size ||
      icon.purpose !== expected.purpose ||
      icon.mimeType !== "image/png" ||
      !Buffer.isBuffer(icon.buffer) ||
      icon.buffer.length === 0
    ) {
      invalidOutput(`Invalid generated icon metadata for ${icon.filename}.`);
    }
    byFilename.set(icon.filename, icon);
  }
  return ICON_SPECS.map((spec) => {
    const icon = byFilename.get(spec.filename);
    if (!icon) invalidOutput(`Missing generated icon ${spec.filename}.`);
    return icon;
  });
}

function validateScreenshots(
  screenshots: readonly GeneratedScreenshot[],
): void {
  for (const [index, screenshot] of screenshots.entries()) {
    const expectedFilename = `screenshot-${String(index + 1).padStart(2, "0")}.png`;
    if (
      screenshot.filename !== expectedFilename ||
      screenshot.mimeType !== "image/png" ||
      !Number.isSafeInteger(screenshot.width) ||
      !Number.isSafeInteger(screenshot.height) ||
      screenshot.width < 1 ||
      screenshot.height < 1 ||
      screenshot.width > MAX_SCREENSHOT_SIDE ||
      screenshot.height > MAX_SCREENSHOT_SIDE ||
      !Buffer.isBuffer(screenshot.buffer) ||
      screenshot.buffer.length === 0 ||
      (screenshot.label !== undefined &&
        (typeof screenshot.label !== "string" ||
          screenshot.label.trim().length === 0)) ||
      (screenshot.formFactor !== undefined &&
        screenshot.formFactor !== "narrow" &&
        screenshot.formFactor !== "wide")
    ) {
      invalidOutput(
        `Invalid generated screenshot metadata for ${screenshot.filename}.`,
      );
    }
  }
}

/** Assemble generated image entries with a validated template without writing files. */
export function buildManifest(
  config: ResolvedFastifestConfig,
  templateInput: unknown,
  iconsInput: readonly GeneratedLogoIcon[],
  screenshotsInput: readonly GeneratedScreenshot[],
  options: BuildManifestOptions = {},
): BuiltManifest {
  const template = validateTemplate(templateInput);
  const { publicRoot, manifestPath, iconsDirectory, screenshotsDirectory } =
    validateOutputLayout(config);
  const icons = validateIcons(iconsInput);
  validateScreenshots(screenshotsInput);

  const iconEntries: ManifestIconEntry[] = icons.map((icon) => ({
    src: urlPath(publicRoot, iconsDirectory, icon.filename),
    sizes: `${icon.size}x${icon.size}`,
    type: "image/png",
    purpose: icon.purpose,
  }));
  const screenshotEntries: ManifestScreenshotEntry[] = screenshotsInput.map(
    (screenshot) => {
      const entry: ManifestScreenshotEntry = {
        src: urlPath(publicRoot, screenshotsDirectory, screenshot.filename),
        sizes: `${screenshot.width}x${screenshot.height}`,
        type: "image/png",
      };
      if (screenshot.label !== undefined) entry.label = screenshot.label;
      if (screenshot.formFactor !== undefined) {
        entry.form_factor = screenshot.formFactor;
      }
      return entry;
    },
  );

  const value = {
    ...template,
    icons: iconEntries,
    ...(screenshotEntries.length > 0 ? { screenshots: screenshotEntries } : {}),
  } as unknown as JsonObject;
  const json = `${JSON.stringify(value, null, 2)}\n`;
  const warnings: string[] = [];
  const logger = options.logger ?? createLogger(config.logLevel);
  const warn = (message: string): void => {
    warnings.push(message);
    logger.warn(message);
  };

  if (template.start_url === undefined) {
    warn(
      "Manifest template omits start_url; browsers may fall back to the linking page, and scope/id relationships cannot be fully checked.",
    );
  }
  if (
    template.display === undefined &&
    template.display_override === undefined
  ) {
    warn(
      "Manifest template omits display and display_override; browser install promotion may be affected.",
    );
  }
  if (template.prefer_related_applications === true) {
    warn(
      "prefer_related_applications is true; Chromium install promotion may be affected.",
    );
  }
  if (screenshotEntries.length === 0) {
    warn(
      "No screenshots were generated; the manifest screenshots member was omitted.",
    );
  }

  return { manifestPath, value, json, warnings };
}
