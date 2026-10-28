/** JSON-compatible value accepted in developer-managed manifest fields. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** JSON object used for manifest extension members and nested records. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** Developer-managed manifest fields. Fastifest owns generated icon collections. */
export interface ManifestTemplate {
  id?: string;
  name?: string;
  short_name?: string;
  description?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  display_override?: string[];
  orientation?: string;
  theme_color?: string;
  background_color?: string;
  lang?: string;
  dir?: "ltr" | "rtl" | "auto";
  categories?: string[];
  shortcuts?: JsonObject[];
  related_applications?: JsonObject[];
  prefer_related_applications?: boolean;
  protocol_handlers?: JsonObject[];
  launch_handler?: JsonObject;
  handle_links?: string;
  scope_extensions?: JsonValue[];
  icons?: never;
  screenshots?: never;
  [key: string]: JsonValue | undefined;
}

/** Optional, explicitly-authored metadata for one screenshot source basename. */
export interface ScreenshotMetadata {
  label?: string;
  formFactor?: "narrow" | "wide";
}

/** User-facing configuration. Most relative paths use the project root; the manifest and generated subpaths use `paths.public`. */
export interface FastifestConfig {
  paths?: {
    public?: string;
    /** Must resolve to `manifest.json` directly inside `paths.public`. */
    manifest?: string;
    logos?: string;
    screenshots?: string;
    output?: {
      logos?: string;
      screenshots?: string;
    };
  };
  template?: {
    path?: string;
    enabled?: boolean;
  };
  images?: {
    overwrite?: boolean;
  };
  screenshots?: {
    metadata?: Record<string, ScreenshotMetadata>;
  };
  logging?: {
    level?: LogLevel;
  };
}

/** Fully normalized absolute paths and defaults used internally by the pipeline. */
export interface ResolvedFastifestConfig {
  projectRoot: string;
  publicRoot: string;
  /** `manifest.json` directly inside publicRoot. */
  manifestPath: string;
  logosPath: string;
  screenshotsPath: string;
  iconsOutputPath: string;
  screenshotsOutputPath: string;
  templatePath: string;
  templateEnabled: boolean;
  overwrite: boolean;
  screenshotMetadata: Record<string, ScreenshotMetadata>;
  logLevel: LogLevel;
}

/** Supported logger thresholds, ordered from most to least verbose. */
export type LogLevel = "error" | "warn" | "info" | "debug";
