# CLI and API

> **Pre-release guide:** Fastifest has no runnable CLI or API yet. The interface below is proposed and will be replaced or confirmed after implementation.

## CLI (planned)

The default command will generate the manifest and assets from the current project:

```sh
npx fastifest
```

Select a config file with:

```sh
npx fastifest --config ./config/fastifest.config.ts
```

Planned options:

| Option            | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `--help`          | Show usage and available options.                          |
| `--config <path>` | Use a config other than the default `fastifest.config.ts`. |
| `--version`       | Print the installed Fastifest version.                     |

Run the CLI from your project root; the current working directory is the project root for config and project paths. A relative `--config` path is resolved from that directory. Success should exit with status `0`; configuration, validation, or generation failures should exit non-zero and include an actionable message.

## Programmatic API (planned)

A small typed API may expose the same operation as the CLI:

```ts
import { generateManifest } from "fastifest";

await generateManifest({
  cwd: process.cwd(),
  configPath: "./fastifest.config.ts",
});
```

The API signature, return value, and error types are not final. CLI and API must share the same generation implementation and validation behavior; they should not be separate code paths.

## Runtime compatibility

The intended toolchain uses Bun for development. The package's supported consumer runtimes will be stated only after config/template loading and `sharp` installation have been tested on them. See the published package's engine requirements when available; do not assume Bun is required or that every Node.js/Bun version is supported.
