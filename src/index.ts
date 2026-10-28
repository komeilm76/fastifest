export { FastifestError } from "./errors.js";
export type { FastifestErrorCode } from "./errors.js";
export { createLogger } from "./logger.js";
export type { Logger, LogSink } from "./logger.js";
export { loadConfig } from "./config/load.js";
export type { LoadConfigOptions } from "./config/load.js";
export { resolveConfig } from "./config/resolve.js";
export type { ResolveConfigOptions } from "./config/resolve.js";
export { validateConfig } from "./config/validate.js";
export {
  loadOrCreateTemplate,
  loadTemplate,
  validateTemplate,
} from "./config/template.js";
export type {
  LoadOrCreateTemplateOptions,
  LoadOrCreateTemplateResult,
} from "./config/template.js";
export type {
  FastifestConfig,
  JsonObject,
  JsonValue,
  LogLevel,
  ManifestTemplate,
  ResolvedFastifestConfig,
  ScreenshotMetadata,
} from "./types.js";
