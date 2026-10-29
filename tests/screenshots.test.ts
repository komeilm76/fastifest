import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/resolve.js";
import { discoverInputs } from "../src/discovery/index.js";
import {
  generateScreenshots,
  MAX_SCREENSHOT_SIDE,
} from "../src/images/screenshots.js";
import { createLogger } from "../src/logger.js";
import type { ResolvedFastifestConfig } from "../src/types.js";

let projectRoot: string;
let config: ResolvedFastifestConfig;
const silentLogger = createLogger("debug", () => {});

async function makePng(
  width: number,
  height: number,
  color = "#3870a8",
): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`,
  );
  return sharp(svg).png().toBuffer();
}

async function addScreenshot(name: string, bytes: Buffer): Promise<void> {
  await mkdir(config.screenshotsPath, { recursive: true });
  await writeFile(join(config.screenshotsPath, name), bytes);
}

async function discoverScreenshots(
  configToUse: ResolvedFastifestConfig = config,
) {
  await mkdir(configToUse.logosPath, { recursive: true });
  await writeFile(
    join(configToUse.logosPath, "brand.png"),
    await makePng(4, 4),
  );
  return (await discoverInputs(configToUse, { logger: silentLogger }))
    .screenshots;
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "fastifest-screenshots-"));
  config = await resolveConfig({}, { cwd: projectRoot });
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("generateScreenshots", () => {
  it("converts supported inputs to deterministic PNGs in discovery order", async () => {
    await addScreenshot(
      "z.JPG",
      await sharp(await makePng(60, 30))
        .jpeg()
        .toBuffer(),
    );
    await addScreenshot("a.png", await makePng(80, 40));
    const inputs = await discoverScreenshots();
    const generated = await generateScreenshots(inputs);

    expect(generated.map((image) => image.filename)).toEqual([
      "screenshot-01.png",
      "screenshot-02.png",
    ]);
    expect(generated.map((image) => image.sourceBasename)).toEqual([
      "a.png",
      "z.JPG",
    ]);
    expect(generated.map((image) => [image.width, image.height])).toEqual([
      [80, 40],
      [60, 30],
    ]);
    for (const image of generated) {
      expect(image.mimeType).toBe("image/png");
      await expect(sharp(image.buffer).metadata()).resolves.toMatchObject({
        format: "png",
        width: image.width,
        height: image.height,
        space: "srgb",
      });
    }
  });

  it("does not upscale small inputs and proportionally reduces oversized screenshots", async () => {
    await addScreenshot("small.png", await makePng(320, 200));
    const small = await generateScreenshots(await discoverScreenshots());
    expect(small[0]).toMatchObject({ width: 320, height: 200 });

    await rm(config.screenshotsPath, { recursive: true, force: true });
    await addScreenshot("wide.png", await makePng(5_000, 100));
    const large = await generateScreenshots(await discoverScreenshots());
    expect(large[0]!.width).toBe(MAX_SCREENSHOT_SIDE);
    expect(large[0]!.height).toBeLessThanOrEqual(82);
    expect(large[0]!.height).toBeGreaterThan(0);
    expect(large[0]!.width / large[0]!.height).toBeCloseTo(50, 0);
  });

  it("applies EXIF orientation before measuring and converting JPEG screenshots", async () => {
    const raw = Buffer.alloc(20 * 40 * 3, 180);
    const jpeg = await sharp(raw, {
      raw: { width: 20, height: 40, channels: 3 },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    await addScreenshot("oriented.jpg", jpeg);
    const inputs = await discoverScreenshots();
    expect(inputs[0]!.orientation).toBe(6);
    const output = (await generateScreenshots(inputs))[0]!;

    expect(output).toMatchObject({ width: 40, height: 20 });
    const metadata = await sharp(output.buffer).metadata();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it("converts CMYK screenshot pixels to sRGB values", async () => {
    const source = await sharp({
      create: {
        width: 64,
        height: 48,
        channels: 3,
        background: { r: 30, g: 130, b: 210 },
      },
    })
      .toColourspace("cmyk")
      .jpeg({ quality: 100 })
      .toBuffer();
    await addScreenshot("cmyk.jpg", source);
    const inputs = await discoverScreenshots();
    const screenshot = (await generateScreenshots(inputs))[0]!;
    const expected = await sharp(source)
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer();
    const { data, info } = await sharp(screenshot.buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const outputOffset =
      (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) *
      info.channels;

    expect((await sharp(screenshot.buffer).metadata()).space).toBe("srgb");
    for (let channel = 0; channel < 3; channel += 1) {
      expect(
        Math.abs(
          data[outputOffset + channel]! -
            expected[24 * 64 * 4 + 32 * 4 + channel]!,
        ),
      ).toBeLessThanOrEqual(5);
    }
    expect(data[outputOffset + 3]).toBe(255);
  });

  it("preserves screenshot alpha and carries only explicitly authored annotations", async () => {
    const width = 20;
    const height = 16;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 4; y < 12; y += 1) {
      for (let x = 5; x < 15; x += 1) {
        const offset = (y * width + x) * 4;
        raw[offset] = 200;
        raw[offset + 1] = 80;
        raw[offset + 2] = 30;
        raw[offset + 3] = 255;
      }
    }
    const transparentPng = await sharp(raw, {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer();
    await addScreenshot("home.png", transparentPng);
    const annotatedConfig = await resolveConfig(
      {
        screenshots: {
          metadata: {
            "home.png": { label: "Home screen", formFactor: "narrow" },
          },
        },
      },
      { cwd: projectRoot },
    );
    const screenshotInputs = await discoverScreenshots(annotatedConfig);
    const output = (await generateScreenshots(screenshotInputs))[0]!;
    const outputMetadata = await sharp(output.buffer).metadata();
    const pixels = await sharp(output.buffer).ensureAlpha().raw().toBuffer();

    expect(output).toMatchObject({
      label: "Home screen",
      formFactor: "narrow",
      width,
      height,
    });
    expect(outputMetadata.hasAlpha).toBe(true);
    expect(outputMetadata.exif).toBeUndefined();
    expect(pixels[3]).toBe(0);
    expect(pixels[((height / 2) * width + width / 2) * 4 + 3]).toBe(255);
  });

  it("returns an empty list when discovery found no screenshots", async () => {
    await expect(generateScreenshots([])).resolves.toEqual([]);
  });

  it("rejects a source that changes after discovery", async () => {
    await addScreenshot("home.png", await makePng(40, 20));
    const inputs = await discoverScreenshots();
    const sourcePath = inputs[0]!.sourcePath;
    await writeFile(sourcePath, await makePng(40, 20, "#d12e36"));
    await expect(generateScreenshots(inputs)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});
