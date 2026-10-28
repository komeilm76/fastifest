import sharp, { type OutputInfo } from "sharp";
import { FastifestError } from "../errors.js";
import { readDiscoveredImage } from "../discovery/index.js";
import { MAX_RASTER_PIXELS } from "../discovery/limits.js";
import type { DiscoveredImage } from "../discovery/index.js";

export const MAX_SCREENSHOT_SIDE = 4_096;

/** Processed screenshot bytes and metadata for manifest construction. */
export interface GeneratedScreenshot {
  filename: string;
  sourceBasename: string;
  width: number;
  height: number;
  mimeType: "image/png";
  buffer: Buffer;
  label?: string;
  formFactor?: "narrow" | "wide";
}

/** Convert screenshots sequentially, preserving input order and authored annotations. */
export async function generateScreenshots(
  inputs: readonly DiscoveredImage[],
): Promise<GeneratedScreenshot[]> {
  const generated: GeneratedScreenshot[] = [];

  for (const [index, image] of inputs.entries()) {
    if (image.format === "svg") {
      throw new FastifestError(
        "INPUT_INVALID",
        `SVG screenshots are not supported: ${image.sourcePath}`,
      );
    }
    const source = await readDiscoveredImage(image);
    let result: OutputInfo;
    let data: Buffer;
    try {
      const processed = await sharp(source, {
        failOn: "warning",
        limitInputPixels: MAX_RASTER_PIXELS,
      })
        .rotate()
        .resize({
          width: MAX_SCREENSHOT_SIDE,
          height: MAX_SCREENSHOT_SIDE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .toColourspace("srgb")
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toBuffer({ resolveWithObject: true });
      data = processed.data;
      result = processed.info;
    } catch (error) {
      throw new FastifestError(
        "IMAGE_INVALID",
        `Could not convert screenshot ${image.sourcePath} to PNG.`,
        error,
      );
    }

    if (
      result.format !== "png" ||
      result.width < 1 ||
      result.height < 1 ||
      result.width > MAX_SCREENSHOT_SIDE ||
      result.height > MAX_SCREENSHOT_SIDE
    ) {
      throw new FastifestError(
        "IMAGE_INVALID",
        `Screenshot conversion returned invalid output dimensions (${result.width}x${result.height}): ${image.sourcePath}`,
      );
    }

    const screenshot: GeneratedScreenshot = {
      filename: `screenshot-${String(index + 1).padStart(2, "0")}.png`,
      sourceBasename: image.basename,
      width: result.width,
      height: result.height,
      mimeType: "image/png",
      buffer: data,
    };
    if (image.annotation?.label !== undefined) {
      screenshot.label = image.annotation.label;
    }
    if (image.annotation?.formFactor !== undefined) {
      screenshot.formFactor = image.annotation.formFactor;
    }
    generated.push(screenshot);
  }

  return generated;
}
