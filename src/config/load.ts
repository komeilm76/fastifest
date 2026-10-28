import { access } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createJiti } from "jiti";
import { FastifestError } from "../errors.js";
import type { FastifestConfig } from "../types.js";
import { validateConfig } from "./validate.js";

export interface LoadConfigOptions {
  /** Consumer project directory. Defaults to the current working directory. */
  cwd?: string;
  /** Optional config file, resolved from cwd unless absolute. */
  configPath?: string;
}

/** Load and validate fastifest.config.ts, or return defaults when it is absent. */
export async function loadConfig(
  options: LoadConfigOptions = {},
): Promise<FastifestConfig> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const explicitPath = options.configPath !== undefined;
  const configPath = explicitPath
    ? isAbsolute(options.configPath!)
      ? resolve(options.configPath!)
      : resolve(cwd, options.configPath!)
    : resolve(cwd, "fastifest.config.ts");

  try {
    await access(configPath);
  } catch (error) {
    if (!explicitPath && isMissingFileError(error)) return {};
    throw new FastifestError(
      "CONFIG_LOAD_FAILED",
      `Could not read ${explicitPath ? "requested config" : "default config"} file: ${configPath}`,
      error,
    );
  }

  try {
    // A per-load loader instance evaluates this configuration at most once here.
    const jiti = createJiti(import.meta.url, {
      interopDefault: true,
      moduleCache: false,
    });
    const loaded = await jiti.import<unknown>(configPath, { default: true });
    return validateConfig(loaded);
  } catch (error) {
    if (error instanceof FastifestError) throw error;
    throw new FastifestError(
      "CONFIG_LOAD_FAILED",
      `Could not load config file ${configPath}.`,
      error,
    );
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
