import sharp from "sharp";
import { FastifestError } from "../errors.js";
import { readDiscoveredImage } from "../discovery/index.js";
import { MAX_RASTER_PIXELS } from "../discovery/limits.js";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";
import type { DiscoveredImage } from "../discovery/index.js";

const ICON_SIZES = [192, 512] as const;
const CONTENT_FRACTION = 0.8;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;

export type LogoIconPurpose = "any" | "maskable";

/** One generated square PNG icon, ready for the later output/manifest stage. */
export interface GeneratedLogoIcon {
  filename: string;
  size: number;
  purpose: LogoIconPurpose;
  mimeType: "image/png";
  buffer: Buffer;
}

export interface GenerateLogoIconsOptions {
  logger?: Logger;
}

export interface GeneratedLogoIcons {
  icons: GeneratedLogoIcon[];
  warnings: string[];
}

interface FitSize {
  width: number;
  height: number;
  scale: number;
}

function dimensionsFor(
  sourceWidth: number,
  sourceHeight: number,
  canvasSize: number,
  maskable: boolean,
): FitSize {
  const allowedDiagonal = CONTENT_FRACTION * canvasSize;
  const denominator = maskable
    ? Math.hypot(sourceWidth, sourceHeight)
    : Math.max(sourceWidth, sourceHeight);
  const scale = allowedDiagonal / denominator;
  const width = Math.max(1, Math.floor(sourceWidth * scale));
  const height = Math.max(1, Math.floor(sourceHeight * scale));
  return { width, height, scale };
}

function filenameFor(size: number, purpose: LogoIconPurpose): string {
  if (purpose === "maskable") return `icon-maskable-${size}.png`;
  return `icon-${size}.png`;
}

async function renderIcon(
  source: Buffer,
  image: DiscoveredImage,
  sourceWidth: number,
  sourceHeight: number,
  size: number,
  purpose: LogoIconPurpose,
): Promise<GeneratedLogoIcon> {
  const fit = dimensionsFor(
    sourceWidth,
    sourceHeight,
    size,
    purpose === "maskable",
  );
  const left = Math.floor((size - fit.width) / 2);
  const top = Math.floor((size - fit.height) / 2);
  const right = size - fit.width - left;
  const bottom = size - fit.height - top;

  try {
    const options =
      image.format === "svg"
        ? { failOn: "warning" as const }
        : {
            failOn: "warning" as const,
            limitInputPixels: MAX_RASTER_PIXELS,
          };
    const { data, info } = await sharp(source, options)
      .rotate()
      .resize({ width: fit.width, height: fit.height, fit: "fill" })
      .extend({ top, left, bottom, right, background: TRANSPARENT })
      .toColourspace("srgb")
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer({ resolveWithObject: true });

    if (info.width !== size || info.height !== size || info.format !== "png") {
      throw new Error(
        "Image library returned unexpected icon dimensions or format.",
      );
    }
    return {
      filename: filenameFor(size, purpose),
      size,
      purpose,
      mimeType: "image/png",
      buffer: data,
    };
  } catch (error) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `Could not generate ${purpose} ${size}x${size} icon from ${image.sourcePath}.`,
      error,
    );
  }
}

/** Generate the fixed PNG icon set without writing files. */
export async function generateLogoIcons(
  image: DiscoveredImage,
  options: GenerateLogoIconsOptions = {},
): Promise<GeneratedLogoIcons> {
  const logger = options.logger ?? createLogger("info");
  const warnings: string[] = [];
  const source = await readDiscoveredImage(image);

  let metadata;
  try {
    metadata = await sharp(source, { failOn: "warning" }).metadata();
  } catch (error) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `Could not read oriented source dimensions: ${image.sourcePath}`,
      error,
    );
  }

  const sourceWidth = metadata.autoOrient?.width ?? metadata.width;
  const sourceHeight = metadata.autoOrient?.height ?? metadata.height;
  if (
    sourceWidth === undefined ||
    sourceHeight === undefined ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new FastifestError(
      "IMAGE_INVALID",
      `Source image has no usable dimensions: ${image.sourcePath}`,
    );
  }

  if (image.format !== "svg") {
    for (const size of ICON_SIZES) {
      const standardFit = dimensionsFor(sourceWidth, sourceHeight, size, false);
      if (standardFit.scale > 1) {
        const warning = `Logo source is too small for ${size}x${size} icons and will be upscaled; upscaling cannot restore detail: ${image.sourcePath}`;
        warnings.push(warning);
        logger.warn(warning);
      }
    }
  }

  const icons: GeneratedLogoIcon[] = [];
  for (const size of ICON_SIZES) {
    icons.push(
      await renderIcon(source, image, sourceWidth, sourceHeight, size, "any"),
    );
  }
  for (const size of ICON_SIZES) {
    icons.push(
      await renderIcon(
        source,
        image,
        sourceWidth,
        sourceHeight,
        size,
        "maskable",
      ),
    );
  }

  return { icons, warnings };
}
