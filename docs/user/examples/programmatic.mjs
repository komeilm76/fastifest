#!/usr/bin/env node
import { FastifestError, generateProject } from "fastifest";

try {
  const result = await generateProject({ cwd: process.cwd() });

  if (result.status === "template-created") {
    console.info(result.guidance);
    console.info(
      `Customize the starter at ${result.templatePath}, then run again.`,
    );
  } else {
    console.info(`Wrote ${result.manifestPath}`);
    console.info(`Generated ${result.value.icons?.length ?? 0} icons.`);
    if (result.warnings.length > 0) {
      console.warn(result.warnings.join("\n"));
    }
  }
} catch (error) {
  if (error instanceof FastifestError) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}
