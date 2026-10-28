import sharp from "sharp";
import { describe, expect, it } from "vitest";

describe("sharp runtime", () => {
  it("loads its native runtime and converts a small local SVG to PNG", async () => {
    const source = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="#336699"/></svg>',
    );

    const result = await sharp(source)
      .png()
      .toBuffer({ resolveWithObject: true });

    expect(result.info).toMatchObject({
      format: "png",
      width: 12,
      height: 8,
      channels: 4,
    });
    await expect(sharp(result.data).metadata()).resolves.toMatchObject({
      format: "png",
      width: 12,
      height: 8,
    });
  });
});
