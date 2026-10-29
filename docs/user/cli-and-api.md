# CLI and API

> **Pre-release:** Fastifest is not published to npm yet. The interface below describes the current source package; install from the npm registry when a release is available.

## CLI

Run the command from the consuming project's root:

```sh
npx fastifest
```

Select a config file with `--config` or `-c`:

```sh
npx fastifest --config ./config/fastifest.config.ts
npx fastifest --config=./config/fastifest.config.ts
```

| Option                  | Purpose                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `-h`, `--help`          | Print usage and supported options.                                             |
| `-c`, `--config <path>` | Load a config file; relative paths resolve from the current working directory. |
| `-v`, `--version`       | Print the installed package version.                                           |

Usage errors exit with status `2`. Configuration, validation, and generation errors exit with status `1` and a concise diagnostic. Successful generation exits `0`. Creating a missing template is a successful first-run stop: Fastifest creates the starter, prints next steps, and does not generate `manifest.json` or image assets until another run.

## Programmatic API

The package exports `generateProject`, which uses the same generation pipeline as the CLI:

```ts
import { generateProject } from "fastifest";

const result = await generateProject({
  cwd: process.cwd(),
  configPath: "./fastifest.config.ts", // optional
});

if (result.status === "template-created") {
  // Customize result.templatePath, then call again.
  console.info(result.guidance);
} else {
  console.info(`Wrote ${result.manifestPath}`);
  console.info(`Warnings: ${result.warnings.length}`);
}
```

`cwd` defaults to the current working directory. `configPath` is optional and, when relative, resolves from `cwd`. An optional `logger` can override pipeline logging.

The result is a discriminated union:

- `status: "template-created"` includes `templatePath` and `guidance`. Treat this as a stop result; no manifest or generated assets were written.
- `status: "generated"` includes `manifestPath`, the manifest `value` and serialized `json`, `warnings`, the logo source path, and screenshot source paths.

The [configuration reference](configuration.md) covers input directories and accepted formats; [getting started](getting-started.md) describes generated files, and [troubleshooting](troubleshooting.md#unsupported-corrupt-or-oversized-image) records current image limits.

Expected configuration, template, path, input, image, output-conflict, and filesystem failures are thrown as `FastifestError` values with a stable `code`; handle failures rather than treating a partial result as success. A custom logger sink can throw its own error, which may propagate unchanged.

## Public API reference

The package root exports the following functions. `generateProject` is the high-level API; the other functions are utilities for applications that need to load, validate, or normalize Fastifest data themselves.

| Export                                 | Input and behavior                                                                                                                                                                                   | Result                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `generateProject(options?)`            | Runs the same pipeline as the CLI. `cwd` defaults to `process.cwd()`; a relative `configPath` resolves from `cwd`; `logger` optionally replaces pipeline logging.                                    | A promise of either `TemplateCreatedResult` or `GeneratedProject` (see above).                         |
| `loadConfig(options?)`                 | Loads and validates `fastifest.config.ts`; returns an empty config if the default file is absent. Relative `configPath` resolves from `cwd`. Config files execute as TypeScript and must be trusted. | `Promise<FastifestConfig>`.                                                                            |
| `resolveConfig(config, options?)`      | Validates config, applies defaults, resolves paths, and enforces disjoint/public-root and symlink-component rules.                                                                                   | `Promise<ResolvedFastifestConfig>`.                                                                    |
| `validateConfig(value)`                | Validates an unknown config object and rejects unsupported keys and values. It does not apply filesystem defaults.                                                                                   | `FastifestConfig`.                                                                                     |
| `loadTemplate(path)`                   | Loads and validates a trusted TypeScript template default export. Prefer an absolute path for unambiguous resolution when calling directly.                                                          | `Promise<ManifestTemplate>`.                                                                           |
| `validateTemplate(value)`              | Validates template shape and JSON-compatible members; requires `name` or `short_name` and rejects `icons`/`screenshots`. It does not implement every Web App Manifest semantic check.                | `ManifestTemplate`.                                                                                    |
| `loadOrCreateTemplate(path, options?)` | Loads an existing template regardless of `enabled`; if missing, creates a starter by default or fails when creation is disabled. Relative paths resolve from the current working directory.          | `Promise<LoadOrCreateTemplateResult>`; `status: "created"` is a stop result, not a generated manifest. |
| `createLogger(level?, sink?)`          | Creates a thresholded logger; `level` defaults to `info`, and a custom sink can capture or route emitted messages.                                                                                   | `Logger`.                                                                                              |

`FastifestConfig` describes user configuration. `ManifestTemplate` describes developer-authored manifest members. `ResolvedFastifestConfig` is the normalized absolute-path form returned by `resolveConfig`; callers should normally construct a `FastifestConfig` and resolve it rather than creating the normalized form manually. `ScreenshotMetadata` contains an optional non-empty `label`, `formFactor` (`"narrow"` or `"wide"`), or both. `JsonValue` and `JsonObject` describe JSON-compatible template extension members. `LogLevel`, `Logger`, and `LogSink` support custom logging. All of these types, plus `FastifestError`, `FastifestErrorCode`, and the result/options types, are exported from the package root.

### Error handling

Catch `FastifestError` and branch on its stable `code`; the message is intended for people and is not a stable machine-readable contract. The primary error codes are:

| Code                                                             | Meaning                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_INVALID` / `CONFIG_LOAD_FAILED`                          | Invalid configuration values, or config file loading/evaluation failed.                                                   |
| `TEMPLATE_INVALID` / `TEMPLATE_LOAD_FAILED` / `TEMPLATE_MISSING` | Invalid template, template loading/evaluation failed, or a required template is missing while creation is disabled.       |
| `PATH_INVALID` / `UNSAFE_PATH`                                   | Invalid or overlapping paths, an output outside its allowed root, or a symlink/reparse point was encountered.             |
| `INPUT_INVALID` / `INPUT_LIMIT`                                  | Required inputs are missing/ambiguous/invalid, or a configured file/dimension limit was exceeded.                         |
| `IMAGE_INVALID`                                                  | Supported image data is corrupt, mismatched, or cannot be processed.                                                      |
| `OUTPUT_CONFLICT`                                                | A reserved generated output exists, or a stale reserved screenshot would need removal, while image overwrite is disabled. |
| `IO_FAILED`                                                      | A filesystem failure prevented generation or commit; some post-commit cleanup failures are downgraded to warnings.        |

`FastifestError` also exposes an optional `cause` containing the underlying failure when available. Other errors can propagate from caller-provided callbacks such as a custom logger sink.

## Runtime compatibility

Package metadata declares Node.js `>=20.10.0`. Full candidate checks passed on Ubuntu, Windows, and macOS with Node 20, 22, and 24; packed-install generation smoke tests passed at the Node 20.10.0 floor on those operating systems. Bun 1.4.4 full checks passed on Ubuntu only. These results cover tested combinations, not every runtime, OS, or architecture. Bun on Windows/macOS is unverified. Check release documentation before selecting a production runtime.
