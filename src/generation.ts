import { loadConfig } from "./config/load.js";
import {
  loadOrCreateTemplate,
  type LoadOrCreateTemplateResult,
} from "./config/template.js";
import { resolveConfig } from "./config/resolve.js";
import { discoverInputs } from "./discovery/index.js";
import { generateLogoIcons } from "./images/logo.js";
import { generateScreenshots } from "./images/screenshots.js";
import { createLogger, type Logger } from "./logger.js";
import { ownOption } from "./own-property.js";
import {
  commitGeneration,
  type CommittedGeneration,
} from "./output/transaction.js";

/** Options controlling a single `generateProject` run. */
export interface GenerateProjectOptions {
  /** Consumer project directory. Defaults to the current working directory. */
  cwd?: string;
  /** Optional config file, resolved from `cwd` unless absolute. */
  configPath?: string;
  /** Optional logger override used for every pipeline stage. */
  logger?: Logger;
}

/** Successful first-run result when Fastifest creates a starter template and stops. */
export interface TemplateCreatedResult {
  /** Discriminator for the create-template stop result. */
  status: "template-created";
  /** Absolute path to the starter template; customize this file before rerunning. */
  templatePath: string;
  /** Human-readable next-step instructions. No manifest or image assets were written. */
  guidance: string;
}

/** Successful result after assets and `manifest.json` have been generated. */
export interface GeneratedProject extends CommittedGeneration {
  /** Discriminator for a completed generation. */
  status: "generated";
  /** Absolute path of the discovered source logo. */
  logoSource: string;
  /** Absolute paths of discovered screenshot sources, in processing order. */
  screenshotSources: string[];
}

/**
 * Generate a Web App Manifest and managed image assets for a consumer project.
 *
 * The pipeline loads `fastifest.config.ts` when present, discovers one supported
 * logo plus optional screenshots, creates PNG assets, and writes
 * `manifest.json` directly inside the configured public directory. A missing
 * enabled template is created once and returns a `template-created` stop result;
 * call again after customizing it to generate outputs.
 *
 * Supported logo formats are PNG, JPEG, and SVG. Supported screenshot formats
 * are PNG and JPEG. See the user guide for byte/pixel limits and output details.
 *
 * @param options - Project location, optional config path, and logger override.
 * @returns Either a first-run template stop result or completed manifest/assets.
 * @throws {import("./errors.js").FastifestError} With a stable `code` for
 * config, template, input, path, image, output-conflict, or filesystem failures.
 * @throws {Error} If a caller-supplied logger sink throws, its error propagates unchanged.
 */
export async function generateProject(
  options: GenerateProjectOptions = {},
): Promise<TemplateCreatedResult | GeneratedProject> {
  const cwd = ownOption(options, "cwd");
  const configPath = ownOption(options, "configPath");
  const requestedLogger = ownOption(options, "logger");
  const loadOptions = {
    ...(cwd === undefined ? {} : { cwd }),
    ...(configPath === undefined ? {} : { configPath }),
  };
  const rawConfig = await loadConfig(loadOptions);
  const resolveOptions = cwd === undefined ? {} : { cwd };
  const config = await resolveConfig(rawConfig, resolveOptions);
  const logger = requestedLogger ?? createLogger(config.logLevel);

  const template: LoadOrCreateTemplateResult = await loadOrCreateTemplate(
    config.templatePath,
    { enabled: config.templateEnabled, logger },
  );
  if (template.status === "created") {
    return {
      status: "template-created",
      templatePath: template.templatePath,
      guidance: template.guidance,
    };
  }

  const discovered = await discoverInputs(config, { logger });
  const generatedIcons = await generateLogoIcons(discovered.logo, { logger });
  const generatedScreenshots = await generateScreenshots(
    discovered.screenshots,
  );
  const committed = await commitGeneration(
    config,
    template.template,
    generatedIcons.icons,
    generatedScreenshots,
    { logger },
  );
  const warnings = [
    ...discovered.warnings,
    ...generatedIcons.warnings,
    ...committed.warnings,
  ];
  logger.info(
    `Generated manifest at ${committed.manifestPath} from ${discovered.logo.basename} and ${generatedScreenshots.length} screenshot(s).`,
  );

  return {
    ...committed,
    status: "generated",
    logoSource: discovered.logo.sourcePath,
    screenshotSources: discovered.screenshots.map(
      (screenshot) => screenshot.sourcePath,
    ),
    warnings,
  };
}
