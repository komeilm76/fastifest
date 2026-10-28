import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadOrCreateTemplate,
  loadTemplate,
  validateTemplate,
} from "../src/config/template.js";
import { createLogger } from "../src/logger.js";

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

  it("re-reads an edited template on a later generation call in the same process", async () => {
    const templateFile = join(root, "manifest.template.ts");
    await writeFile(templateFile, `export default { name: 'First' };`);
    await expect(loadTemplate(templateFile)).resolves.toMatchObject({
      name: "First",
    });

    await writeFile(templateFile, `export default { name: 'Second' };`);
    await expect(loadTemplate(templateFile)).resolves.toMatchObject({
      name: "Second",
    });
  });
});

describe("loadOrCreateTemplate", () => {
  it("creates a starter once, gives next-step guidance, and signals the caller to stop", async () => {
    const templateFile = join(root, "config", "manifest.template.ts");
    const messages: string[] = [];
    const logger = createLogger("debug", (_level, message) =>
      messages.push(message),
    );

    const result = await loadOrCreateTemplate(templateFile, { logger });

    expect(result).toMatchObject({
      status: "created",
      templatePath: templateFile,
    });
    expect(result).not.toHaveProperty("template");
    if (result.status !== "created") throw new Error("Expected starter result");
    expect(result.guidance).toContain("Customize it, then run Fastifest again");
    expect(result.guidance).toContain("No manifest was generated");
    expect(messages).toEqual([result.guidance]);
    await expect(readFile(templateFile, "utf8")).resolves.toContain(
      'name: "My Web App"',
    );
    await expect(access(join(root, "manifest.json"))).rejects.toThrow();
  });

  it("does not create a starter when disabled and reports an actionable missing-template error", async () => {
    const templateFile = join(root, "manifest.template.ts");

    await expect(
      loadOrCreateTemplate(templateFile, { enabled: false }),
    ).rejects.toMatchObject({
      code: "TEMPLATE_MISSING",
      message: expect.stringContaining("template.enabled to true"),
    });
    await expect(access(templateFile)).rejects.toThrow();
  });

  it("loads an existing template even when creation is disabled and never overwrites it", async () => {
    const templateFile = join(root, "manifest.template.ts");
    const original = `export default { name: 'Existing App', start_url: '/app/' };\n`;
    await writeFile(templateFile, original);

    await expect(
      loadOrCreateTemplate(templateFile, { enabled: false }),
    ).resolves.toEqual({
      status: "loaded",
      template: { name: "Existing App", start_url: "/app/" },
    });
    await expect(readFile(templateFile, "utf8")).resolves.toBe(original);
  });

  it("loads an existing template when creation is enabled without changing its bytes", async () => {
    const templateFile = join(root, "manifest.template.ts");
    const original = `export default { name: 'Preserve Me' };\n// user comment\n`;
    await writeFile(templateFile, original);

    await expect(loadOrCreateTemplate(templateFile)).resolves.toMatchObject({
      status: "loaded",
      template: { name: "Preserve Me" },
    });
    await expect(readFile(templateFile, "utf8")).resolves.toBe(original);
  });
});
