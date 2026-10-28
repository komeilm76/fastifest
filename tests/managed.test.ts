import {
  access,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/resolve.js";
import {
  preflightManagedOutputs,
  removeStaleScreenshotsAfterManifestCommit,
} from "../src/output/managed.js";
import { createLogger } from "../src/logger.js";
import type { GeneratedLogoIcon } from "../src/images/logo.js";
import type { GeneratedScreenshot } from "../src/images/screenshots.js";
import type { ResolvedFastifestConfig } from "../src/types.js";

let projectRoot: string;
let config: ResolvedFastifestConfig;
const silentLogger = createLogger("debug", () => {});
const iconSpecs: Array<[string, number, "any" | "maskable"]> = [
  ["icon-192.png", 192, "any"],
  ["icon-512.png", 512, "any"],
  ["icon-maskable-192.png", 192, "maskable"],
  ["icon-maskable-512.png", 512, "maskable"],
];

function makeIcons(): GeneratedLogoIcon[] {
  return iconSpecs.map(([filename, size, purpose]) => ({
    filename,
    size,
    purpose,
    mimeType: "image/png",
    buffer: Buffer.from(`generated:${filename}`),
  }));
}

function makeScreenshot(
  filename = "screenshot-01.png",
  width = 80,
  height = 40,
): GeneratedScreenshot {
  return {
    filename,
    sourceBasename: "home.png",
    width,
    height,
    mimeType: "image/png",
    buffer: Buffer.from(`generated:${filename}`),
  };
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "fastifest-managed-"));
  config = await resolveConfig({}, { cwd: projectRoot });
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("preflightManagedOutputs", () => {
  it("plans only reserved output writes without creating directories", async () => {
    const plan = await preflightManagedOutputs(config, makeIcons(), [
      makeScreenshot(),
    ]);

    expect(plan.iconWrites.map((write) => write.filename)).toEqual(
      iconSpecs.map(([filename]) => filename),
    );
    expect(plan.screenshotWrites.map((write) => write.filename)).toEqual([
      "screenshot-01.png",
    ]);
    expect(plan.staleScreenshotPaths).toEqual([]);
    await expect(access(config.publicRoot)).rejects.toThrow();
    await expect(access(config.iconsOutputPath)).rejects.toThrow();
    await expect(access(config.screenshotsOutputPath)).rejects.toThrow();
  });

  it("allows new reserved outputs with overwrite disabled when no collision exists", async () => {
    const noOverwrite = await resolveConfig(
      { images: { overwrite: false } },
      { cwd: projectRoot },
    );
    const plan = await preflightManagedOutputs(noOverwrite, makeIcons(), []);
    expect(plan.overwrite).toBe(false);
    expect(plan.staleScreenshotPaths).toEqual([]);
  });

  it("rejects non-reserved generated names and incomplete icon sets", async () => {
    await expect(
      preflightManagedOutputs(config, [makeIcons()[0]!], []),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });

    const invalid = makeIcons();
    invalid[0] = { ...invalid[0]!, filename: "../../manual.png" };
    await expect(
      preflightManagedOutputs(config, invalid, []),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });

    await expect(
      preflightManagedOutputs(config, makeIcons(), [
        makeScreenshot("screenshot-02.png"),
      ]),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("fails before changes if overwrite is disabled and a reserved target or stale screenshot exists", async () => {
    const noOverwrite = await resolveConfig(
      { images: { overwrite: false } },
      { cwd: projectRoot },
    );
    await mkdir(noOverwrite.iconsOutputPath, { recursive: true });
    await mkdir(noOverwrite.screenshotsOutputPath, { recursive: true });
    const iconPath = join(noOverwrite.iconsOutputPath, "icon-192.png");
    const stalePath = join(
      noOverwrite.screenshotsOutputPath,
      "screenshot-08.png",
    );
    await writeFile(iconPath, "existing icon");
    await writeFile(stalePath, "stale screenshot");

    await expect(
      preflightManagedOutputs(noOverwrite, makeIcons(), []),
    ).rejects.toMatchObject({ code: "OUTPUT_CONFLICT" });
    await expect(readFile(iconPath, "utf8")).resolves.toBe("existing icon");
    await expect(readFile(stalePath, "utf8")).resolves.toBe("stale screenshot");
  });

  it("plans exact reserved replacements and stale screenshot cleanup while leaving unknown files alone", async () => {
    await mkdir(config.iconsOutputPath, { recursive: true });
    await mkdir(config.screenshotsOutputPath, { recursive: true });
    await writeFile(join(config.iconsOutputPath, "icon-192.png"), "old icon");
    await writeFile(join(config.iconsOutputPath, "icon-256.png"), "user icon");
    await writeFile(
      join(config.screenshotsOutputPath, "screenshot-01.png"),
      "old screenshot",
    );
    await writeFile(
      join(config.screenshotsOutputPath, "screenshot-03.png"),
      "stale screenshot",
    );
    await writeFile(
      join(config.screenshotsOutputPath, "screenshot-1.png"),
      "unreserved name",
    );
    const newlineName = join(
      config.screenshotsOutputPath,
      "screenshot-07.png\n",
    );
    await writeFile(newlineName, "unrecognized newline name");
    await writeFile(
      join(config.screenshotsOutputPath, "notes.txt"),
      "user file",
    );

    const plan = await preflightManagedOutputs(config, makeIcons(), [
      makeScreenshot(),
    ]);
    expect(plan.staleScreenshotPaths).toEqual([
      join(config.screenshotsOutputPath, "screenshot-03.png"),
    ]);
    await expect(
      readFile(join(config.screenshotsOutputPath, "screenshot-03.png"), "utf8"),
    ).resolves.toBe("stale screenshot");
    await expect(
      readFile(join(config.screenshotsOutputPath, "notes.txt"), "utf8"),
    ).resolves.toBe("user file");
    await expect(readFile(newlineName, "utf8")).resolves.toBe(
      "unrecognized newline name",
    );
  });

  it("rejects a desired reserved output path that is a directory", async () => {
    const desiredPath = join(config.screenshotsOutputPath, "screenshot-01.png");
    await mkdir(desiredPath, { recursive: true });
    await expect(
      preflightManagedOutputs(config, makeIcons(), [makeScreenshot()]),
    ).rejects.toMatchObject({ code: "PATH_INVALID" });
    await expect(access(desiredPath)).resolves.toBeUndefined();
  });

  it("ignores stale screenshot-name directories rather than treating them as files", async () => {
    const staleDirectory = join(
      config.screenshotsOutputPath,
      "screenshot-12.png",
    );
    await mkdir(join(staleDirectory, "nested"), { recursive: true });
    await writeFile(join(staleDirectory, "nested", "keep.txt"), "keep");
    const plan = await preflightManagedOutputs(config, makeIcons(), []);
    expect(plan.staleScreenshotPaths).toEqual([]);
    await expect(
      removeStaleScreenshotsAfterManifestCommit(plan, silentLogger),
    ).resolves.toEqual([]);
    await expect(
      readFile(join(staleDirectory, "nested", "keep.txt"), "utf8"),
    ).resolves.toBe("keep");
  });

  it("rejects symlinked output directories and reserved targets", async () => {
    if (process.platform === "win32") return;
    const external = join(projectRoot, "external-icons");
    await mkdir(config.publicRoot, { recursive: true });
    await mkdir(external, { recursive: true });
    await symlink(external, config.iconsOutputPath);
    await expect(
      preflightManagedOutputs(config, makeIcons(), []),
    ).rejects.toMatchObject({ code: "UNSAFE_PATH" });

    await rm(config.iconsOutputPath);
    await mkdir(config.iconsOutputPath, { recursive: true });
    await symlink(
      join(projectRoot, "external-icon.png"),
      join(config.iconsOutputPath, "icon-192.png"),
    );
    await expect(
      preflightManagedOutputs(config, makeIcons(), []),
    ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
  });
});

describe("removeStaleScreenshotsAfterManifestCommit", () => {
  it("removes only planned reserved screenshot files, without recursing", async () => {
    await mkdir(config.screenshotsOutputPath, { recursive: true });
    const stale = join(config.screenshotsOutputPath, "screenshot-12.png");
    const unrecognized = join(config.screenshotsOutputPath, "manual.png");
    const unreserved = join(config.screenshotsOutputPath, "screenshot-1.png");
    await writeFile(stale, "stale");
    await writeFile(unrecognized, "keep");
    await writeFile(unreserved, "keep too");

    const plan = await preflightManagedOutputs(config, makeIcons(), []);
    expect(plan.staleScreenshotPaths).toContain(stale);
    await expect(
      removeStaleScreenshotsAfterManifestCommit(plan, silentLogger),
    ).resolves.toEqual([]);

    await expect(access(stale)).rejects.toThrow();
    await expect(readFile(unrecognized, "utf8")).resolves.toBe("keep");
    await expect(readFile(unreserved, "utf8")).resolves.toBe("keep too");
  });

  it("leaves a planned stale path alone if it becomes a directory", async () => {
    await mkdir(config.screenshotsOutputPath, { recursive: true });
    await writeFile(
      join(config.screenshotsOutputPath, "screenshot-14.png"),
      "stale",
    );
    const plan = await preflightManagedOutputs(config, makeIcons(), []);
    const stale = plan.staleScreenshotPaths[0]!;
    await rm(stale);
    await mkdir(stale);
    const warnings = await removeStaleScreenshotsAfterManifestCommit(
      plan,
      silentLogger,
    );
    expect(warnings).toHaveLength(1);
    await expect(access(stale)).resolves.toBeUndefined();
  });
});
