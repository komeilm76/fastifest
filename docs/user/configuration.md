# Configuration reference

> **Pre-release guide:** These options describe the proposed public configuration. Names, defaults, and runtime validation are not yet implemented or guaranteed.

Fastifest is planned to load a TypeScript default export from `fastifest.config.ts` in the project root. Unless otherwise stated, paths resolve relative to the project root from which Fastifest is run.

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

## `paths`

| Option                     | Proposed default       | Meaning                                                                                                    |
| -------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `logos`                    | `./assets/logos`       | Required directory containing exactly one supported logo.                                                  |
| `screenshots`              | `./assets/screenshots` | Optional directory containing screenshots.                                                                 |
| `public`                   | `./public`             | Root directory served by your web application.                                                             |
| `manifest`                 | `./manifest.json`      | Manifest output path, relative to `paths.public`; V1 requires `manifest.json` directly inside that folder. |
| `paths.output.logos`       | `./icons`              | Icon output directory, relative to `paths.public`.                                                         |
| `paths.output.screenshots` | `./screenshots`        | Screenshot output directory, relative to `paths.public`.                                                   |

The manifest and generated output directories stay inside the public root. Logo and screenshot input directories may not overlap each other or generated output directories. The proposed v1 policy rejects symlinked input entries and symlink/reparse-point output components or reserved targets rather than following them. Keep the output directories dedicated to Fastifest: its generated names are reserved, and hand-managed files with those names may be replaced when overwrite is enabled. Fastifest cannot infer how your framework maps filesystem paths to deployed URLs; the default assumes the public directory is served at the same URL base, with `manifest.json` beside the generated asset folders. See [Web App Manifest and PWA basics](manifest-and-pwa.md#understand-url-resolution).

## `template`

| Option    | Proposed default         | Meaning                                          |
| --------- | ------------------------ | ------------------------------------------------ |
| `enabled` | `true`                   | Create a starter template if one does not exist. |
| `path`    | `./manifest.template.ts` | Template location, relative to project root.     |

An existing template must never be silently replaced. With `enabled: true`, the first run that finds no template creates a starter, prints next steps, and exits without writing a manifest; fill in the starter and run again. `enabled` controls only creation of a missing starter, not template loading. If disabled and the file is missing, generation should fail; if the file exists, it is still loaded and validated. The template must include at least one of `name` or `short_name`. Template files are executable TypeScript, not inert JSON. Only load trusted project files. Fastifest generates `icons` and `screenshots`; these properties should not appear in template data. Each successful run regenerates `manifest.json` from the template and current assets; existing manifest fields are not merged.

## `screenshots.metadata` (optional)

Screenshot discovery does not require listing filenames. If you want to add accurate manifest metadata, optionally provide a map keyed by the exact source filename:

```ts
screenshots: {
  metadata: {
    'home.png': {
      label: 'Home screen showing the main dashboard',
      formFactor: 'wide',
    },
  },
}
```

`label` is an accessible name for a screenshot and should describe the actual screen. `formFactor` may be `narrow` or `wide` and is converted to the manifest's `form_factor` member; set it only when you know the screenshot represents that layout. Fastifest must not guess either value from the filename or image dimensions. The map annotates discovered files; it does not control which files are discovered. A key that does not match a discovered screenshot should fail validation. If no metadata is given, the generated screenshot entry has no `label` or `form_factor`.

## `images`

| Option      | Proposed default | Meaning                                                                                                                                      |
| ----------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `overwrite` | `true`           | Allow replacement of reserved Fastifest output filenames in configured output directories. It does not authorize arbitrary file replacement. |

With overwrite disabled, Fastifest is planned to check before writing or deleting: if any reserved image output file would be created, replaced, or removed (including an obsolete screenshot), it fails without changing files. This option applies only to image assets; after successful validation, `manifest.json` is regenerated from the template and generated assets. The template itself is never overwritten. Use dedicated output directories: Fastifest reserves its generated filenames, so a hand-managed file with the same name may be replaced when overwrite is enabled. It must not overwrite files outside its reserved names or recursively delete directories. Stale generated screenshot files are intended to be removed only after a successful manifest update.

## `logging`

| Option  | Proposed default | Values                               |
| ------- | ---------------- | ------------------------------------ |
| `level` | `info`           | `error`, `warn`, `info`, or `debug`. |

Invalid values should fail with a field-specific diagnostic. Logs should not print the entire config or environment.

## Explicit config path

The planned CLI option is `--config <path>`. Run the command from the consuming project's root; relative config paths resolve from that current working directory, while absolute paths may also be used. TypeScript config loading support will be specified after it has been tested on supported runtimes.

## Release note

This reference is a proposal, not a supported configuration contract yet. The released package documentation will list only options, defaults, limits, and path rules that have been implemented and tested.
