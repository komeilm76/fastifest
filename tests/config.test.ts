import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { resolveConfig } from "../src/config/resolve.js";
import { validateConfig } from "../src/config/validate.js";
import { FastifestError } from "../src/errors.js";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), "fastifest-config-")),
  );
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("validateConfig", () => {
  it("accepts an empty config and returns a fresh object", () => {
    expect(validateConfig({})).toEqual({});
    expect(validateConfig({})).not.toBe(validateConfig({}));
  });

  it("rejects accessor properties before evaluating config values", () => {
    let reads = 0;
    const metadata = Object.defineProperty({}, "label", {
      enumerable: true,
      get: () => (reads++ < 3 ? "Home" : ""),
    });

    expect(() =>
      validateConfig({ screenshots: { metadata: { "home.png": metadata } } }),
    ).toThrowError("accessor properties are not supported");
    expect(reads).toBe(0);
  });

  it("rejects unknown keys with a field-specific error", () => {
    expect(() =>
      validateConfig({ logging: { verbosity: "quiet" } }),
    ).toThrowError("Invalid config.logging.verbosity: unknown option.");
  });

  it("validates nested paths, booleans, log levels, and screenshot metadata", () => {
    expect(
      validateConfig({
        paths: { output: { logos: "./icons", screenshots: "./screenshots" } },
        images: { overwrite: false },
        logging: { level: "debug" },
        screenshots: {
          metadata: { "home.png": { label: "Home", formFactor: "wide" } },
        },
      }),
    ).toEqual({
      paths: { output: { logos: "./icons", screenshots: "./screenshots" } },
      images: { overwrite: false },
      logging: { level: "debug" },
      screenshots: {
        metadata: { "home.png": { label: "Home", formFactor: "wide" } },
      },
    });
  });

  it.each([
    [
      { paths: { output: { icons: "./icons" } } },
      "Invalid config.paths.output.icons: unknown option.",
    ],
    [
      { paths: { logos: "" } },
      "Invalid config.paths.logos: expected a non-empty filesystem path.",
    ],
    [
      { template: { path: "" } },
      "Invalid config.template.path: expected a non-empty filesystem path.",
    ],
    [
      { images: { overwrite: "yes" } },
      "Invalid config.images.overwrite: expected a boolean.",
    ],
    [
      { logging: { level: "trace" } },
      'Invalid config.logging.level: expected "error", "warn", "info", or "debug".',
    ],
    [
      { screenshots: { metadata: { "../home.png": { label: "Home" } } } },
      "key must be an exact source basename",
    ],
    [
      { screenshots: { metadata: { "home.png": { formFactor: "auto" } } } },
      'expected "narrow" or "wide"',
    ],
    [
      { screenshots: { metadata: { "home.png": {} } } },
      "provide label, formFactor, or both.",
    ],
  ])("rejects malformed values", (config, message) => {
    expect(() => validateConfig(config)).toThrowError(message);
  });
});

