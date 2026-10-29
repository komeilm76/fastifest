# Fastifest

> **Pre-release:** Fastifest is not published to npm yet. Its source package includes a working generator, programmatic API, and CLI, but installation from the npm registry is not available until a release is authorized. Package metadata sets a Node.js floor of 20.10.0; broader runtime and platform coverage remains limited to the tested combinations below.

Fastifest discovers one logo and optional screenshots, creates standardized PNG assets, and writes a Web App Manifest (`manifest.json`) directly inside your public directory.

## Quick start

Once the package is published, install it as a development dependency:

```sh
npm install --save-dev fastifest
```

Place exactly one supported logo in `assets/logos/` and any optional screenshots in `assets/screenshots/`. Run Fastifest from the project root:

```sh
npx fastifest
```

On the first run, if `manifest.template.ts` is missing, Fastifest creates a starter and stops without generating a manifest. Customize the template and run the command again.

## Configuration

Fastifest works with defaults or a project-root `fastifest.config.ts`:

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

Use `npx fastifest --config ./path/to/config.ts` to select another config file. See the [configuration reference](docs/user/configuration.md) for defaults, path rules, screenshot annotations, and overwrite behavior.

## Output

```text
project/
├── assets/
│   ├── logos/                 # exactly one logo
│   └── screenshots/           # optional source screenshots
├── fastifest.config.ts
├── manifest.template.ts       # create-only starter, if missing
└── public/
    ├── manifest.json
    ├── icons/
    │   ├── icon-192.png
    │   ├── icon-512.png
    │   ├── icon-maskable-192.png
    │   └── icon-maskable-512.png
    └── screenshots/           # directory created; image files only when found
```

Fastifest preserves image aspect ratio, does not crop logos or enlarge screenshots, and omits the manifest `screenshots` member when no screenshots are found. Output filenames are reserved inside the configured output directories; keep those directories dedicated to Fastifest.

## Documentation

- [Getting started](docs/user/getting-started.md)
- [Configuration reference](docs/user/configuration.md)
- [CLI and API](docs/user/cli-and-api.md)
- [Web App Manifest and PWA basics](docs/user/manifest-and-pwa.md)
- [Troubleshooting and safety](docs/user/troubleshooting.md)

## Release status

Fastifest has not been published. Package metadata declares Node.js `>=20.10.0`. Full candidate checks passed on Ubuntu, Windows, and macOS with Node 20, 22, and 24; a packed-install generation smoke test also passed on Node 20.10.0 across those three operating systems. Bun 1.4.4 full checks passed on Ubuntu only. This evidence covers tested combinations, not every operating system, architecture, or runtime; Bun on Windows/macOS is unverified. Do not assume a registry installation or broader compatibility until a release is available.
