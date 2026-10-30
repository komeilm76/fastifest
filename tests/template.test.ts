import {
  access,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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
  root = await realpath(await mkdtemp(join(tmpdir(), "fastifest-template-")));
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

  it("does not read inherited template properties from a polluted Object prototype", () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "name");
    let reads = 0;
    try {
      Object.defineProperty(Object.prototype, "name", {
        configurable: true,
        get: () => {
          reads += 1;
          return "Injected";
        },
      });

      expect(validateTemplate({ short_name: "App" })).toEqual({
        short_name: "App",
      });
      expect(reads).toBe(0);
    } finally {
      if (original) Object.defineProperty(Object.prototype, "name", original);
      else Reflect.deleteProperty(Object.prototype, "name");
    }
  });

  it("rejects sparse arrays without reading inherited array values", () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "0");
    const values = new Array(1);
    let reads = 0;
    let thrown: unknown;
    try {
      Object.defineProperty(Object.prototype, "0", {
        configurable: true,
        get: () => {
          reads += 1;
          return "injected";
        },
      });
      try {
        validateTemplate({ name: "Example", categories: values });
      } catch (error) {
        thrown = error;
      }
    } finally {
      if (original) Object.defineProperty(Object.prototype, "0", original);
      else Reflect.deleteProperty(Object.prototype, "0");
    }

    expect(reads).toBe(0);
    expect(thrown).toMatchObject({ code: "TEMPLATE_INVALID" });
    expect((thrown as Error).message).toContain(
      "sparse arrays are not JSON-compatible",
    );
  });

  it("rejects accessor properties instead of serializing changing template values", () => {
    const template = {
      get name() {
        return "Example";
      },
      short_name: "App",
    };

    expect(() => validateTemplate(template)).toThrowError(
      "accessor properties are not JSON-compatible",
    );
  });

  it.each([
    ["categories", "expected an array of strings"],
    ["shortcuts", "expected an array of JSON objects"],
  ])(
    "does not trust an array's own non-enumerable some method for %s",
    (field, message) => {
      const values = [42];
      Object.defineProperty(values, "some", {
        configurable: true,
        value: () => false,
      });
      const template = { name: "Example", [field]: values };

      expect(() => validateTemplate(template)).toThrowError(message);
    },
  );

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
