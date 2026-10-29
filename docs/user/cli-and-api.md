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

Generation errors are thrown as `FastifestError` values with a stable `code`; callers should handle failures rather than treating a partial result as success.

## Runtime compatibility

Fastifest has not declared an engine range or completed its runtime/OS support matrix. Node 22 is used for full local checks; focused Windows suites have passed on Node 20 and 22. A temporary packed install was smoke-tested locally. These results do not establish whole-package support for every runtime or operating system. Check release documentation before selecting a production runtime.
