import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareSourceBasenames,
  discoverInputs,
  readDiscoveredImage,
} from "../src/discovery/index.js";
import {
  MAX_RASTER_FILE_BYTES,
  MAX_RASTER_PIXELS,
  MAX_RASTER_SIDE,
  MAX_SVG_FILE_BYTES,
} from "../src/discovery/limits.js";
import { createLogger } from "../src/logger.js";
import { resolveConfig } from "../src/config/resolve.js";
import type { ResolvedFastifestConfig } from "../src/types.js";

let projectRoot: string;
let config: ResolvedFastifestConfig;
const silentLogger = createLogger("debug", () => {});

const svgSource = (width = 4, height = 3): Buffer =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#336699"/></svg>`,
  );

async function makePng(): Promise<Buffer> {
  return sharp(svgSource()).png().toBuffer();
}

async function makeJpeg(): Promise<Buffer> {
  return sharp(svgSource()).jpeg().toBuffer();
}

async function addLogo(name = "brand.png", image?: Buffer): Promise<void> {
  await mkdir(config.logosPath, { recursive: true });
  await writeFile(join(config.logosPath, name), image ?? (await makePng()));
}

async function addScreenshot(name: string, image: Buffer): Promise<void> {
  await mkdir(config.screenshotsPath, { recursive: true });
  await writeFile(join(config.screenshotsPath, name), image);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function pngWithDimensions(
  width: number,
  height: number,
): Promise<Buffer> {
  const png = Buffer.from(await makePng());
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
  return png;
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "fastifest-discovery-"));
  config = await resolveConfig({}, { cwd: projectRoot });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("compareSourceBasenames", () => {
  it("sorts by NFC lowercase code points, then normalized and raw code points", () => {
    const names = ["z.png", "é.png", "a.png", "A.png", "e\u0301.png"];
    expect(names.sort(compareSourceBasenames)).toEqual([
      "A.png",
      "a.png",
      "z.png",
      "e\u0301.png",
      "é.png",
    ]);
  });
});

