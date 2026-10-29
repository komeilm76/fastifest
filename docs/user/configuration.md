# Configuration reference

> **Pre-release:** Fastifest is not published to npm yet. This reference describes the current source package. Package metadata declares Node.js `>=20.10.0`; that engine floor does not guarantee support for every runtime, operating system, or architecture.

Fastifest optionally loads a TypeScript default export from `fastifest.config.ts` in the project root. Run the CLI from the consuming project root; most relative paths resolve from that directory, except manifest/output paths, which resolve from `paths.public`. Config and template files execute code. Only load files you trust. Config values must use plain data properties; getter/setter properties are rejected so validation cannot read a changing value more than once.

## Example

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

Unknown config keys and malformed values are rejected with field-specific errors.

## `paths`

| Option                     | Default                | Meaning                                                                 |
| -------------------------- | ---------------------- | ----------------------------------------------------------------------- |
| `logos`                    | `./assets/logos`       | Required non-recursive input directory with exactly one supported logo. |
| `screenshots`              | `./assets/screenshots` | Optional non-recursive input directory for screenshots.                 |
| `public`                   | `./public`             | Public output root, relative to the project root.                       |
| `manifest`                 | `./manifest.json`      | Must resolve to `manifest.json` directly inside `paths.public`.         |
| `paths.output.logos`       | `./icons`              | Generated icon directory, relative to `paths.public`.                   |
| `paths.output.screenshots` | `./screenshots`        | Generated screenshot directory, relative to `paths.public`.             |

The default output tree is `public/manifest.json`, `public/icons/`, and `public/screenshots/`. Output directories must remain inside the public root and may not overlap each other, the manifest, or input paths. Fastifest does not infer framework-specific URL rewrites: configure your deployment so the public files are served at paths matching the manifest's relative URLs.

Input directories are scanned non-recursively. Supported logos are PNG, JPG, JPEG, and SVG. Supported screenshots are PNG, JPG, and JPEG. A missing or empty screenshot directory is allowed and produces a warning. Invalid supported images and extension/content mismatches fail validation.

## `template`

| Option    | Default                  | Meaning                                                               |
| --------- | ------------------------ | --------------------------------------------------------------------- |
| `enabled` | `true`                   | Create a starter template if it is missing; does not disable loading. |
| `path`    | `./manifest.template.ts` | TypeScript template location, relative to the project root.           |

If creation is enabled and the template is missing, Fastifest creates it once, prints next steps, and stops without generating `manifest.json` or image assets. Customize the file and run again. If creation is disabled and the file is missing, Fastifest reports `TEMPLATE_MISSING`. If a template already exists, it is loaded and validated regardless of `enabled`; its bytes are never overwritten automatically. Template data must provide at least one of `name` or `short_name` and use JSON-compatible data values; getter/setter properties are rejected so serialization cannot change values after validation. Fastifest owns `icons` and `screenshots`, so those keys are rejected in the template. Existing manifest fields are not merged into new output.

## `screenshots.metadata` (optional)

Metadata annotates discovered screenshot files; it does not select them. Keys must exactly match source basenames, including case and extension:

```ts
screenshots: {
  metadata: {
    "home.png": {
      label: "Home screen showing the main dashboard",
      formFactor: "wide",
    },
  },
}
```

A non-empty `label`, `formFactor` (`"narrow"` or `"wide"`), or both may be supplied. Fastifest serializes `formFactor` as the manifest member `form_factor`. It does not infer either value from filenames or image dimensions. Metadata keys that do not match discovered files fail validation. If no screenshots are found, the manifest omits the `screenshots` member.

## `images`

| Option      | Default | Meaning                                                                                       |
| ----------- | ------- | --------------------------------------------------------------------------------------------- |
| `overwrite` | `true`  | Allow replacement of reserved generated image filenames in the configured output directories. |

This option applies to managed image outputs, not arbitrary files. With overwrite disabled, if a reserved image output already exists or a reserved stale screenshot would be removed, generation fails before changing files. With overwrite enabled, Fastifest only replaces its reserved icon names and `screenshot-NN.png` names in dedicated output directories. It does not recursively delete directories or remove unrecognized files. Stale reserved screenshots are cleaned only after the new manifest commits. `manifest.json` is regenerated from the template and generated assets; it is not merged with old values.

## `logging`

| Option  | Default | Values                               |
| ------- | ------- | ------------------------------------ |
| `level` | `info`  | `error`, `warn`, `info`, or `debug`. |

Logs include actionable paths and diagnostics; they do not dump the complete config.

## Selecting a config file

Use `fastifest --config <path>` or `fastifest -c <path>`. Relative paths resolve from the current working directory; absolute paths are accepted. Without this option, Fastifest looks for `fastifest.config.ts` in the project root and uses defaults if it is absent.
