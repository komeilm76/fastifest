import { FastifestError } from "../errors.js";
import type {
  FastifestConfig,
  LogLevel,
  ScreenshotMetadata,
} from "../types.js";

const CONFIG_KEYS = ["paths", "template", "images", "screenshots", "logging"];
const PATH_KEYS = ["public", "manifest", "logos", "screenshots", "output"];
const OUTPUT_KEYS = ["logos", "screenshots"];
const TEMPLATE_KEYS = ["path", "enabled"];
const IMAGE_KEYS = ["overwrite"];
const SCREENSHOTS_KEYS = ["metadata"];
const LOGGING_KEYS = ["level"];
const METADATA_KEYS = ["label", "formFactor"];
const LOG_LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];

type UnknownRecord = Record<string, unknown>;

function invalid(path: string, detail: string): never {
  const location = path ? `config.${path}` : "config";
  throw new FastifestError("CONFIG_INVALID", `Invalid ${location}: ${detail}`);
}

function asRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "expected an object.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(path, "expected a plain object.");
  }
  const record = Object.create(null) as UnknownRecord;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && ("get" in descriptor || "set" in descriptor)) {
      return invalid(path, "accessor properties are not supported.");
    }
    if (typeof key !== "string" || !descriptor?.enumerable) continue;
    Object.defineProperty(record, key, {
      value: descriptor.value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }
  return record;
}

function assignOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

function rejectUnknownKeys(
  value: UnknownRecord,
  allowed: string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalid(path ? `${path}.${key}` : key, "unknown option.");
    }
  }
}

function readPath(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.includes("\0")
  ) {
    return invalid(field, "expected a non-empty filesystem path.");
  }
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    return invalid(field, "expected a boolean.");
  }
  return value;
}

function validateMetadata(value: unknown): Record<string, ScreenshotMetadata> {
  const map = asRecord(value, "screenshots.metadata");
  const output = Object.create(null) as Record<string, ScreenshotMetadata>;

  for (const [basename, rawMetadata] of Object.entries(map)) {
    if (
      basename.length === 0 ||
      basename === "." ||
      basename === ".." ||
      basename.includes("/") ||
      basename.includes("\\") ||
      basename.includes("\0")
    ) {
      invalid(
        `screenshots.metadata.${basename}`,
        "key must be an exact source basename, not a path.",
      );
    }

    const metadata = asRecord(rawMetadata, `screenshots.metadata.${basename}`);
    rejectUnknownKeys(
      metadata,
      METADATA_KEYS,
      `screenshots.metadata.${basename}`,
    );
    const normalized: ScreenshotMetadata = {};

    if (metadata.label !== undefined) {
      if (
        typeof metadata.label !== "string" ||
        metadata.label.trim().length === 0
      ) {
        invalid(
          `screenshots.metadata.${basename}.label`,
          "expected a non-empty string.",
        );
      }
      assignOwn(normalized, "label", metadata.label);
    }

    if (metadata.formFactor !== undefined) {
      if (metadata.formFactor !== "narrow" && metadata.formFactor !== "wide") {
        invalid(
          `screenshots.metadata.${basename}.formFactor`,
          'expected "narrow" or "wide".',
        );
      }
      assignOwn(normalized, "formFactor", metadata.formFactor);
    }

    if (
      !Object.hasOwn(normalized, "label") &&
      !Object.hasOwn(normalized, "formFactor")
    ) {
      invalid(
        `screenshots.metadata.${basename}`,
        "provide label, formFactor, or both.",
      );
    }
    output[basename] = normalized;
  }

  return output;
}

/**
 * Validate an unknown config value and return a normalized typed copy.
 * Unknown keys, malformed nested values, and invalid screenshot annotations are
 * rejected; defaults and filesystem resolution are applied separately by
 * `resolveConfig`.
 *
 * @param value - Candidate config object, commonly loaded from TypeScript.
 * @returns A validated `FastifestConfig` containing only supported keys.
 * @throws {FastifestError} With `CONFIG_INVALID` when the value is malformed.
 */
export function validateConfig(value: unknown): FastifestConfig {
  const root = asRecord(value, "");
  rejectUnknownKeys(root, CONFIG_KEYS, "");
  const config: FastifestConfig = {};

  if (root.paths !== undefined) {
    const paths = asRecord(root.paths, "paths");
    rejectUnknownKeys(paths, PATH_KEYS, "paths");
    const normalized: NonNullable<FastifestConfig["paths"]> = {};
    for (const key of ["public", "manifest", "logos", "screenshots"] as const) {
      const valueAtKey = paths[key];
      if (valueAtKey !== undefined) {
        assignOwn(normalized, key, readPath(valueAtKey, `paths.${key}`));
      }
    }
    if (paths.output !== undefined) {
      const output = asRecord(paths.output, "paths.output");
      rejectUnknownKeys(output, OUTPUT_KEYS, "paths.output");
      const normalizedOutput: NonNullable<
        NonNullable<FastifestConfig["paths"]>["output"]
      > = {};
      if (output.logos !== undefined) {
        assignOwn(
          normalizedOutput,
          "logos",
          readPath(output.logos, "paths.output.logos"),
        );
      }
      if (output.screenshots !== undefined) {
        assignOwn(
          normalizedOutput,
          "screenshots",
          readPath(output.screenshots, "paths.output.screenshots"),
        );
      }
      assignOwn(normalized, "output", normalizedOutput);
    }
    assignOwn(config, "paths", normalized);
  }

  if (root.template !== undefined) {
    const template = asRecord(root.template, "template");
    rejectUnknownKeys(template, TEMPLATE_KEYS, "template");
    const normalized: NonNullable<FastifestConfig["template"]> = {};
    if (template.path !== undefined) {
      assignOwn(normalized, "path", readPath(template.path, "template.path"));
    }
    if (template.enabled !== undefined) {
      assignOwn(
        normalized,
        "enabled",
        readBoolean(template.enabled, "template.enabled"),
      );
    }
    assignOwn(config, "template", normalized);
  }

  if (root.images !== undefined) {
    const images = asRecord(root.images, "images");
    rejectUnknownKeys(images, IMAGE_KEYS, "images");
    const normalized: NonNullable<FastifestConfig["images"]> = {};
    if (images.overwrite !== undefined) {
      assignOwn(
        normalized,
        "overwrite",
        readBoolean(images.overwrite, "images.overwrite"),
      );
    }
    assignOwn(config, "images", normalized);
  }

  if (root.screenshots !== undefined) {
    const screenshots = asRecord(root.screenshots, "screenshots");
    rejectUnknownKeys(screenshots, SCREENSHOTS_KEYS, "screenshots");
    if (screenshots.metadata !== undefined) {
      assignOwn(config, "screenshots", {
        metadata: validateMetadata(screenshots.metadata),
      });
    } else {
      assignOwn(config, "screenshots", {});
    }
  }

  if (root.logging !== undefined) {
    const logging = asRecord(root.logging, "logging");
    rejectUnknownKeys(logging, LOGGING_KEYS, "logging");
    const normalized: NonNullable<FastifestConfig["logging"]> = {};
    if (logging.level !== undefined) {
      if (
        typeof logging.level !== "string" ||
        !LOG_LEVELS.includes(logging.level as LogLevel)
      ) {
        invalid(
          "logging.level",
          'expected "error", "warn", "info", or "debug".',
        );
      }
      assignOwn(normalized, "level", logging.level as LogLevel);
    }
    assignOwn(config, "logging", normalized);
  }

  return config;
}
