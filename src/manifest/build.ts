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

const FALLBACK_MANIFEST_URL = new URL(
  "https://fastifest.invalid/manifest.json",
);
const URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/;

function normalizeUrlInput(value: string): string {
  // Match URL parser preprocessing: strip tabs/newlines globally and surrounding C0/space.
  return value
    .replace(/[\t\n\r]/g, "")
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
}

function isAbsoluteUrlReference(value: string): boolean {
  const normalized = normalizeUrlInput(value);
  return (
    URL_SCHEME.test(normalized) ||
    normalized.startsWith("//") ||
    normalized.startsWith("\\\\")
  );
}

function isPathRelativeReference(value: string): boolean {
  const normalized = normalizeUrlInput(value);
  return !isAbsoluteUrlReference(value) && !normalized.startsWith("/");
}

function parseManifestUrl(value: string, field: string, base: URL): URL {
  try {
    return new URL(value, base);
  } catch (error) {
    throw new FastifestError(
      "TEMPLATE_INVALID",
      `Invalid manifest template.${field}: expected a valid URL or relative URL reference.`,
      error,
    );
  }
}

function scopeContainsStartUrl(scopePath: string, startPath: string): boolean {
  if (scopePath === "/") return true;
  if (startPath === scopePath) return true;
  const prefix = scopePath.endsWith("/") ? scopePath : `${scopePath}/`;
  return startPath.startsWith(prefix);
}

/** Check URL relationships without assuming the deployed site host. */
function validateTemplateUrlRelationships(
  template: ReturnType<typeof validateTemplate>,
  warn: (message: string) => void,
): void {
  if (template.start_url === undefined) {
    for (const [field, value] of [
      ["scope", template.scope],
      ["id", template.id],
    ] as const) {
      if (value !== undefined) {
        parseManifestUrl(value, field, FALLBACK_MANIFEST_URL);
      }
    }
    return;
  }

  const candidateFields: Array<[string, string | undefined]> = [
    ["start_url", template.start_url],
    ["scope", template.scope],
    ["id", template.id],
  ];

  const startUrlIsAbsolute = isAbsoluteUrlReference(template.start_url);
  let absoluteReferenceOrigin: string | undefined;
  for (const [field, value] of candidateFields) {
    if (value === undefined || !isAbsoluteUrlReference(value)) continue;
    const absoluteUrl = parseManifestUrl(value, field, FALLBACK_MANIFEST_URL);
    if (absoluteUrl.origin === "null") {
      throw new FastifestError(
        "TEMPLATE_INVALID",
        `Invalid manifest template.${field}: URL must have a web origin.`,
      );
    }
    if (
      absoluteReferenceOrigin !== undefined &&
      absoluteReferenceOrigin !== absoluteUrl.origin
    ) {
      throw new FastifestError(
        "TEMPLATE_INVALID",
        `Invalid manifest template.${field}: URL must use the same origin as the other absolute manifest URLs.`,
      );
    }
    absoluteReferenceOrigin = absoluteUrl.origin;
  }

  const assumedOrigin = startUrlIsAbsolute
    ? absoluteReferenceOrigin
    : undefined;
  const base = new URL(
    "/manifest.json",
    `${assumedOrigin ?? FALLBACK_MANIFEST_URL.origin}/`,
  );
  const startUrl =
    template.start_url === undefined
      ? undefined
      : parseManifestUrl(template.start_url, "start_url", base);
  const scopeUrl =
    template.scope === undefined
      ? undefined
      : parseManifestUrl(template.scope, "scope", base);
  const idUrl =
    template.id === undefined
      ? undefined
      : parseManifestUrl(template.id, "id", base);

  if (startUrl && startUrl.origin !== base.origin) {
    throw new FastifestError(
      "TEMPLATE_INVALID",
      "Invalid manifest template.start_url: URL must resolve to the manifest origin.",
    );
  }
  if (
    scopeUrl &&
    startUrl &&
    (startUrlIsAbsolute || !isAbsoluteUrlReference(template.scope ?? "")) &&
    scopeUrl.origin !== startUrl.origin
  ) {
    throw new FastifestError(
      "TEMPLATE_INVALID",
      "Invalid manifest template.scope: URL must resolve to the same origin as start_url.",
    );
  }
  const pathContainmentIsUnknown =
    scopeUrl !== undefined &&
    startUrl !== undefined &&
    (isPathRelativeReference(template.start_url!) ||
      (template.scope !== undefined &&
        isPathRelativeReference(template.scope)));
  if (
    scopeUrl &&
    startUrl &&
    !pathContainmentIsUnknown &&
    !scopeContainsStartUrl(scopeUrl.pathname, startUrl.pathname)
  ) {
    throw new FastifestError(
      "TEMPLATE_INVALID",
      "Invalid manifest template.scope: resolved scope must contain start_url.",
    );
  }
  if (pathContainmentIsUnknown) {
    warn(
      "Fastifest cannot fully verify scope containment for path-relative start_url or scope because the deployed manifest URL prefix is unknown. Check the relationship at your deployed manifest URL.",
    );
  }
  if (
    idUrl &&
    startUrl &&
    (startUrlIsAbsolute || !isAbsoluteUrlReference(template.id ?? "")) &&
    idUrl.origin !== startUrl.origin
  ) {
    throw new FastifestError(
      "TEMPLATE_INVALID",
      "Invalid manifest template.id: URL must resolve to the same origin as start_url.",
    );
  }

  if (
    candidateFields.some(
      ([, value]) => value !== undefined && isAbsoluteUrlReference(value),
    )
  ) {
    if (startUrlIsAbsolute) {
      warn(
        `Manifest template contains absolute URLs; Fastifest assumes deployment on origin ${assumedOrigin} for relationship checks because the final site origin is unknown.`,
      );
    } else {
      warn(
        "Manifest template combines absolute URLs with a relative start_url; same-origin relationships involving relative URLs cannot be fully checked because the final site origin is unknown.",
      );
    }
  }
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
  const warnings: string[] = [];
  const logger = options.logger ?? createLogger(config.logLevel);
  const warn = (message: string): void => {
    warnings.push(message);
    logger.warn(message);
  };
  validateTemplateUrlRelationships(template, warn);

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
