# Fastifest

> **Pre-release:** Fastifest is under active development and is not published. The config/type foundation is in place, but the image generator and CLI are not complete; install and generation commands below are plans, not runnable product instructions.

Fastifest is being built as a small project tool that discovers a logo and optional screenshots, creates standardized PNG assets, and generates a Web App Manifest (`manifest.json`). It is designed to remove repetitive icon resizing while keeping generated files predictable and reviewable.

## Planned quick start

After a release is available, the intended workflow is:

```sh
npm install --save-dev fastifest
```

Add one logo to `assets/logos/` and optional screenshots to `assets/screenshots/`. Create `fastifest.config.ts` in your project root:

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

The planned default command is:

```sh
npx fastifest
```

The exact install/runtime requirements and command will be confirmed by implementation and CI before publication.

## Planned output

```text
project/
├── assets/
│   ├── logos/                 # exactly one source logo
│   └── screenshots/           # optional source screenshots
├── fastifest.config.ts
├── manifest.template.ts       # created if enabled; never overwritten
└── public/
    ├── manifest.json
    ├── icons/
    │   ├── icon-192.png
    │   ├── icon-512.png
    │   ├── icon-maskable-192.png
    │   └── icon-maskable-512.png
    └── screenshots/
        └── screenshot-01.png
```

## Planned behavior at a glance

- Logo inputs: PNG, JPG, JPEG, or SVG. Screenshot inputs: PNG, JPG, or JPEG.
- File discovery is non-recursive and case-insensitive; input filenames are not required in the config. Optional screenshot annotations may refer to a source basename.
- Exactly one readable supported logo is required; corrupt supported files and extension/content mismatches fail validation. Screenshots are optional.
- The logo is fitted without cropping or stretching. Screenshots preserve aspect ratio and are not enlarged; with no screenshots, the manifest omits that member.
- Generated manifest URLs are web paths (not local absolute paths) and point to generated files.
- A pre-existing template is never replaced automatically. Generated filenames are reserved inside dedicated output folders; see the [configuration guide](docs/user/configuration.md) for overwrite behavior.

## User documentation

These guides describe the planned public interface and will be verified against the working package before release:

- [Getting started](docs/user/getting-started.md)
- [Configuration reference](docs/user/configuration.md)
- [CLI and API reference](docs/user/cli-and-api.md)
- [Web App Manifest and PWA basics](docs/user/manifest-and-pwa.md)
- [Troubleshooting and safety](docs/user/troubleshooting.md)

## Status

This pre-release development snapshot contains initial package and configuration foundations for internal testing, but it does not yet provide image processing, manifest generation, a runnable CLI, or a complete generation API. Fastifest is not published. Do not use the planned commands or examples as evidence of a working generator or released package.
