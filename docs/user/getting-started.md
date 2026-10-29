# Getting started

> **Pre-release:** Fastifest is not published to npm yet. These instructions describe the current source package; the registry install command will work when a release is available.

## Requirements

- A project directory with a public folder served by your web application.
- Exactly one supported logo in `assets/logos/`.
- Optionally, supported screenshots in `assets/screenshots/`.

Fastifest uses `sharp` for image processing and declares Node.js `>=20.10.0` in package metadata. Candidate CI checks cover Node 20, 22, and 24 on Ubuntu, Windows, and macOS; they do not imply support for every architecture or environment. See [CLI and API](cli-and-api.md#runtime-compatibility).

## 1. Install Fastifest when published

```sh
npm install --save-dev fastifest
```

## 2. Add source images

```text
assets/
├── logos/
│   └── brand.svg          # exactly one supported logo
└── screenshots/
    ├── home.png           # optional
    └── settings.jpg       # optional
```

Discovery is non-recursive. Supported logo types are PNG, JPG, JPEG, and SVG; screenshots support PNG, JPG, and JPEG. Extensions are matched case-insensitively, but the contents must be valid image data and match the extension. Fastifest does not choose between multiple logos. Screenshot files are processed in deterministic filename order; optional annotations are matched by exact source basename. See [Configuration](configuration.md#screenshotsmetadata-optional).

## 3. Configure the project (optional)

Fastifest uses defaults if no `fastifest.config.ts` exists. Create one in the project root to customize paths or behavior:

```ts
import type { FastifestConfig } from "fastifest";

export default {
  paths: {
    logos: "./assets/logos",
    screenshots: "./assets/screenshots",
    public: "./public",
    manifest: "./manifest.json",
    output: {
      logos: "./icons",
      screenshots: "./screenshots",
    },
  },
  template: {
    enabled: true,
    path: "./manifest.template.ts",
  },
  images: { overwrite: true },
  logging: { level: "info" },
} satisfies FastifestConfig;
```

Run Fastifest from the project root. Source and template paths resolve from that directory. The manifest must be `manifest.json` directly inside `paths.public`; generated output directories are relative to that public root.

## 4. Add manifest details

On the first run, if the template is missing and `template.enabled` is `true` (the default), Fastifest creates `manifest.template.ts`, prints next steps, and stops without generating a manifest. Edit the starter and run Fastifest again. An existing template is never overwritten. If template creation is disabled and the file is missing, Fastifest reports an error; an existing template is still loaded when creation is disabled.

A template is a TypeScript default export:

```ts
import type { ManifestTemplate } from "fastifest";

export default {
  name: "Example app",
  short_name: "Example",
  description: "A short description of the app.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#172554",
  lang: "en",
} satisfies ManifestTemplate;
```

Provide at least one of `name` or `short_name`. `start_url` and `scope` should match your deployment; when both are supplied, the scope path must contain the start URL. Fastifest generates `icons` and `screenshots`; do not include those properties in the template. Config and template files execute as TypeScript, so only load files you trust.

## 5. Generate and review

After installing the package, run:

```sh
npx fastifest
```

Fastifest writes `manifest.json` directly inside the configured public folder, icons under its configured icon directory, and screenshots only when source screenshots are found. It does not edit your HTML. Link the deployed manifest from your page, for example:

```html
<link rel="manifest" href="/manifest.json" />
```

The root URL is an example for a site hosted at the domain root. If your app is deployed under a path prefix, use the deployed manifest URL and ensure its relative icon/screenshot URLs resolve to the generated files. See [Web App Manifest and PWA basics](manifest-and-pwa.md#understand-url-resolution).

## Image behavior

Fastifest generates 192 × 192 and 512 × 512 PNG icons, each with a standard and maskable variant. It fits the whole logo without stretching or cropping; maskable artwork is fitted within the central safe circle. It converts screenshots to PNG, preserves aspect ratio, does not enlarge them, and proportionally reduces screenshots whose longest side exceeds 4,096 pixels. Orientation is applied before measuring, output is normalized to sRGB, and source metadata is stripped. With no screenshots, the manifest omits the `screenshots` member.

For collisions, path safety, and troubleshooting, see [Troubleshooting and safety](troubleshooting.md).
