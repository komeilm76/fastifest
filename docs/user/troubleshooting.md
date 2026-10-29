# Troubleshooting and safety

> **Pre-release:** Fastifest is not published to npm yet. This guide describes behavior verified in the current source package; runtime and OS support remain under evaluation.

## No logo found

Fastifest requires exactly one readable logo directly inside the configured `paths.logos` directory. Check that the directory exists and contains a PNG, JPG, JPEG, or SVG file. Discovery is non-recursive; filenames are found automatically and do not go in the config.

## More than one logo found

Fastifest does not guess which logo is primary. Keep one supported logo in the source directory or configure a directory containing only the intended logo.

## Screenshot warning or no screenshots

Screenshots are optional. A missing or empty configured screenshot directory produces a warning. When no screenshot files are found, the generated manifest omits the `screenshots` member. Add PNG, JPG, or JPEG screenshots if you want them generated.

## Unsupported, corrupt, or oversized image

Supported suffixes are not enough: Fastifest inspects image data. A corrupt supported file or a mismatch between its extension and actual format fails generation instead of being silently skipped. Check that the file opens in an image viewer, that the extension matches its format, and that the format is supported for that input type. SVG inputs are supported for logos only.

The current limits include 20 MiB per raster input, 2 MiB per SVG, 40 megapixels and 12,000 pixels per side for decoded raster images, and a 4,096-pixel maximum screenshot side. Oversized screenshots are reduced proportionally, not enlarged. If a valid image exceeds an input limit, reduce it before retrying.

## Config or template errors

- Confirm `fastifest.config.ts` is at the project root or pass the intended file using `--config`.
- Check spelling and value types against the [configuration reference](configuration.md).
- A TypeScript config and `manifest.template.ts` execute code. Use only files you trust.
- Do not add generated `icons` or `screenshots` to the template; Fastifest owns those collections.
- A missing template with creation enabled produces a starter and stops. Customize it, then run again. An existing template is preserved and loaded; it is never overwritten automatically.

## Output path or overwrite error

The manifest and generated assets must remain inside the configured public root; `manifest.json` must be directly in that folder. Use paths that do not escape or overlap input/output folders. Symlinked input entries and symlink/reparse-point output components or reserved targets are rejected. With overwrite disabled, move or rename conflicting managed outputs yourself before retrying. Fastifest does not recursively delete folders or overwrite files outside its reserved names.

## Sharp installation issue

`sharp` uses platform-specific native binaries. Fastifest has not declared a complete supported operating-system/runtime matrix. Check that your package manager completed installation for your platform and consult the error output for the failing runtime or platform. Focused test results are not a guarantee of support for every environment.

## Generation fails during writing

Fastifest validates and prepares output before updating the manifest. A caught transaction failure attempts to restore replaced files and preserve the previous manifest. Updating several image files cannot be fully atomic across a process crash or power loss. If generation is interrupted, rerun it with the same configuration to restore a consistent output set. Do not delete the entire output folder; unrelated files may be present.

## Manifest URLs do not load

The configured public directory must be served by your web application. Manifest `src` URLs resolve relative to the deployed manifest URL, not to the project directory or HTML page. Confirm that each resolved icon/screenshot URL returns the expected file, that `manifest.json` is linked from your HTML, and that the server returns JSON with an appropriate `Content-Type`. See [Web App Manifest and PWA basics](manifest-and-pwa.md#understand-url-resolution).

## Safety notes

- Treat configs and templates as executable code; load only trusted files.
- Avoid placing private data in public asset directories.
- Generated output cleanup is limited to reserved Fastifest filenames and is never recursive.
- Fastifest applies input size, image-dimension, and SVG-processing limits, but does not claim complete protection against malicious inputs or vulnerabilities in native image libraries. Manifest validation cannot guarantee identical behavior across browsers or app stores; verify your deployed app in its target environments.
