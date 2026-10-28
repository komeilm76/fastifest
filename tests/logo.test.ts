import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/resolve.js";
import { discoverInputs } from "../src/discovery/index.js";
import { createLogger } from "../src/logger.js";
import { generateLogoIcons } from "../src/images/logo.js";
import type { GeneratedLogoIcon } from "../src/images/logo.js";
import type { ResolvedFastifestConfig } from "../src/types.js";

let projectRoot: string;
let config: ResolvedFastifestConfig;
const silentLogger = createLogger("debug", () => {});

async function makeRaster(
  width: number,
  height: number,
  color: { r: number; g: number; b: number; alpha: number } = {
    r: 30,
    g: 90,
    b: 160,
    alpha: 1,
  },
): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < raw.length; offset += 4) {
    raw[offset] = color.r;
    raw[offset + 1] = color.g;
    raw[offset + 2] = color.b;
    raw[offset + 3] = Math.round(color.alpha * 255);
  }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function addLogo(source: Buffer, basename = "logo.png"): Promise<void> {
  await mkdir(config.logosPath, { recursive: true });
  await writeFile(join(config.logosPath, basename), source);
}

async function generate(source: Buffer, basename = "logo.png") {
  await addLogo(source, basename);
  const discovered = await discoverInputs(config, { logger: silentLogger });
  return generateLogoIcons(discovered.logo, { logger: silentLogger });
}

interface AlphaBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

async function alphaBounds(icon: GeneratedLogoIcon): Promise<AlphaBounds> {
  const { data, info } = await sharp(icon.buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3]!;
      if (alpha > 0) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "fastifest-logo-"));
  config = await resolveConfig({}, { cwd: projectRoot });
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("generateLogoIcons", () => {
  it("generates the four fixed square PNG icons in stable order", async () => {
    const generated = await generate(await makeRaster(600, 300));

    expect(generated.icons.map((icon) => icon.filename)).toEqual([
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-192.png",
      "icon-maskable-512.png",
    ]);
    expect(generated.icons.map((icon) => [icon.size, icon.purpose])).toEqual([
      [192, "any"],
      [512, "any"],
      [192, "maskable"],
      [512, "maskable"],
    ]);
    expect(generated.icons.every((icon) => icon.mimeType === "image/png")).toBe(
      true,
    );
    expect(generated.warnings).toEqual([]);

    for (const icon of generated.icons) {
      await expect(sharp(icon.buffer).metadata()).resolves.toMatchObject({
        format: "png",
        width: icon.size,
        height: icon.size,
        space: "srgb",
        channels: 4,
        hasAlpha: true,
      });
    }
  });

  it("preserves aspect ratio and centers the artwork on a transparent canvas", async () => {
    const generated = await generate(await makeRaster(40, 20));
    const standard = generated.icons[0]!;
    const bounds = await alphaBounds(standard);

    expect(bounds.width / bounds.height).toBeCloseTo(2, 1);
    expect(
      Math.abs(bounds.left - (standard.size - bounds.right - 1)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(bounds.top - (standard.size - bounds.bottom - 1)),
    ).toBeLessThanOrEqual(1);
    const raw = await sharp(standard.buffer).ensureAlpha().raw().toBuffer();
    expect(raw[3]).toBe(0);
  });

  it("keeps maskable artwork inside the central 80-percent safe circle", async () => {
    const generated = await generate(await makeRaster(80, 80));
    const maskable = generated.icons.find(
      (icon) => icon.filename === "icon-maskable-192.png",
    )!;
    const { data, info } = await sharp(maskable.buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const center = (maskable.size - 1) / 2;
    const safeRadius = maskable.size * 0.4;
    let opaquePixels = 0;

    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const alpha = data[(y * info.width + x) * info.channels + 3]!;
        if (alpha > 0) {
          opaquePixels += 1;
          expect(Math.hypot(x - center, y - center)).toBeLessThanOrEqual(
            safeRadius + 0.5,
          );
        }
      }
    }
    expect(opaquePixels).toBeGreaterThan(0);
  });

  it("applies EXIF orientation before fitting a JPEG logo", async () => {
    const raw = Buffer.alloc(20 * 40 * 3, 180);
    const jpeg = await sharp(raw, {
      raw: { width: 20, height: 40, channels: 3 },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    await addLogo(jpeg, "oriented.jpg");
    const discovered = await discoverInputs(config, { logger: silentLogger });
    expect(discovered.logo.orientation).toBe(6);
    const generated = await generateLogoIcons(discovered.logo, {
      logger: silentLogger,
    });
    const bounds = await alphaBounds(generated.icons[0]!);

    expect(bounds.width / bounds.height).toBeCloseTo(2, 1);
    const outputMetadata = await sharp(generated.icons[0]!.buffer).metadata();
    expect(outputMetadata.format).toBe("png");
    expect(outputMetadata.orientation).toBeUndefined();
    expect(outputMetadata.exif).toBeUndefined();
  });

  it("preserves transparent source artwork and transparent padding", async () => {
    const size = 32;
    const raw = Buffer.alloc(size * size * 4);
    for (let y = 8; y < 24; y += 1) {
      for (let x = 8; x < 24; x += 1) {
        const offset = (y * size + x) * 4;
        raw[offset] = 220;
        raw[offset + 1] = 40;
        raw[offset + 2] = 20;
        raw[offset + 3] = 255;
      }
    }
    const source = await sharp(raw, {
      raw: { width: size, height: size, channels: 4 },
    })
      .png()
      .toBuffer();
    const generated = await generate(source);
    const icon = generated.icons[0]!;
    const pixels = await sharp(icon.buffer).ensureAlpha().raw().toBuffer();

    expect(pixels[3]).toBe(0);
    expect(pixels[((icon.size / 2) * icon.size + icon.size / 2) * 4 + 3]).toBe(
      255,
    );
    expect((await sharp(icon.buffer).metadata()).hasAlpha).toBe(true);
  });

  it("warns once per output size when a raster logo must be upscaled", async () => {
    const generated = await generate(await makeRaster(16, 16));
    expect(generated.warnings).toHaveLength(2);
    expect(generated.warnings[0]).toContain("192x192");
    expect(generated.warnings[1]).toContain("512x512");
  });

  it("does not issue raster upscaling warnings for vector logos", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="#336699"/></svg>',
    );
    const generated = await generate(svg, "logo.svg");
    expect(generated.warnings).toEqual([]);
    expect(generated.icons).toHaveLength(4);
  });
});
