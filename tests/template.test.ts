import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTemplate, validateTemplate } from "../src/config/template.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fastifest-template-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("validateTemplate", () => {
  it("preserves a valid developer-managed manifest object", () => {
    const template = {
      name: "Example",
      short_name: "App",
      start_url: "/",
      custom_member: { value: 1 },
    };
    expect(validateTemplate(template)).toEqual(template);
  });

  it.each([
    [{ name: "Example", icons: [] }, "icons"],
    [{ name: "Example", screenshots: [] }, "screenshots"],
    [
      { description: "Missing identity" },
      "provide at least one of name or short_name",
    ],
    [{ name: "   " }, "name: expected a non-empty string"],
    [{ name: 12 }, "name: expected a string"],
    [
      { name: "Example", categories: ["ok", 4] },
      "categories: expected an array of strings",
    ],
    [
      { name: "Example", prefer_related_applications: "false" },
      "prefer_related_applications: expected a boolean",
    ],
    [
      { name: "Example", custom_member: Number.NaN },
      "custom_member: numbers must be finite",
    ],
    [
      { name: "Example", custom_member: () => "not JSON" },
      "custom_member: expected a JSON-compatible value",
    ],
  ])("rejects malformed templates", (template, message) => {
    expect(() => validateTemplate(template)).toThrowError(message);
  });

  it("rejects circular extension values", () => {
    const circular: Record<string, unknown> = { name: "Example" };
    circular.self = circular;
    expect(() => validateTemplate(circular)).toThrowError(
      "circular values are not supported",
    );
  });
});

describe("loadTemplate", () => {
  it("loads a trusted TypeScript default export", async () => {
    const templateFile = join(root, "manifest.template.ts");
    await writeFile(
      templateFile,
      `export default { name: 'Example', display: 'standalone' } as const;`,
    );
    await expect(loadTemplate(templateFile)).resolves.toEqual({
      name: "Example",
      display: "standalone",
    });
  });
});
