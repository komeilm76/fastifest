import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/resolve.js";
import { createLogger } from "../src/logger.js";
import {
  buildManifest,
  type ManifestIconEntry,
  type ManifestScreenshotEntry,
} from "../src/manifest/build.js";
import type { GeneratedLogoIcon } from "../src/images/logo.js";
import type { GeneratedScreenshot } from "../src/images/screenshots.js";
import type { ResolvedFastifestConfig } from "../src/types.js";

let projectRoot: string;
const silentLogger = createLogger("debug", () => {});

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "fastifest-manifest-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});
const iconSpecs: Array<[string, number, "any" | "maskable"]> = [
  ["icon-192.png", 192, "any"],
  ["icon-512.png", 512, "any"],
  ["icon-maskable-192.png", 192, "maskable"],
  ["icon-maskable-512.png", 512, "maskable"],
];

function makeIcons(): GeneratedLogoIcon[] {
  return iconSpecs.map(([filename, size, purpose]) => ({
    filename,
    size,
    purpose,
    mimeType: "image/png",
    buffer: Buffer.from(`generated:${filename}`),
  }));
}

function makeScreenshot(
  filename = "screenshot-01.png",
  width = 960,
  height = 540,
): GeneratedScreenshot {
  return {
    filename,
    sourceBasename: "home.png",
    width,
    height,
    mimeType: "image/png",
    buffer: Buffer.from(`generated:${filename}`),
  };
}

async function makeConfig(): Promise<ResolvedFastifestConfig> {
  return resolveConfig(
    {
      paths: {
        public: "./public root",
        output: { logos: "./icon assets", screenshots: "./screen captures" },
      },
    },
    { cwd: projectRoot },
  );
}

const completeTemplate = {
  name: "Example App",
  short_name: "Example",
  start_url: "/",
  display: "standalone",
  custom_member: { enabled: true, version: 1 },
};

