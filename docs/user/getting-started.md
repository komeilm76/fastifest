# Getting started

> **Pre-release guide:** Fastifest is not published and the complete generator is still under development. This page describes the proposed v1 workflow; its generation commands are not yet runnable.

## What you will need

- A project directory in which you can add a development dependency.
- One primary logo image in PNG, JPG, JPEG, or SVG format.
- Optionally, screenshots in PNG, JPG, or JPEG format.
- A web-served public directory (the default is `public/`).

## 1. Install Fastifest

After Fastifest is published, the planned installation command is:

```sh
npm install --save-dev fastifest
```

The supported Node.js version and Bun compatibility will be stated here after they are verified. They are not yet established.

## 2. Add source images

```text
assets/
├── logos/
│   └── brand.svg          # keep exactly one supported logo here
└── screenshots/
    ├── home.png           # optional
    └── settings.jpg       # optional
```

Discovery is planned to be non-recursive. File extensions are matched case-insensitively, but files must contain valid image data. Screenshot files will be processed in deterministic, case-insensitive filename order. Fastifest will not choose between multiple logos: keep only the intended primary logo in the directory. Optional screenshot labels and known `narrow`/`wide` layouts can be supplied by source filename; they are never guessed. See the [screenshot metadata reference](configuration.md#screenshotsmetadata-optional).

## 3. Configure the project

Create `fastifest.config.ts` at the project root:

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

Source, template, and `paths.public` values are planned to resolve from the project root. `paths.manifest` and generated output paths resolve from the configured public root; the manifest is fixed to `manifest.json` directly inside that folder. See the [configuration reference](configuration.md) for the proposed defaults and path rules.

## 4. Add manifest details

When enabled, Fastifest will create a starter `manifest.template.ts` if it is missing. It will not replace an existing file. The intended template shape is a default-exported object:

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

This example assumes the app is deployed at the origin root. If it is hosted under a path such as `/my-app/`, set `start_url` and `scope` to routes appropriate for that deployment; `start_url` must be within `scope`. The template must provide at least one of `name` or `short_name`; Fastifest will require this for a useful generated manifest. The generated `icons` and `screenshots` properties belong to Fastifest and must not be supplied in the template. Config and template files are executable TypeScript; only load files you trust.

Planned first-run behavior: Fastifest creates the template, prints instructions, and exits without generating a placeholder manifest. Fill in the template, then run generation again. If the template already exists, Fastifest leaves it untouched and uses its values after validation.

## 5. Generate and review

The planned command is:

```sh
npx fastifest
```

The intended outputs are `public/manifest.json`, icons under `public/icons/`, and any converted screenshots under `public/screenshots/`. The manifest is written directly into the configured public folder, alongside the generated assets. When that folder is served at the site root, the manifest URL is `/manifest.json`, and an icon URL such as `icons/icon-192.png` resolves relative to it. If your host serves the public folder under a URL prefix, adjust the HTML link and deployment so the manifest's relative asset URLs reach the generated files.

Fastifest does not edit your HTML. Add a manifest link to your page, adjusting the URL if your app is deployed under a subpath:

```html
<link rel="manifest" href="/manifest.json" />
```

A simplified generated manifest may look like this:

```json
{
  "name": "Example app",
  "short_name": "Example",
  "start_url": "/",
  "display": "standalone",
  "icons": [
    {
      "src": "icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ],
  "screenshots": [
    {
      "src": "screenshots/screenshot-01.png",
      "sizes": "1280x720",
      "type": "image/png"
    }
  ]
}
```

The example is illustrative: generated screenshot dimensions come from the processed file and will differ for your images. Missing screenshots produce no `screenshots` entries.

## Expected image behavior

The proposed icon set contains 192 × 192 and 512 × 512 PNG icons, including maskable variants. Logos are fitted onto a transparent square canvas without stretching or cropping. Maskable variants keep the visible artwork inside the central circular safe area so it is less likely to be clipped by launchers. Screenshots are converted to PNG, preserve their aspect ratio, and are not enlarged. JPEG EXIF orientation is applied before resizing, output is normalized to sRGB, and source metadata is stripped from generated files. Proposed safety limits are 20 MiB per raster input, 2 MiB per SVG, 40 megapixels and 12,000 pixels per side for decoded raster images, and a 4,096-pixel maximum screenshot side. These limits are proposals and will be confirmed with implementation tests before release.

For collision, overwrite, path-safety, and troubleshooting details, see [Troubleshooting and safety](troubleshooting.md).
