import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/resolve.js";
import { createLogger } from "../src/logger.js";
import type { GeneratedLogoIcon } from "../src/images/logo.js";
import type { GeneratedScreenshot } from "../src/images/screenshots.js";
import { commitGeneration } from "../src/output/transaction.js";
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
const template = {
  name: "Transactional App",
  start_url: "/",
  display: "standalone",
};

function makeIcons(): GeneratedLogoIcon[] {
  return iconSpecs.map(([filename, size, purpose]) => ({
    filename,
    size,
    purpose,
    mimeType: "image/png",
    buffer: Buffer.from(`new:${filename}`),
  }));
}

function makeScreenshot(filename = "screenshot-01.png"): GeneratedScreenshot {
  return {
    filename,
    sourceBasename: "home.png",
    width: 640,
    height: 360,
    mimeType: "image/png",
    buffer: Buffer.from(`new:${filename}`),
  };
}

beforeEach(async () => {
  projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), "fastifest-transaction-")),
  );
  config = await resolveConfig({}, { cwd: projectRoot });
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("commitGeneration", () => {
  it("creates assets and commits the manifest last on the first run", async () => {
    const renameDestinations: string[] = [];
    const result = await commitGeneration(
      config,
      template,
      makeIcons(),
      [makeScreenshot()],
      {
        logger: silentLogger,
        fileOperations: {
          rename: async (source, destination) => {
            renameDestinations.push(destination);
            await rename(source, destination);
          },
        },
      },
    );

    expect(result.manifestPath).toBe(config.manifestPath);
    expect(renameDestinations).toHaveLength(6);
    expect(renameDestinations.at(-1)).toBe(config.manifestPath);
    expect(renameDestinations.slice(0, -1)).not.toContain(config.manifestPath);
    expect(result.warnings).toEqual([]);
    await expect(readFile(config.manifestPath, "utf8")).resolves.toBe(
      result.json,
    );
    await expect(
      readFile(join(config.iconsOutputPath, "icon-192.png"), "utf8"),
    ).resolves.toBe("new:icon-192.png");
    await expect(
      readFile(join(config.screenshotsOutputPath, "screenshot-01.png"), "utf8"),
    ).resolves.toBe("new:screenshot-01.png");
    const manifest = JSON.parse(result.json) as {
      icons: Array<{ src: string }>;
      screenshots: Array<{ src: string }>;
    };
    expect(manifest.icons[0]?.src).toBe("icons/icon-192.png");
    expect(manifest.screenshots[0]?.src).toBe("screenshots/screenshot-01.png");
    await expect(readdir(config.iconsOutputPath)).resolves.toHaveLength(4);
    await expect(readdir(config.screenshotsOutputPath)).resolves.toEqual([
      "screenshot-01.png",
    ]);
  });

  it("replaces managed assets, commits a new manifest, then removes only stale screenshots", async () => {
    await mkdir(config.iconsOutputPath, { recursive: true });
    await mkdir(config.screenshotsOutputPath, { recursive: true });
    await writeFile(join(config.iconsOutputPath, "icon-192.png"), "old icon");
    await writeFile(
      join(config.screenshotsOutputPath, "screenshot-01.png"),
      "old screenshot",
    );
    await writeFile(
      join(config.screenshotsOutputPath, "screenshot-09.png"),
      "stale screenshot",
    );
    await writeFile(join(config.screenshotsOutputPath, "manual.txt"), "keep");
    await mkdir(config.publicRoot, { recursive: true });
    await writeFile(config.manifestPath, "old manifest\n");

    await commitGeneration(config, template, makeIcons(), [makeScreenshot()], {
      logger: silentLogger,
    });

    await expect(
      readFile(join(config.iconsOutputPath, "icon-192.png"), "utf8"),
    ).resolves.toBe("new:icon-192.png");
    await expect(
      readFile(join(config.screenshotsOutputPath, "screenshot-01.png"), "utf8"),
    ).resolves.toBe("new:screenshot-01.png");
    await expect(
      access(join(config.screenshotsOutputPath, "screenshot-09.png")),
    ).rejects.toThrow();
    await expect(
      readFile(join(config.screenshotsOutputPath, "manual.txt"), "utf8"),
    ).resolves.toBe("keep");
    await expect(readFile(config.manifestPath, "utf8")).resolves.not.toBe(
      "old manifest\n",
    );
    expect(await readdir(config.iconsOutputPath)).toHaveLength(4);
    expect((await readdir(config.screenshotsOutputPath)).sort()).toEqual([
      "manual.txt",
      "screenshot-01.png",
    ]);
  });

  it("fails overwrite-disabled conflicts before changing managed files or the manifest", async () => {
    const noOverwrite = await resolveConfig(
      { images: { overwrite: false } },
      { cwd: projectRoot },
    );
    await mkdir(noOverwrite.iconsOutputPath, { recursive: true });
    await mkdir(noOverwrite.publicRoot, { recursive: true });
    const iconPath = join(noOverwrite.iconsOutputPath, "icon-192.png");
    await writeFile(iconPath, "user icon");
    await writeFile(noOverwrite.manifestPath, "old manifest\n");

    await expect(
      commitGeneration(noOverwrite, template, makeIcons(), [], {
        logger: silentLogger,
      }),
    ).rejects.toMatchObject({ code: "OUTPUT_CONFLICT" });
    await expect(readFile(iconPath, "utf8")).resolves.toBe("user icon");
    await expect(readFile(noOverwrite.manifestPath, "utf8")).resolves.toBe(
      "old manifest\n",
    );
    await expect(access(noOverwrite.screenshotsOutputPath)).rejects.toThrow();
  });

  it("replaces an existing manifest when image overwrite is disabled and all managed assets are absent", async () => {
    const noOverwrite = await resolveConfig(
      { images: { overwrite: false } },
      { cwd: projectRoot },
    );
    await mkdir(noOverwrite.publicRoot, { recursive: true });
    await writeFile(noOverwrite.manifestPath, "old manifest\n");

    await expect(
      commitGeneration(noOverwrite, template, makeIcons(), [], {
        logger: silentLogger,
      }),
    ).resolves.toMatchObject({ manifestPath: noOverwrite.manifestPath });

    await expect(readFile(noOverwrite.manifestPath, "utf8")).resolves.not.toBe(
      "old manifest\n",
    );
    await expect(
      readFile(join(noOverwrite.iconsOutputPath, "icon-192.png"), "utf8"),
    ).resolves.toBe("new:icon-192.png");
  });

  it("restores previous assets and manifest when the manifest rename fails", async () => {
    await mkdir(config.iconsOutputPath, { recursive: true });
    await mkdir(config.screenshotsOutputPath, { recursive: true });
    await mkdir(config.publicRoot, { recursive: true });
    const oldIcon = join(config.iconsOutputPath, "icon-192.png");
    const oldStaleScreenshot = join(
      config.screenshotsOutputPath,
      "screenshot-09.png",
    );
    await writeFile(oldIcon, "old icon");
    await writeFile(oldStaleScreenshot, "old stale screenshot");
    await writeFile(config.manifestPath, "old manifest\n");

    let failManifestInstall = true;
    await expect(
      commitGeneration(config, template, makeIcons(), [], {
        logger: silentLogger,
        fileOperations: {
          rename: async (source, destination) => {
            if (
              failManifestInstall &&
              destination === config.manifestPath &&
              source.includes(".fastifest-stage-")
            ) {
              failManifestInstall = false;
              throw new Error("simulated manifest replacement failure");
            }
            await rename(source, destination);
          },
        },
      }),
    ).rejects.toMatchObject({ code: "IO_FAILED" });

    await expect(readFile(oldIcon, "utf8")).resolves.toBe("old icon");
    await expect(readFile(config.manifestPath, "utf8")).resolves.toBe(
      "old manifest\n",
    );
    await expect(readFile(oldStaleScreenshot, "utf8")).resolves.toBe(
      "old stale screenshot",
    );
    await expect(
      access(join(config.iconsOutputPath, "icon-512.png")),
    ).rejects.toThrow();
    expect(await readdir(config.iconsOutputPath)).toEqual(["icon-192.png"]);
    expect(await readdir(config.screenshotsOutputPath)).toEqual([
      "screenshot-09.png",
    ]);
    expect((await readdir(config.publicRoot)).sort()).toEqual([
      "icons",
      "manifest.json",
      "screenshots",
    ]);
  });

  it("preserves the previous manifest when a generated reference is missing before manifest commit", async () => {
    await mkdir(config.screenshotsOutputPath, { recursive: true });
    await mkdir(config.publicRoot, { recursive: true });
    const screenshotPath = join(
      config.screenshotsOutputPath,
      "screenshot-01.png",
    );
    await writeFile(screenshotPath, "old screenshot");
    await writeFile(config.manifestPath, "old manifest\n");

    let removedInstalledScreenshot = false;
    await expect(
      commitGeneration(config, template, makeIcons(), [makeScreenshot()], {
        logger: silentLogger,
        fileOperations: {
          rename: async (source, destination) => {
            await rename(source, destination);
            if (
              !removedInstalledScreenshot &&
              destination === screenshotPath &&
              source.includes(".fastifest-stage-")
            ) {
              removedInstalledScreenshot = true;
              await unlink(screenshotPath);
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: "IO_FAILED" });

    await expect(readFile(config.manifestPath, "utf8")).resolves.toBe(
      "old manifest\n",
    );
    await expect(readFile(screenshotPath, "utf8")).resolves.toBe(
      "old screenshot",
    );
    await expect(
      access(join(config.iconsOutputPath, "icon-192.png")),
    ).rejects.toThrow();
    expect((await readdir(config.publicRoot)).sort()).toEqual([
      "icons",
      "manifest.json",
      "screenshots",
    ]);
    await expect(readdir(config.iconsOutputPath)).resolves.toEqual([]);
  });

  it("reports stale cleanup failures as warnings after committing the manifest", async () => {
    await mkdir(config.screenshotsOutputPath, { recursive: true });
    const stalePath = join(config.screenshotsOutputPath, "screenshot-12.png");
    await writeFile(stalePath, "stale image");

    let replacedStaleWithDirectory = false;
    const result = await commitGeneration(config, template, makeIcons(), [], {
      logger: silentLogger,
      fileOperations: {
        rename: async (source, destination) => {
          if (
            !replacedStaleWithDirectory &&
            destination === config.manifestPath &&
            source.includes(".fastifest-stage-")
          ) {
            replacedStaleWithDirectory = true;
            await unlink(stalePath);
            await mkdir(stalePath);
            await writeFile(join(stalePath, "keep.txt"), "keep");
          }
          await rename(source, destination);
        },
      },
    });

    await expect(access(config.manifestPath)).resolves.toBeUndefined();
    await expect(readFile(join(stalePath, "keep.txt"), "utf8")).resolves.toBe(
      "keep",
    );
    expect(result.warnings).toContain(
      `Left stale screenshot that is not a regular file: ${stalePath}`,
    );
  });
});
