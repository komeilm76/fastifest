#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FastifestError } from "./errors.js";
import { generateProject } from "./generation.js";
import type { Logger } from "./logger.js";

const USAGE = `Usage: fastifest [options]

Generate a Web App Manifest and standardized icons/screenshots for this project.

Options:
  -c, --config <path>  Load a config file (relative paths resolve from cwd)
  -h, --help           Show this help
  -v, --version        Show the installed package version
`;

interface RunOptions {
  cwd?: string;
  logger?: Logger;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
}

type ParsedArguments =
  | { command: "help" }
  | { command: "version" }
  | { command: "generate"; configPath?: string };

function usageError(message: string): FastifestError {
  return new FastifestError("CONFIG_INVALID", message);
}

function parseArguments(args: readonly string[]): ParsedArguments {
  let configPath: string | undefined;
  let showHelp = false;
  let showVersion = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") {
      showHelp = true;
      continue;
    }
    if (argument === "--version" || argument === "-v") {
      showVersion = true;
      continue;
    }
    if (argument === "--config" || argument === "-c") {
      const value = args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("-")) {
        throw usageError(`Option ${argument} requires a config file path.`);
      }
      if (configPath !== undefined) {
        throw usageError("The config option may only be provided once.");
      }
      configPath = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--config=")) {
      const value = argument.slice("--config=".length);
      if (value.length === 0) {
        throw usageError("Option --config requires a config file path.");
      }
      if (configPath !== undefined) {
        throw usageError("The config option may only be provided once.");
      }
      configPath = value;
      continue;
    }
    if (argument.startsWith("-")) {
      throw usageError(`Unknown option: ${argument}`);
    }
    throw usageError(`Unexpected positional argument: ${argument}`);
  }

  if (showHelp) return { command: "help" };
  if (showVersion) return { command: "version" };
  return {
    command: "generate",
    ...(configPath === undefined ? {} : { configPath }),
  };
}

async function packageVersion(): Promise<string> {
  try {
    const packageContents = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );
    const packageMetadata: unknown = JSON.parse(packageContents);
    if (
      typeof packageMetadata !== "object" ||
      packageMetadata === null ||
      !("version" in packageMetadata) ||
      typeof packageMetadata.version !== "string"
    ) {
      throw new Error("package.json does not contain a string version.");
    }
    return packageMetadata.version;
  } catch (error) {
    throw new FastifestError(
      "IO_FAILED",
      "Could not read the installed Fastifest version.",
      error,
    );
  }
}

/** Run the CLI and return its process exit code; exposed for deterministic tests. */
export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  options: RunOptions = {},
): Promise<number> {
  const writeStdout =
    options.writeStdout ?? ((message) => process.stdout.write(message));
  const writeStderr =
    options.writeStderr ?? ((message) => process.stderr.write(message));
  let parsed: ParsedArguments;

  try {
    parsed = parseArguments(args);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Invalid command-line arguments.";
    writeStderr(`Fastifest CLI error: ${message}\n\n${USAGE}`);
    return 2;
  }

  if (parsed.command === "help") {
    writeStdout(USAGE);
    return 0;
  }
  if (parsed.command === "version") {
    try {
      writeStdout(`${await packageVersion()}\n`);
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeStderr(`Fastifest error: ${message}\n`);
      return 1;
    }
  }

  try {
    await generateProject({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(parsed.configPath === undefined
        ? {}
        : { configPath: parsed.configPath }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
    return 0;
  } catch (error) {
    if (error instanceof FastifestError) {
      writeStderr(`Fastifest error [${error.code}]: ${error.message}\n`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      writeStderr(`Fastifest error: ${message}\n`);
    }
    return 1;
  }
}

function isMainModule(): boolean {
  const entryPath = process.argv[1];
  if (entryPath === undefined) return false;
  try {
    return (
      realpathSync(resolve(entryPath)) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