describe("resolveConfig", () => {
  it("resolves defaults against the consuming project root", async () => {
    const resolved = await resolveConfig({}, { cwd: projectRoot });
    expect(resolved).toMatchObject({
      projectRoot,
      publicRoot: join(projectRoot, "public"),
      manifestPath: join(projectRoot, "public", "manifest.json"),
      logosPath: join(projectRoot, "assets", "logos"),
      screenshotsPath: join(projectRoot, "assets", "screenshots"),
      iconsOutputPath: join(projectRoot, "public", "icons"),
      screenshotsOutputPath: join(projectRoot, "public", "screenshots"),
      templatePath: join(projectRoot, "manifest.template.ts"),
      templateEnabled: true,
      overwrite: true,
      logLevel: "info",
    });
  });

  it("resolves nested output paths relative to the configured public root", async () => {
    const resolved = await resolveConfig(
      {
        paths: {
          public: "./site",
          manifest: "./manifest.json",
          output: { logos: "./assets/icons", screenshots: "captures" },
        },
      },
      { cwd: projectRoot },
    );
    expect(resolved.iconsOutputPath).toBe(
      join(projectRoot, "site", "assets", "icons"),
    );
    expect(resolved.screenshotsOutputPath).toBe(
      join(projectRoot, "site", "captures"),
    );
    expect(resolved.manifestPath).toBe(
      join(projectRoot, "site", "manifest.json"),
    );
  });

  it.each([
    [{ paths: { output: { logos: "../outside" } } }, "inside the public root"],
    [{ paths: { output: { logos: "." } } }, "inside the public root"],
    [{ paths: { output: { logos: "/tmp/icons" } } }, "must be relative"],
    [
      { paths: { manifest: "./public/manifest.json" } },
      "directly inside the public root",
    ],
    [
      { paths: { manifest: "../manifest.json" } },
      "directly inside the public root",
    ],
    [
      { paths: { manifest: "./nested/manifest.json" } },
      "directly inside the public root",
    ],
    [
      { paths: { output: { logos: "manifest.json" } } },
      "Manifest/input/output paths must not overlap",
    ],
    [
      { paths: { logos: "./assets", screenshots: "./assets/screens" } },
      "Input paths must not overlap",
    ],
    [
      { paths: { output: { logos: "assets", screenshots: "assets/screens" } } },
      "Output paths must not overlap",
    ],
    [
      { paths: { logos: "./public/icons" } },
      "Input/output paths must not overlap",
    ],
    [
      { template: { path: "./public/icons/template.ts" } },
      "Template/output paths must not overlap",
    ],
  ])(
    "rejects unsafe or conflicting path relationships",
    async (config, message) => {
      await expect(
        resolveConfig(config, { cwd: projectRoot }),
      ).rejects.toThrowError(message);
    },
  );

  it("rejects an absolute manifest path", async () => {
    await expect(
      resolveConfig(
        { paths: { manifest: join(projectRoot, "public", "manifest.json") } },
        { cwd: projectRoot },
      ),
    ).rejects.toThrowError("must be relative to config.paths.public");
  });

  it("rejects a project root that is a file", async () => {
    const filePath = join(projectRoot, "not-a-directory");
    await writeFile(filePath, "content");
    await expect(resolveConfig({}, { cwd: filePath })).rejects.toMatchObject({
      code: "PATH_INVALID",
    });
  });

  it("rejects symlinked output components before writing", async () => {
    const publicRoot = join(projectRoot, "public");
    await mkdir(publicRoot, { recursive: true });
    await symlink(
      projectRoot,
      join(publicRoot, "icons"),
      process.platform === "win32" ? "junction" : undefined,
    );

    await expect(resolveConfig({}, { cwd: projectRoot })).rejects.toMatchObject(
      {
        code: "UNSAFE_PATH",
      } satisfies Partial<FastifestError>,
    );
  });
});

describe("loadConfig", () => {
  it("uses defaults when the optional project config is missing", async () => {
    await expect(loadConfig({ cwd: projectRoot })).resolves.toEqual({});
  });

  it("loads a TypeScript default export relative to cwd", async () => {
    const configFile = join(projectRoot, "custom.config.ts");
    await writeFile(
      configFile,
      `export default { paths: { logos: './brand' }, images: { overwrite: false } } as const;`,
    );
    await expect(
      loadConfig({ cwd: projectRoot, configPath: "./custom.config.ts" }),
    ).resolves.toEqual({
      paths: { logos: "./brand" },
      images: { overwrite: false },
    });
  });

  it("re-reads an edited config on a later generation call in the same process", async () => {
    const configFile = join(projectRoot, "custom.config.ts");
    await writeFile(
      configFile,
      `export default { images: { overwrite: false } };`,
    );
    await expect(
      loadConfig({ cwd: projectRoot, configPath: configFile }),
    ).resolves.toMatchObject({
      images: { overwrite: false },
    });

    await writeFile(
      configFile,
      `export default { images: { overwrite: true } };`,
    );
    await expect(
      loadConfig({ cwd: projectRoot, configPath: configFile }),
    ).resolves.toMatchObject({
      images: { overwrite: true },
    });
  });

  it("fails clearly when an explicitly selected config file is missing", async () => {
    await expect(
      loadConfig({ cwd: projectRoot, configPath: "./missing.ts" }),
    ).rejects.toMatchObject({
      code: "CONFIG_LOAD_FAILED",
    });
  });

  it("validates loaded exports instead of trusting TypeScript types", async () => {
    await writeFile(
      join(projectRoot, "fastifest.config.ts"),
      `export default { images: { overwrite: 'yes' } };`,
    );
    await expect(loadConfig({ cwd: projectRoot })).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });
});