describe("buildManifest", () => {
  it("assembles generated icon and screenshot entries using public-root URLs", async () => {
    const config = await makeConfig();
    const screenshot = {
      ...makeScreenshot(),
      label: "Home screen",
      formFactor: "wide" as const,
    };
    const result = buildManifest(
      config,
      completeTemplate,
      makeIcons(),
      [screenshot],
      { logger: silentLogger },
    );

    expect(result.manifestPath).toBe(join(config.publicRoot, "manifest.json"));
    expect(result.value).toMatchObject({
      ...completeTemplate,
      icons: [
        {
          src: "icon%20assets/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "icon%20assets/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "icon%20assets/icon-maskable-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "maskable",
        },
        {
          src: "icon%20assets/icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ] satisfies ManifestIconEntry[],
      screenshots: [
        {
          src: "screen%20captures/screenshot-01.png",
          sizes: "960x540",
          type: "image/png",
          label: "Home screen",
          form_factor: "wide",
        },
      ] satisfies ManifestScreenshotEntry[],
    });
    expect(result.warnings).toEqual([]);
    await expect(access(config.publicRoot)).rejects.toThrow();
  });

  it("validates relative start, scope, and id relationships without requiring id inside scope", async () => {
    const config = await makeConfig();
    const result = buildManifest(
      config,
      {
        ...completeTemplate,
        start_url: "../app/start?mode=install#top",
        scope: "../app/",
        id: "../application-id",
      },
      makeIcons(),
      [makeScreenshot()],
      { logger: silentLogger },
    );
    expect(result.value.start_url).toBe("../app/start?mode=install#top");
    expect(result.warnings).toContain(
      "Fastifest cannot fully verify scope containment for path-relative start_url or scope because the deployed manifest URL prefix is unknown. Check the relationship at your deployed manifest URL.",
    );
  });

  it("does not assume an absolute scope is the unknown origin of a relative start_url", async () => {
    const config = await makeConfig();
    const result = buildManifest(
      config,
      {
        ...completeTemplate,
        start_url: "/app/start",
        scope: "https://app.example.test/app/",
      },
      makeIcons(),
      [makeScreenshot()],
      { logger: silentLogger },
    );
    expect(result.warnings).toContain(
      "Manifest template combines absolute URLs with a relative start_url; same-origin relationships involving relative URLs cannot be fully checked because the final site origin is unknown.",
    );
  });

  it("warns when dot-relative scope containment depends on the deployed manifest path", async () => {
    const config = await makeConfig();
    const result = buildManifest(
      config,
      {
        ...completeTemplate,
        start_url: "../app/start",
        scope: "./",
      },
      makeIcons(),
      [makeScreenshot()],
      { logger: silentLogger },
    );

    expect(result.warnings).toContain(
      "Fastifest cannot fully verify scope containment for path-relative start_url or scope because the deployed manifest URL prefix is unknown. Check the relationship at your deployed manifest URL.",
    );
  });

  it("rejects scope paths that do not contain start_url", async () => {
    const config = await makeConfig();
    expect(() =>
      buildManifest(
        config,
        { ...completeTemplate, start_url: "/application/home", scope: "/app" },
        makeIcons(),
        [makeScreenshot()],
        { logger: silentLogger },
      ),
    ).toThrowError(/scope must contain start_url/);
  });

  it("rejects conflicting absolute origins for scope and id", async () => {
    const config = await makeConfig();
    expect(() =>
      buildManifest(
        config,
        {
          ...completeTemplate,
          start_url: "https://app.example.test/app/start",
          scope: "https://other.example.test/app/",
        },
        makeIcons(),
        [makeScreenshot()],
        { logger: silentLogger },
      ),
    ).toThrowError(/scope.*same origin/);

    expect(() =>
      buildManifest(
        config,
        {
          ...completeTemplate,
          start_url: "https://app.example.test/app/start",
          id: "https://other.example.test/app-id",
        },
        makeIcons(),
        [makeScreenshot()],
        { logger: silentLogger },
      ),
    ).toThrowError(/id.*same origin/);
  });

  it("warns when URL parsing trims whitespace around an absolute start_url", async () => {
    const config = await makeConfig();
    const result = buildManifest(
      config,
      {
        ...completeTemplate,
        start_url: " https://fastifest.invalid/app/start ",
        scope: "/app/",
      },
      makeIcons(),
      [makeScreenshot()],
      { logger: silentLogger },
    );

    expect(result.warnings).toContain(
      "Manifest template contains absolute URLs; Fastifest assumes deployment on origin https://fastifest.invalid for relationship checks because the final site origin is unknown.",
    );
  });

  it("accepts a consistent absolute deployment origin and warns that it is assumed", async () => {
    const config = await makeConfig();
    const result = buildManifest(
      config,
      {
        ...completeTemplate,
        start_url: "https://app.example.test/app/start",
        scope: "../app/",
        id: "../app-id",
      },
      makeIcons(),
      [makeScreenshot()],
      { logger: silentLogger },
    );
    expect(result.warnings).toEqual([
      "Fastifest cannot fully verify scope containment for path-relative start_url or scope because the deployed manifest URL prefix is unknown. Check the relationship at your deployed manifest URL.",
      "Manifest template contains absolute URLs; Fastifest assumes deployment on origin https://app.example.test for relationship checks because the final site origin is unknown.",
    ]);
  });

  it("rejects malformed URL references", async () => {
    const config = await makeConfig();
    expect(() =>
      buildManifest(
        config,
        { ...completeTemplate, start_url: "https://[invalid" },
        makeIcons(),
        [makeScreenshot()],
        { logger: silentLogger },
      ),
    ).toThrowError(/start_url.*valid URL/);
  });

  it("omits screenshots when none were generated and returns a concise warning", async () => {
    const config = await makeConfig();
    const result = buildManifest(config, completeTemplate, makeIcons(), [], {
      logger: silentLogger,
    });

    expect(result.value).not.toHaveProperty("screenshots");
    expect(result.warnings).toEqual([
      "No screenshots were generated; the manifest screenshots member was omitted.",
    ]);
  });

  it("serializes stable two-space JSON with a trailing newline", async () => {
    const config = await makeConfig();
    const first = buildManifest(
      config,
      completeTemplate,
      makeIcons(),
      [makeScreenshot()],
      { logger: silentLogger },
    );
    const second = buildManifest(
      config,
      completeTemplate,
      makeIcons(),
      [makeScreenshot()],
      { logger: silentLogger },
    );

    expect(first.json).toBe(second.json);
    expect(first.json.endsWith("\n")).toBe(true);
    expect(first.json).toContain('\n  "name": "Example App",');
    const parsed = JSON.parse(first.json) as {
      screenshots: Array<Record<string, unknown>>;
    };
    expect(parsed).toEqual(first.value);
    expect(parsed.screenshots[0]).not.toHaveProperty("label");
    expect(parsed.screenshots[0]).not.toHaveProperty("form_factor");
  });

  it("rejects an invalid direct-child manifest path and outputs outside public root", async () => {
    const config = await makeConfig();
    expect(() =>
      buildManifest(
        {
          ...config,
          manifestPath: join(config.publicRoot, "nested", "manifest.json"),
        },
        completeTemplate,
        makeIcons(),
        [],
        { logger: silentLogger },
      ),
    ).toThrowError(/directly inside the configured public root/);

    expect(() =>
      buildManifest(
        {
          ...config,
          iconsOutputPath: join(config.projectRoot, "outside-icons"),
        },
        completeTemplate,
        makeIcons(),
        [],
        { logger: silentLogger },
      ),
    ).toThrowError(/subdirectories of the configured public root/);

    expect(() =>
      buildManifest(
        {
          ...config,
          screenshotsOutputPath: join(config.iconsOutputPath, "nested"),
        },
        completeTemplate,
        makeIcons(),
        [],
        { logger: silentLogger },
      ),
    ).toThrowError(/must not overlap one another/);
  });

  it("rejects invalid templates, incomplete icons, and malformed screenshots", async () => {
    const config = await makeConfig();
    expect(() =>
      buildManifest(config, { description: "No identity" }, makeIcons(), [], {
        logger: silentLogger,
      }),
    ).toThrowError("provide at least one of name or short_name");
    expect(() =>
      buildManifest(
        config,
        { ...completeTemplate, icons: [] },
        makeIcons(),
        [],
        { logger: silentLogger },
      ),
    ).toThrowError(/icons.*generated by Fastifest/);
    expect(() =>
      buildManifest(config, completeTemplate, makeIcons().slice(1), [], {
        logger: silentLogger,
      }),
    ).toThrowError("exactly four generated Fastifest icons");
    expect(() =>
      buildManifest(
        config,
        completeTemplate,
        makeIcons(),
        [makeScreenshot("screenshot-02.png")],
        { logger: silentLogger },
      ),
    ).toThrowError("Invalid generated screenshot metadata");
    expect(() =>
      buildManifest(
        config,
        completeTemplate,
        makeIcons(),
        [{ ...makeScreenshot(), width: 0 }],
        { logger: silentLogger },
      ),
    ).toThrowError("Invalid generated screenshot metadata");
  });

  it("warns when install-related template guidance is missing or opted out", async () => {
    const config = await makeConfig();
    const result = buildManifest(
      config,
      {
        name: "Example",
        scope: "https://scope.example.test/app/",
        id: "https://unrelated.example.test/app-id",
        prefer_related_applications: true,
      },
      makeIcons(),
      [],
      { logger: silentLogger },
    );

    expect(result.warnings).toEqual([
      "Manifest template omits start_url; browsers may fall back to the linking page, and scope/id relationships cannot be fully checked.",
      "Manifest template omits display and display_override; browser install promotion may be affected.",
      "prefer_related_applications is true; Chromium install promotion may be affected.",
      "No screenshots were generated; the manifest screenshots member was omitted.",
    ]);
  });
});
