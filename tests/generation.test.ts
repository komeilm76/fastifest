import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateProject } from "../src/generation.js";
import { createLogger } from "../src/logger.js";
import { resolveConfig } from "../src/config/resolve.js";
import type { ResolvedFastifestConfig } from "../src/types.js";

let projectRoot: string;
let config: ResolvedFastifestConfig;
const silentLogger = createLogger("debug", () => {});

async function makePng(
  width: number,
  height: number,
  color = "#376fa5",
): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`,
  );
  return sharp(svg).png().toBuffer();
}

async function addLogo(color = "#376fa5"): Promise<void> {
  await mkdir(config.logosPath, { recursive: true });
  await writeFile(
    join(config.logosPath, "brand.png"),
    await makePng(512, 512, color),
  );
}

async function addScreenshot(): Promise<void> {
  await mkdir(config.screenshotsPath, { recursive: true });
  await writeFile(
    join(config.screenshotsPath, "home.png"),
    await makePng(320, 200),
  );
}

async function addTemplate(): Promise<void> {
  await writeFile(
    config.templatePath,
    `export default { name: "Integration App", start_url: "/", display: "standalone" };\n`,
  );
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "fastifest-generation-"));
  config = await resolveConfig({}, { cwd: projectRoot });
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("generateProject", () => {
  it("creates the starter and stops before discovery or output mutation on the first run", async () => {
    const result = await generateProject({
      cwd: projectRoot,
      logger: silentLogger,
    });

    expect(result).toMatchObject({
      status: "template-created",
      templatePath: config.templatePath,
    });
    if (result.status !== "template-created") {
      throw new Error("Expected template creation stop result");
    }
    expect(result.guidance).toContain("No manifest was generated");
    await expect(readFile(config.templatePath, "utf8")).resolves.toContain(
      'name: "My Web App"',
    );
    await expect(access(config.publicRoot)).rejects.toThrow();
  });

  it("runs discovery, image generation, manifest assembly, and transactional output", async () => {
    await addTemplate();
    await addLogo();
    await addScreenshot();

    const result = await generateProject({
      cwd: projectRoot,
      logger: silentLogger,
    });

    expect(result.status).toBe("generated");
    if (result.status !== "generated") throw new Error("Expected generation");
    expect(result.logoSource).toBe(join(config.logosPath, "brand.png"));
    expect(result.screenshotSources).toEqual([
      join(config.screenshotsPath, "home.png"),
    ]);
    expect(result.manifestPath).toBe(config.manifestPath);
    expect(result.warnings).toEqual([]);

    const manifest = JSON.parse(
      await readFile(config.manifestPath, "utf8"),
    ) as {
      icons: Array<{ src: string; sizes: string }>;
      screenshots: Array<{ src: string; sizes: string }>;
      name: string;
    };
    expect(manifest).toMatchObject({
      name: "Integration App",
      icons: [
        { src: "icons/icon-192.png", sizes: "192x192" },
        { src: "icons/icon-512.png", sizes: "512x512" },
        { src: "icons/icon-maskable-192.png", sizes: "192x192" },
        { src: "icons/icon-maskable-512.png", sizes: "512x512" },
      ],
      screenshots: [{ src: "screenshots/screenshot-01.png", sizes: "320x200" }],
    });
    await expect(
      readFile(join(config.iconsOutputPath, "icon-192.png")),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      readFile(join(config.screenshotsOutputPath, "screenshot-01.png")),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it("updates managed outputs on repeat runs and removes stale screenshots after manifest regeneration", async () => {
    await addTemplate();
    await addLogo();
    await addScreenshot();
    const first = await generateProject({
      cwd: projectRoot,
      logger: silentLogger,
    });
    if (first.status !== "generated")
      throw new Error("Expected first generation");
    const firstIcon = await readFile(
      join(config.iconsOutputPath, "icon-512.png"),
    );
    const firstManifest = await readFile(config.manifestPath, "utf8");

    await writeFile(
      config.templatePath,
      `export default { name: "Updated Integration App", start_url: "/", display: "standalone" };\n`,
    );
    await addLogo("#b83b5e");
    await rm(config.screenshotsPath, { recursive: true, force: true });
    await writeFile(
      join(config.screenshotsOutputPath, "screenshot-09.png"),
      "stale generated screenshot",
    );
    await writeFile(join(config.screenshotsOutputPath, "manual.txt"), "keep");

    const second = await generateProject({
      cwd: projectRoot,
      logger: silentLogger,
    });
    if (second.status !== "generated")
      throw new Error("Expected second generation");

    expect(second.value.name).toBe("Updated Integration App");
    expect(second.json).not.toBe(firstManifest);
    expect(second.warnings).toEqual([
      expect.stringContaining("Screenshot directory is missing"),
      "No screenshots were generated; the manifest screenshots member was omitted.",
    ]);
    expect(second.value).not.toHaveProperty("screenshots");
    await expect(
      readFile(join(config.iconsOutputPath, "icon-512.png")),
    ).resolves.not.toEqual(firstIcon);
    await expect(
      access(join(config.screenshotsOutputPath, "screenshot-01.png")),
    ).rejects.toThrow();
    await expect(
      access(join(config.screenshotsOutputPath, "screenshot-09.png")),
    ).rejects.toThrow();
    await expect(
      readFile(join(config.screenshotsOutputPath, "manual.txt"), "utf8"),
    ).resolves.toBe("keep");
    await expect(readFile(config.manifestPath, "utf8")).resolves.toBe(
      second.json,
    );
  });

  it("preserves the last successful output when overwrite is disabled", async () => {
    await addTemplate();
    await addLogo();
    await addScreenshot();
    const first = await generateProject({
      cwd: projectRoot,
      logger: silentLogger,
    });
    if (first.status !== "generated")
      throw new Error("Expected first generation");
    const previousManifest = await readFile(config.manifestPath, "utf8");
    const previousIcon = await readFile(
      join(config.iconsOutputPath, "icon-192.png"),
    );
    const previousScreenshot = await readFile(
      join(config.screenshotsOutputPath, "screenshot-01.png"),
    );

    await writeFile(
      config.templatePath,
      `export default { name: "Should Not Commit", start_url: "/", display: "standalone" };\n`,
    );
    await addLogo("#b83b5e");
    const noOverwriteConfig = join(projectRoot, "no-overwrite.config.ts");
    await writeFile(
      noOverwriteConfig,
      `export default { images: { overwrite: false } };\n`,
    );

    await expect(
      generateProject({
        cwd: projectRoot,
        configPath: noOverwriteConfig,
        logger: silentLogger,
      }),
    ).rejects.toMatchObject({ code: "OUTPUT_CONFLICT" });

    await expect(readFile(config.manifestPath, "utf8")).resolves.toBe(
      previousManifest,
    );
    await expect(
      readFile(join(config.iconsOutputPath, "icon-192.png")),
    ).resolves.toEqual(previousIcon);
    await expect(
      readFile(join(config.screenshotsOutputPath, "screenshot-01.png")),
    ).resolves.toEqual(previousScreenshot);
  });

  it("aggregates discovery and manifest warnings when no screenshots are present", async () => {
    await addTemplate();
    await addLogo();

    const result = await generateProject({
      cwd: projectRoot,
      logger: silentLogger,
    });

    expect(result.status).toBe("generated");
    if (result.status !== "generated") throw new Error("Expected generation");
    expect(result.warnings).toEqual([
      expect.stringContaining("Screenshot directory is missing"),
      "No screenshots were generated; the manifest screenshots member was omitted.",
    ]);
    expect(result.value).not.toHaveProperty("screenshots");
  });

  it("preserves the previous manifest when input discovery fails", async () => {
    await addTemplate();
    await mkdir(config.iconsOutputPath, { recursive: true });
    await mkdir(config.publicRoot, { recursive: true });
    const existingIconPath = join(config.iconsOutputPath, "icon-192.png");
    await writeFile(existingIconPath, "previous icon");
    await writeFile(config.manifestPath, "previous manifest\n");

    await expect(
      generateProject({ cwd: projectRoot, logger: silentLogger }),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    await expect(readFile(config.manifestPath, "utf8")).resolves.toBe(
      "previous manifest\n",
    );
    await expect(readFile(existingIconPath, "utf8")).resolves.toBe(
      "previous icon",
    );
  });

  it("honors an explicit config path when resolving the project pipeline", async () => {
    const configFile = join(projectRoot, "custom.config.ts");
    await writeFile(
      configFile,
      `export default { template: { path: "./metadata/app.ts" } };\n`,
    );
    const customTemplate = join(projectRoot, "metadata", "app.ts");
    await mkdir(join(projectRoot, "assets", "logos"), { recursive: true });
    await mkdir(join(projectRoot, "metadata"), { recursive: true });
    await writeFile(customTemplate, `export default { name: "Custom App" };\n`);
    await writeFile(
      join(projectRoot, "assets", "logos", "brand.png"),
      await makePng(512, 512),
    );

    const result = await generateProject({
      cwd: projectRoot,
      configPath: configFile,
      logger: silentLogger,
    });

    expect(result.status).toBe("generated");
    if (result.status !== "generated") throw new Error("Expected generation");
    expect(result.value.name).toBe("Custom App");
    await access(customTemplate);
  });
});
