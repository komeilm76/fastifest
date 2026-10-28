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
import {
  commitGeneration,
  type CommittedGeneration,
} from "./output/transaction.js";

export interface GenerateProjectOptions {
  /** Consumer project directory. Defaults to the current working directory. */
  cwd?: string;
  /** Optional config file, resolved from cwd unless absolute. */
  configPath?: string;
  /** Optional logger override used for every pipeline stage. */
  logger?: Logger;
}

export interface TemplateCreatedResult {
  status: "template-created";
  templatePath: string;
  guidance: string;
}

export interface GeneratedProject extends CommittedGeneration {
  status: "generated";
  logoSource: string;
  screenshotSources: string[];
}

/**
 * Run the shared generation pipeline for a project. A newly created starter
 * template returns a stop result before image discovery or output mutation.
 */
export async function generateProject(
  options: GenerateProjectOptions = {},
): Promise<TemplateCreatedResult | GeneratedProject> {
  const loadOptions = {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.configPath === undefined
      ? {}
      : { configPath: options.configPath }),
  };
  const rawConfig = await loadConfig(loadOptions);
  const resolveOptions = options.cwd === undefined ? {} : { cwd: options.cwd };
  const config = await resolveConfig(rawConfig, resolveOptions);
  const logger = options.logger ?? createLogger(config.logLevel);

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