describe("discoverInputs", () => {
  it("discovers one logo and sorts supported screenshot extensions deterministically", async () => {
    await addLogo("Brand.PNG");
    await addScreenshot("z.JPG", await makeJpeg());
    await addScreenshot("a.png", await makePng());
    await addScreenshot("Home.JpEg", await makeJpeg());

    const result = await discoverInputs(config);

    expect(result.logo).toMatchObject({
      basename: "Brand.PNG",
      normalizedBasename: "Brand.PNG",
      extension: ".png",
      format: "png",
      width: 4,
      height: 3,
    });
    expect(result.screenshots.map((image) => image.basename)).toEqual([
      "a.png",
      "Home.JpEg",
      "z.JPG",
    ]);
    expect(result.screenshots.map((image) => image.format)).toEqual([
      "png",
      "jpeg",
      "jpeg",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("rechecks discovered source bytes before later processing", async () => {
    const original = await makePng();
    await addLogo("brand.png", original);
    const result = await discoverInputs(config, { logger: silentLogger });
    await expect(readDiscoveredImage(result.logo)).resolves.toEqual(original);

    const changed = Buffer.from(original);
    changed[changed.length - 1]! ^= 1;
    await writeFile(result.logo.sourcePath, changed);
    await expect(readDiscoveredImage(result.logo)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("reports unsupported entries once per directory and never recurses", async () => {
    await addLogo();
    await writeFile(join(config.logosPath, "notes.txt"), "ignored");
    await mkdir(join(config.screenshotsPath, "nested"), { recursive: true });
    await writeFile(
      join(config.screenshotsPath, "nested", "hidden.png"),
      await makePng(),
    );
    await writeFile(join(config.screenshotsPath, "notes.txt"), "ignored");

    const logged: string[] = [];
    const result = await discoverInputs(config, {
      logger: createLogger("debug", (_level, message) => logged.push(message)),
    });

    expect(result.screenshots).toEqual([]);
    expect(result.warnings).toHaveLength(3);
    expect(logged).toEqual(result.warnings);
    expect(
      result.warnings.filter((warning) => warning.includes("unsupported")),
    ).toHaveLength(2);
  });

  it("warns and returns no screenshots when the optional directory is missing", async () => {
    await addLogo();
    const result = await discoverInputs(config, { logger: silentLogger });
    expect(result.screenshots).toEqual([]);
    expect(result.warnings[0]).toContain("Screenshot directory is missing");
  });

  it("warns when the optional screenshot directory exists but is empty", async () => {
    await addLogo();
    await mkdir(config.screenshotsPath, { recursive: true });
    const result = await discoverInputs(config, { logger: silentLogger });
    expect(result.screenshots).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining("Screenshot directory is empty"),
    ]);
  });

  it("fails if the required logo directory is missing or has no supported logo", async () => {
    await expect(discoverInputs(config)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });

    await mkdir(config.logosPath, { recursive: true });
    await writeFile(join(config.logosPath, "notes.txt"), "ignored");
    await expect(
      discoverInputs(config, { logger: silentLogger }),
    ).rejects.toThrowError("found none");
  });

  it("requires exactly one supported logo and reports sorted candidates", async () => {
    await addLogo("z.png");
    await writeFile(join(config.logosPath, "a.jpg"), await makeJpeg());

    await expect(discoverInputs(config)).rejects.toThrowError(
      "found 2: a.jpg, z.png",
    );
  });

  it("fails on corrupt supported images and extension/content mismatches", async () => {
    await addLogo("corrupt.png", Buffer.from("not a png"));
    await expect(discoverInputs(config)).rejects.toMatchObject({
      code: "IMAGE_INVALID",
    });

    await rm(config.logosPath, { recursive: true, force: true });
    await addLogo("wrong.jpg", await makePng());
    await expect(discoverInputs(config)).rejects.toThrowError(
      "does not match detected png image format",
    );
  });

  it("rejects a supported input symlink instead of following it", async () => {
    if (process.platform === "win32") return;
    await mkdir(config.logosPath, { recursive: true });
    const outside = join(projectRoot, "outside.png");
    await writeFile(outside, await makePng());
    await symlink(outside, join(config.logosPath, "brand.png"));

    await expect(discoverInputs(config)).rejects.toMatchObject({
      code: "UNSAFE_PATH",
    });
  });

  it("rejects a symlinked parent component of an input directory", async () => {
    const externalRoot = join(projectRoot, "external-assets");
    await mkdir(join(externalRoot, "logos"), { recursive: true });
    await writeFile(join(externalRoot, "logos", "brand.png"), await makePng());
    await symlink(
      externalRoot,
      join(projectRoot, "assets"),
      process.platform === "win32" ? "junction" : undefined,
    );

    await expect(discoverInputs(config)).rejects.toMatchObject({
      code: "UNSAFE_PATH",
    });
  });

  it("rejects raster and SVG files larger than their byte limits before reading", async () => {
    await mkdir(config.logosPath, { recursive: true });
    const oversizedRaster = join(config.logosPath, "large.png");
    await writeFile(oversizedRaster, "x");
    await truncate(oversizedRaster, MAX_RASTER_FILE_BYTES + 1);
    await expect(discoverInputs(config)).rejects.toMatchObject({
      code: "INPUT_LIMIT",
    });

    await rm(config.logosPath, { recursive: true, force: true });
    await mkdir(config.logosPath, { recursive: true });
    const oversizedSvg = join(config.logosPath, "large.svg");
    await writeFile(oversizedSvg, "x");
    await truncate(oversizedSvg, MAX_SVG_FILE_BYTES + 1);
    await expect(discoverInputs(config)).rejects.toMatchObject({
      code: "INPUT_LIMIT",
    });
  });

  it("accepts valid raster images exactly at the maximum side and pixel limits", async () => {
    const edgeSideImage = await sharp({
      create: {
        width: MAX_RASTER_SIDE,
        height: 1,
        channels: 3,
        background: "#336699",
      },
    })
      .png()
      .toBuffer();
    await addLogo("edge.png", edgeSideImage);

    await expect(
      discoverInputs(config, { logger: silentLogger }),
    ).resolves.toMatchObject({
      logo: { width: MAX_RASTER_SIDE, height: 1 },
    });

    await rm(config.logosPath, { recursive: true, force: true });
    const edgePixelImage = await sharp({
      create: {
        width: 10_000,
        height: 4_000,
        channels: 3,
        background: { r: 51, g: 102, b: 153 },
      },
    })
      .png()
      .toBuffer();
    await addLogo("edge-pixels.png", edgePixelImage);

    await expect(
      discoverInputs(config, { logger: silentLogger }),
    ).resolves.toMatchObject({
      logo: { width: 10_000, height: 4_000 },
    });
  });

  it("rejects raster images exceeding decoded side or pixel limits", async () => {
    await addLogo("wide.png", await pngWithDimensions(MAX_RASTER_SIDE + 1, 1));
    await expect(discoverInputs(config)).rejects.toMatchObject({
      code: "INPUT_LIMIT",
    });

    await rm(config.logosPath, { recursive: true, force: true });
    await addLogo(
      "pixels.png",
      await pngWithDimensions(7_000, Math.floor(MAX_RASTER_PIXELS / 7_000) + 1),
    );
    await expect(discoverInputs(config)).rejects.toMatchObject({
      code: "INPUT_LIMIT",
    });
  });

  it("rejects SVG external references while allowing self-contained artwork", async () => {
    await addLogo("brand.svg", svgSource());
    await expect(
      discoverInputs(config, { logger: silentLogger }),
    ).resolves.toMatchObject({
      logo: { format: "svg", width: 4, height: 3 },
    });

    await rm(config.logosPath, { recursive: true, force: true });
    const unsafe = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><image href="https://example.invalid/a.png"/></svg>',
    );
    await addLogo("brand.svg", unsafe);
    await expect(discoverInputs(config)).rejects.toThrowError(
      "external resource reference",
    );
  });

  it("enforces raster limits on base64 images embedded in SVG", async () => {
    const validEmbeddedImage = await makePng();
    await addLogo(
      "brand.svg",
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><image href="data:image/png;base64,${validEmbeddedImage.toString("base64").replace(/=+$/, "")}" width="4" height="3"/></svg>`,
      ),
    );
    await expect(
      discoverInputs(config, { logger: silentLogger }),
    ).resolves.toMatchObject({ logo: { format: "svg" } });

    await rm(config.logosPath, { recursive: true, force: true });
    const tooWide = await pngWithDimensions(MAX_RASTER_SIDE + 1, 1);
    await addLogo(
      "brand.svg",
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><image href="data:image/png;base64,${tooWide.toString("base64")}" width="4" height="3"/></svg>`,
      ),
    );
    await expect(
      discoverInputs(config, { logger: silentLogger }),
    ).rejects.toMatchObject({
      code: "INPUT_LIMIT",
      message: expect.stringContaining("maximum side"),
    });

    await rm(config.logosPath, { recursive: true, force: true });
    const tooManyPixels = await pngWithDimensions(
      7_000,
      Math.floor(MAX_RASTER_PIXELS / 7_000) + 1,
    );
    await addLogo(
      "brand.svg",
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><style>.x{fill:url(data:image/png;base64,${tooManyPixels.toString("base64")})}</style><rect class="x" width="4" height="3"/></svg>`,
      ),
    );
    await expect(
      discoverInputs(config, { logger: silentLogger }),
    ).rejects.toMatchObject({
      code: "INPUT_LIMIT",
      message: expect.stringContaining("pixel limit"),
    });
  });

  it("rejects CSS-escaped and comment-obfuscated SVG external references", async () => {
    const unsafeSources = [
      {
        source: String.raw`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><style>.x{fill:u\72l(https://example.invalid/a.svg#paint)}</style><rect class="x" width="4" height="3"/></svg>`,
        error: "external CSS resource reference",
      },
      {
        source:
          '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><style>.x{fill:u/**/rl(https://example.invalid/a.svg#paint)}</style><rect class="x" width="4" height="3"/></svg>',
        error: "external CSS resource reference",
      },
      {
        source: String.raw`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><style>@\69mport url(https://example.invalid/a.css);</style><rect width="4" height="3"/></svg>`,
        error: "prohibited external-resource",
      },
      {
        source:
          '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><style>u&#x72;l(https://example.invalid/a.svg#paint)</style><rect width="4" height="3"/></svg>',
        error: "external CSS resource reference",
      },
      {
        source: String.raw`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><style>u\
rl(https://example.invalid/a.svg#paint)</style><rect width="4" height="3"/></svg>`,
        error: "external CSS resource reference",
      },
    ];

    for (const { source, error } of unsafeSources) {
      await rm(config.logosPath, { recursive: true, force: true });
      await addLogo("brand.svg", Buffer.from(source));
      await expect(discoverInputs(config)).rejects.toThrowError(error);
    }

    await rm(config.logosPath, { recursive: true, force: true });
    await addLogo(
      "brand.svg",
      Buffer.from(
        String.raw`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><defs><linearGradient id="paint"><stop stop-color="#336699"/></linearGradient></defs><style>.x{fill:u\72l(#paint)}</style><rect class="x" width="4" height="3"/></svg>`,
      ),
    );
    await expect(discoverInputs(config)).resolves.toMatchObject({
      logo: { format: "svg" },
    });
  });

  it("attaches exact-basename screenshot annotations and rejects unmatched keys", async () => {
    await addLogo();
    await addScreenshot("home.png", await makePng());
    const withMetadata = await resolveConfig(
      {
        screenshots: {
          metadata: { "home.png": { label: "Home", formFactor: "wide" } },
        },
      },
      { cwd: projectRoot },
    );
    await expect(discoverInputs(withMetadata)).resolves.toMatchObject({
      screenshots: [
        {
          basename: "home.png",
          annotation: { label: "Home", formFactor: "wide" },
        },
      ],
    });

    const withWrongCase = await resolveConfig(
      { screenshots: { metadata: { "Home.png": { label: "Home" } } } },
      { cwd: projectRoot },
    );
    await expect(discoverInputs(withWrongCase)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });
});
